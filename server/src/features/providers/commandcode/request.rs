//! Builds the Command Code request: an OpenAI chat body rewritten into the
//! CLI's workspace-wrapped AI-SDK shape.
//!
//! That shape is not OpenAI messages — parts are `text`, `tool-call`,
//! `tool-result`, and `image` with an explicit `mimeType` — so every message is
//! rebuilt here rather than passed through. Oracle: `format_messages` /
//! `_request_body` in the Hermes `commandcode-oauth` plugin.

use std::collections::{BTreeMap, HashMap};

use serde_json::{Value, json};

use super::executor::CommandCodeExecutor;
use crate::constants;
use crate::error::APIError;
use crate::features::providers::adapter::{
    upstream_error, upstream_status_error, upstream_stream_status_error,
};
use crate::features::providers::wire::{apply_headers, bearer_token};
use crate::protocol::model::{
    ChatCompletionRequest, ChatContent, ChatMessage, ChatRole, ContentPartType, ToolChoice,
    ToolChoiceMode,
};

/// The plugin's default when the caller asks for no limit.
const DEFAULT_MAX_TOKENS: u32 = 4096;

pub(super) struct PreparedRequest {
    url: String,
    pub(super) model_key: String,
    encoded_body: String,
    headers: BTreeMap<&'static str, String>,
}

impl CommandCodeExecutor {
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
        let model_key = strip_alias_prefix(model).to_owned();
        let body = transform_body(&model_key, request)?;
        let encoded_body = serde_json::to_string(&body).map_err(|error| {
            APIError::new(500, constants::providers::could_not_build_request(&error))
        })?;
        let mut headers = self.base_headers();
        headers.insert("Content-Type", "application/json".to_owned());
        headers.insert("Accept", "application/json".to_owned());
        headers.insert("Authorization", bearer_token(&credentials.access_token));
        // The relay groups a turn by this id, so it is fresh per request.
        headers.insert("x-session-id", uuid::Uuid::new_v4().to_string());

        Ok(PreparedRequest {
            url: self.endpoints.generate_url.clone(),
            model_key,
            encoded_body,
            headers,
        })
    }
}

/// The registry hands over the bare id (`deepseek/deepseek-v4.1-flash`), so this
/// only matters for a direct call. It drops the alias once and never the second
/// slash, which is part of the vendor's id.
pub(super) fn strip_alias_prefix(model: &str) -> &str {
    model
        .trim()
        .strip_prefix("commandcode/")
        .unwrap_or(model.trim())
}

/// The wrapped body: a workspace snapshot the relay expects around the params.
/// `config.date` is deliberately absent — it is a CLI workspace hint, and the
/// crate has no date formatter to produce it honestly.
pub(super) fn transform_body(
    model_key: &str,
    request: &ChatCompletionRequest,
) -> Result<Value, APIError> {
    let (system, messages) = build_messages(&request.messages);
    let mut params = json!({
        "model": model_key,
        "messages": messages,
        "tools": wire_tools(request),
        "system": system,
        "max_tokens": request.max_tokens.unwrap_or(DEFAULT_MAX_TOKENS),
        // The relay is stream-only; the buffered path aggregates this stream.
        "stream": true,
    });
    if let Some(temperature) = request.temperature {
        params["temperature"] = json!(temperature);
    }

    Ok(json!({
        "config": workspace_config(),
        "memory": "",
        "taste": Value::Null,
        "skills": Value::Null,
        "permissionMode": "standard",
        "mode": "agent",
        "params": params,
    }))
}

/// A headless gateway has no workspace to report, so the snapshot is neutral.
fn workspace_config() -> Value {
    json!({
        "workingDir": "/",
        "isGitRepo": false,
        "currentBranch": "",
        "mainBranch": "",
        "gitStatus": "",
        "recentCommits": [],
        "environment": format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH),
        "structure": [],
    })
}

/// Splits the system prompt out and converts every turn to wire parts. A tool
/// result names its tool from the assistant turn that opened that call id, which
/// is the only place the wire carries it.
fn build_messages(messages: &[ChatMessage]) -> (String, Vec<Value>) {
    let mut system_parts: Vec<String> = Vec::new();
    let mut wire: Vec<Value> = Vec::new();
    let mut call_names: HashMap<String, String> = HashMap::new();

    for message in messages {
        match message.role {
            ChatRole::System | ChatRole::Developer => {
                collect_text(&message.content, &mut system_parts);
            }
            ChatRole::User => {
                let mut texts: Vec<String> = Vec::new();
                let mut parts: Vec<Value> = Vec::new();
                match &message.content {
                    ChatContent::Text(text) => texts.push(text.clone()),
                    ChatContent::Parts(list) => {
                        for part in list {
                            match part.kind {
                                ContentPartType::Text => {
                                    if let Some(text) = part.text.as_deref() {
                                        texts.push(text.to_owned());
                                    }
                                }
                                ContentPartType::ImageUrl => {
                                    let url = part
                                        .image_url
                                        .as_ref()
                                        .map(|image| image.url.as_str())
                                        .unwrap_or_default();
                                    match image_part(url) {
                                        Some(part) => parts.push(part),
                                        // Unusable pixels still leave a trace, so
                                        // the model knows something was attached.
                                        None => texts.push("[image: attached]".to_owned()),
                                    }
                                }
                            }
                        }
                    }
                    ChatContent::Null => {}
                }
                let text = texts
                    .into_iter()
                    .filter(|text| !text.is_empty())
                    .collect::<Vec<_>>()
                    .join(" ");
                parts.insert(0, json!({ "type": "text", "text": text }));
                wire.push(json!({ "role": "user", "content": parts }));
            }
            ChatRole::Assistant => {
                let mut parts: Vec<Value> = Vec::new();
                match &message.content {
                    ChatContent::Text(text) if !text.is_empty() => {
                        parts.push(json!({ "type": "text", "text": text }));
                    }
                    ChatContent::Parts(list) => {
                        for part in list {
                            if part.kind == ContentPartType::Text
                                && let Some(text) = part.text.as_deref()
                                && !text.is_empty()
                            {
                                parts.push(json!({ "type": "text", "text": text }));
                            }
                        }
                    }
                    _ => {}
                }
                for call in message.tool_calls.iter().flatten() {
                    call_names.insert(call.id.clone(), call.function.name.clone());
                    let input = serde_json::from_str::<Value>(&call.function.arguments)
                        .unwrap_or_else(|_| json!({ "raw": call.function.arguments }));
                    parts.push(json!({
                        "type": "tool-call",
                        "toolCallId": call.id,
                        "toolName": call.function.name,
                        "input": input,
                    }));
                }
                if parts.is_empty() {
                    parts.push(json!({ "type": "text", "text": "" }));
                }
                wire.push(json!({ "role": "assistant", "content": parts }));
            }
            ChatRole::Tool => {
                let call_id = message.tool_call_id.clone().unwrap_or_default();
                let name = call_names
                    .get(&call_id)
                    .cloned()
                    .unwrap_or_else(|| "tool".to_owned());
                wire.push(json!({
                    "role": "tool",
                    "content": [{
                        "type": "tool-result",
                        "toolCallId": call_id,
                        "toolName": name,
                        "output": tool_output(&message.content),
                    }],
                }));
            }
            // A legacy OpenAI role with no wire form; the plugin drops it too.
            ChatRole::Function => {}
        }
    }

    (system_parts.join("\n\n"), wire)
}

fn collect_text(content: &ChatContent, into: &mut Vec<String>) {
    match content {
        ChatContent::Text(text) => {
            let trimmed = text.trim();
            if !trimmed.is_empty() {
                into.push(trimmed.to_owned());
            }
        }
        ChatContent::Parts(list) => {
            for part in list {
                if part.kind == ContentPartType::Text
                    && let Some(text) = part.text.as_deref()
                    && !text.trim().is_empty()
                {
                    into.push(text.to_owned());
                }
            }
        }
        ChatContent::Null => {}
    }
}

/// `{"type":"image","image":url,"mimeType":mime}` — the endpoint accepts a part
/// without `mimeType` and silently ignores the pixels, so a part without a
/// detectable type is refused here instead.
fn image_part(url: &str) -> Option<Value> {
    let mime = image_mime(url)?;

    Some(json!({ "type": "image", "image": url, "mimeType": mime }))
}

/// The MIME type of a data URI, or the one its file extension implies.
fn image_mime(url: &str) -> Option<String> {
    let url = url.trim();
    if let Some(rest) = url.strip_prefix("data:")
        && let Some((mime, _)) = rest.split_once(';')
        && mime.starts_with("image/")
    {
        return Some(mime.to_owned());
    }

    let path = url.split(['?', '#']).next().unwrap_or(url);
    let extension = path.rsplit_once('.').map(|(_, extension)| extension)?;
    let mime = match extension.to_ascii_lowercase().as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        _ => return None,
    };

    Some(mime.to_owned())
}

/// A tool result is text on this wire; attached media is flattened rather than
/// stringified into a data URL.
fn tool_output(content: &ChatContent) -> Value {
    let mut lines: Vec<String> = Vec::new();
    match content {
        ChatContent::Text(text) => lines.push(text.clone()),
        ChatContent::Parts(list) => {
            for part in list {
                match part.kind {
                    ContentPartType::Text => {
                        if let Some(text) = part.text.as_deref() {
                            lines.push(text.to_owned());
                        }
                    }
                    ContentPartType::ImageUrl => lines.push("[image: attached]".to_owned()),
                }
            }
        }
        ChatContent::Null => {}
    }

    json!({ "type": "text", "value": lines.join("\n") })
}

/// `tool_choice: "none"` empties the list; every other choice forwards it whole,
/// because the wire has no forced-tool form.
fn wire_tools(request: &ChatCompletionRequest) -> Vec<Value> {
    if matches!(
        request.tool_choice,
        Some(ToolChoice::Mode(ToolChoiceMode::None))
    ) {
        return Vec::new();
    }

    request
        .tools
        .iter()
        .flatten()
        .map(|tool| {
            json!({
                "name": tool.function.name,
                "description": tool.function.description.clone().unwrap_or_default(),
                "input_schema": tool
                    .function
                    .parameters
                    .clone()
                    .unwrap_or_else(|| json!({ "type": "object", "properties": {} })),
            })
        })
        .collect()
}
