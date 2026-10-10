//! Builds and sends the CodeBuddy chat request, rewriting the OpenAI body into
//! the shape the upstream expects.

use std::collections::BTreeMap;

use serde_json::{Value, json};

use super::executor::CodeBuddyExecutor;
use crate::constants;
use crate::error::APIError;
use crate::features::providers::adapter::{
    upstream_error, upstream_status_error, upstream_stream_status_error,
};
use crate::features::providers::wire::{apply_headers, bearer_token};
use crate::protocol::model::ChatCompletionRequest;

pub(super) struct PreparedRequest {
    url: String,
    pub(super) model_key: String,
    encoded_body: String,
    headers: BTreeMap<&'static str, String>,
}

impl CodeBuddyExecutor {
    pub(super) async fn chat_response(
        &self,
        model: &str,
        request: &ChatCompletionRequest,
        buffered: bool,
    ) -> Result<(reqwest::Response, PreparedRequest), APIError> {
        let prepared = self.prepare(model, request).await?;
        let mut builder = self
            .client
            .raw()
            .post(&prepared.url)
            .body(prepared.encoded_body.clone());
        if buffered {
            builder = builder.timeout(self.client.request_timeout());
        }
        let response = apply_headers(builder, &prepared.headers)
            .send()
            .await
            .map_err(upstream_error)?;
        let status = response.status();
        if !status.is_success() {
            let detail = response.text().await.unwrap_or_default();
            return Err(if buffered {
                upstream_status_error(status, &detail)
            } else {
                upstream_stream_status_error(status, &detail)
            });
        }

        Ok((response, prepared))
    }

    pub(super) async fn prepare(
        &self,
        model: &str,
        request: &ChatCompletionRequest,
    ) -> Result<PreparedRequest, APIError> {
        let credentials = self.credentials().await?;
        let model_key = strip_provider_prefix(model.trim()).to_owned();
        let body = transform_body(&model_key, request)?;
        let encoded_body = serde_json::to_string(&body).map_err(|error| {
            APIError::new(500, constants::providers::could_not_build_request(&error))
        })?;
        let mut headers = self.base_headers();
        headers.insert("Content-Type", "application/json".to_owned());
        headers.insert("Authorization", bearer_token(&credentials.access_token));

        Ok(PreparedRequest {
            url: self.endpoints.chat_url.clone(),
            model_key,
            encoded_body,
            headers,
        })
    }
}

/// Node's `stripProviderPrefix` drops everything up to the first slash. The
/// registry already hands over a bare id, so this only matters for a direct
/// call; CodeBuddy ids carry no slash.
fn strip_provider_prefix(model: &str) -> &str {
    model.split_once('/').map_or(model, |(_, rest)| rest)
}

/// Rewrites a request into the shape CodeBuddy upstream expects. Mirrors
/// `transformRequestBody` in the Node oracle field for field.
pub(super) fn transform_body(
    model_key: &str,
    request: &ChatCompletionRequest,
) -> Result<Value, APIError> {
    let mut body = serde_json::to_value(request).map_err(|error| {
        APIError::new(500, constants::providers::could_not_build_request(&error))
    })?;
    body["model"] = Value::String(model_key.to_owned());
    // CodeBuddy upstream is stream-only and rejects a non-streaming request.
    body["stream"] = Value::Bool(true);

    // A disabled effort is dropped; any real level asks for an automatic
    // reasoning summary.
    if let Some(effort) = request.reasoning_effort.as_deref() {
        if effort == "none" || effort == "off" {
            if let Some(object) = body.as_object_mut() {
                object.remove("reasoning_effort");
            }
        } else {
            body["reasoning_summary"] = Value::String("auto".to_owned());
        }
    }

    let source = body
        .get("messages")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut messages = build_messages(&source);
    apply_response_format(&mut body, request, &mut messages);
    body["messages"] = Value::Array(messages);

    Ok(body)
}

/// The leading identity prompt plus the caller's own system/developer turns,
/// with user strings rewritten to typed text blocks.
fn build_messages(source: &[Value]) -> Vec<Value> {
    let mut system_prompts: Vec<String> = Vec::new();
    for message in source {
        if is_system_role(message)
            && let Some(content) = message.get("content").and_then(Value::as_str)
        {
            let trimmed = content.trim();
            if !trimmed.is_empty() {
                system_prompts.push(trimmed.to_owned());
            }
        }
    }

    let combined_system = if system_prompts.is_empty() {
        "You are CodeBuddy Code.".to_owned()
    } else {
        format!("You are CodeBuddy Code.\n\n{}", system_prompts.join("\n\n"))
    };

    let mut messages = vec![json!({ "role": "system", "content": combined_system })];
    for message in source {
        if is_system_role(message) {
            continue;
        }
        let mut message = message.clone();
        if message.get("role").and_then(Value::as_str) == Some("user")
            && let Some(text) = message.get("content").and_then(Value::as_str)
        {
            message["content"] = json!([{ "type": "text", "text": text }]);
        }
        messages.push(message);
    }

    messages
}

/// Drops `response_format` (upstream ignores it) and mirrors the schema or the
/// JSON directive into the last user turn, the only lever these models follow.
fn apply_response_format(
    body: &mut Value,
    request: &ChatCompletionRequest,
    messages: &mut [Value],
) {
    let Some(format) = request.response_format.as_ref() else {
        return;
    };
    if format.kind != "json_schema" && format.kind != "json_object" {
        return;
    }

    if let Some(object) = body.as_object_mut() {
        object.remove("response_format");
    }

    let directive = if format.kind == "json_object" {
        "Respond only in valid JSON.".to_owned()
    } else {
        match format.json_schema.as_ref() {
            Some(value) => {
                let schema = value.get("schema").unwrap_or(value);
                format!(
                    "You must respond with valid JSON matching this schema:\n{}",
                    serde_json::to_string_pretty(schema).unwrap_or_default()
                )
            }
            None => String::new(),
        }
    };

    if !directive.is_empty() {
        append_to_last_user(messages, &directive);
    }
}

fn append_to_last_user(messages: &mut [Value], directive: &str) {
    for message in messages.iter_mut().rev() {
        if message.get("role").and_then(Value::as_str) != Some("user") {
            continue;
        }
        match message.get_mut("content") {
            Some(Value::Array(parts)) => {
                for part in parts.iter_mut().rev() {
                    if part.get("type").and_then(Value::as_str) == Some("text")
                        && let Some(text) = part.get("text").and_then(Value::as_str)
                    {
                        part["text"] = Value::String(format!("{text}\n\n{directive}"));
                        break;
                    }
                }
            }
            Some(Value::String(text)) => {
                message["content"] = Value::String(format!("{text}\n\n{directive}"));
            }
            _ => {}
        }
        break;
    }
}

fn is_system_role(message: &Value) -> bool {
    matches!(
        message.get("role").and_then(Value::as_str),
        Some("system" | "developer")
    )
}
