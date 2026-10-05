//! Builds and signs the COSY request the Qoder gateway accepts: the message-body
//! translation, the model-key resolution, and the signed-header assembly.

use std::collections::BTreeMap;

use reqwest::header::HeaderValue;
use serde_json::Value;

use super::auth::identity;
use super::catalog::{ModelConfig, QoderCatalog};
use super::cosy::{encode_body, sign};
use super::executor::QoderExecutor;
use super::state::read_catalog;
use super::types::{QODER_DEFAULT_MAX_OUTPUT, QODER_USER_AGENT, resolve_model_key};
use crate::clock::now_ms;
use crate::error::APIError;
use crate::features::providers::adapter::{upstream_error, upstream_status_error};
use crate::infrastructure::database::providers::QoderCredentials;
use crate::protocol::model::{ChatCompletionRequest, ChatContent, ChatMessage, ChatRole, ToolCall};

/// One request, ready to be sent: signed headers plus the encoded body.
pub(super) struct PreparedRequest {
    url: String,
    pub(super) model_key: String,
    source: String,
    encoded_body: String,
    headers: BTreeMap<&'static str, String>,
}

impl QoderExecutor {
    pub(super) async fn prepare(
        &self,
        model: &str,
        request: &ChatCompletionRequest,
    ) -> Result<PreparedRequest, APIError> {
        let model_key = requested_key(&read_catalog(&self.catalog), model);
        let config = {
            let catalog = read_catalog(&self.catalog);
            catalog
                .config_for(&model_key)
                .cloned()
                .unwrap_or_else(|| default_config(&model_key))
        };
        let credentials = self.credentials().await?;
        let machine_id = self.machine_id().await?;
        let body = build_body(&model_key, &config, &credentials, request);
        let encoded_body = encode_body(body.to_string().as_bytes());
        let url = self.endpoints.chat_url();
        let request_id = uuid::Uuid::new_v4().to_string();

        let headers = sign(
            &encoded_body,
            &url,
            &identity(&credentials, &machine_id),
            (now_ms() / 1000) as u64,
            &request_id,
        )?;

        Ok(PreparedRequest {
            url,
            model_key,
            source: config.source,
            encoded_body,
            headers,
        })
    }

    /// Signs and sends one chat request. The body always asks for a stream: the
    /// upstream has no buffered chat endpoint.
    pub(super) async fn send_chat(
        &self,
        prepared: &PreparedRequest,
        buffered: bool,
    ) -> Result<reqwest::Response, APIError> {
        let mut request = self
            .client
            .raw()
            .post(&prepared.url)
            .header("Content-Type", "application/json")
            .header("Accept", "text/event-stream")
            .header("Cache-Control", "no-cache")
            .header("Accept-Encoding", "identity")
            .header("User-Agent", QODER_USER_AGENT)
            .body(prepared.encoded_body.clone());
        if buffered {
            request = request.timeout(self.client.request_timeout());
        }
        if let Ok(model_key) = HeaderValue::from_str(&prepared.model_key) {
            request = request.header("X-Model-Key", model_key);
        }
        if let Ok(source) = HeaderValue::from_str(&prepared.source) {
            request = request.header("X-Model-Source", source);
        }
        let request = apply_headers(request, &prepared.headers);

        let response = request.send().await.map_err(upstream_error)?;
        let status = response.status();
        if !status.is_success() {
            let detail = response.text().await.unwrap_or_default();
            return Err(upstream_status_error(status, &detail));
        }

        Ok(response)
    }
}

fn default_config(key: &str) -> ModelConfig {
    ModelConfig {
        key: key.to_owned(),
        is_reasoning: false,
        max_output_tokens: QODER_DEFAULT_MAX_OUTPUT,
        source: "system".to_owned(),
    }
}

/// The key a requested model id asks upstream for. The live catalog answers
/// first, because its friendly ids are the names upstream gave its own keys; the
/// static table then serves a request that arrives before the first fetch, and an
/// id neither knows passes through untouched.
pub(super) fn requested_key(catalog: &QoderCatalog, model: &str) -> String {
    let model = model.trim();

    catalog
        .key_for_id(model)
        .map_or_else(|| resolve_model_key(model), |key| key.to_owned())
}

pub(super) fn apply_headers(
    request: reqwest::RequestBuilder,
    headers: &BTreeMap<&'static str, String>,
) -> reqwest::RequestBuilder {
    let mut request = request;

    for (name, value) in headers {
        if let Ok(value) = HeaderValue::from_str(value) {
            request = request.header(*name, value);
        }
    }

    request
}

/// Builds the upstream request body. The system prompt is lifted out of the
/// message list, and the ids the upstream groups a conversation by are derived
/// from the conversation itself so a retry keeps its session.
pub(super) fn build_body(
    model_key: &str,
    config: &ModelConfig,
    credentials: &QoderCredentials,
    request: &ChatCompletionRequest,
) -> Value {
    let mut system = Vec::new();
    let mut messages = Vec::new();
    let mut last_user_text = String::new();

    for message in &request.messages {
        match message.role {
            ChatRole::System | ChatRole::Developer => {
                if let Some(text) = text_of(&message.content) {
                    system.push(text);
                }
            }
            ChatRole::User => {
                last_user_text = text_of(&message.content).unwrap_or_default();
                messages.push(user_message(message));
            }
            ChatRole::Assistant => messages.push(assistant_message(message)),
            ChatRole::Tool | ChatRole::Function => messages.push(tool_message(message)),
        }
    }

    let max_tokens = request
        .max_tokens
        .map(|value| i64::from(value).min(config.max_output_tokens))
        .unwrap_or(config.max_output_tokens)
        .max(1);
    let session_id = stable_hash(&["qoder-session", &credentials.user_id, model_key]);
    let record_id = stable_hash(&[
        "qoder-record",
        model_key,
        &serde_json::to_string(&messages).unwrap_or_default(),
        &serde_json::to_string(&request.tools).unwrap_or_default(),
        &format!("mt={max_tokens}"),
    ]);

    let tools = match &request.tools {
        Some(tools) => serde_json::to_value(tools).unwrap_or(Value::Null),
        None => Value::Array(Vec::new()),
    };

    serde_json::json!({
        "request_id": uuid::Uuid::new_v4(),
        "request_set_id": record_id,
        "chat_record_id": record_id,
        "session_id": session_id,
        "stream": true,
        "chat_task": "FREE_INPUT",
        "is_reply": true,
        "is_retry": false,
        "source": 1,
        "version": "3",
        "session_type": "qodercli",
        "agent_id": "agent_common",
        "task_id": "common",
        "code_language": "",
        "chat_prompt": "",
        "image_urls": null,
        "aliyun_user_type": "",
        "system": system.join("\n\n"),
        "messages": messages,
        "tools": tools,
        "parameters": { "max_tokens": max_tokens },
        "chat_context": {
            "chatPrompt": "",
            "imageUrls": null,
            "extra": {
                "context": [],
                "modelConfig": { "key": config.key, "is_reasoning": config.is_reasoning },
                "originalContent": last_user_text,
            },
            "features": [],
            "text": last_user_text,
        },
        "model_config": {
            "key": config.key,
            "is_reasoning": config.is_reasoning,
            "max_output_tokens": config.max_output_tokens,
            "source": config.source,
        },
        "business": {
            "product": "cli",
            "version": "1.0.0",
            "type": "agent",
            "stage": "start",
            "id": uuid::Uuid::new_v4(),
            "name": truncate(&last_user_text, 30),
            "begin_at": now_ms(),
        },
    })
}

fn user_message(message: &ChatMessage) -> Value {
    match &message.content {
        ChatContent::Text(text) => serde_json::json!({ "role": "user", "content": text }),
        ChatContent::Parts(_) => serde_json::json!({
            "role": "user",
            "content": message.content.clone(),
        }),
        ChatContent::Null => serde_json::json!({ "role": "user", "content": "" }),
    }
}

fn assistant_message(message: &ChatMessage) -> Value {
    let mut mapped = serde_json::json!({
        "role": "assistant",
        "content": match &message.content {
            ChatContent::Text(text) => Value::String(text.clone()),
            ChatContent::Null => Value::Null,
            ChatContent::Parts(_) => Value::String(text_of(&message.content).unwrap_or_default()),
        },
    });

    if let Some(tool_calls) = &message.tool_calls {
        mapped["tool_calls"] = Value::Array(tool_calls.iter().map(tool_call_json).collect());
    }

    mapped
}

fn tool_message(message: &ChatMessage) -> Value {
    let tool_call_id = message
        .tool_call_id
        .clone()
        .or_else(|| message.name.clone())
        .unwrap_or_default();

    serde_json::json!({
        "role": "tool",
        "tool_call_id": tool_call_id,
        "content": text_of(&message.content).unwrap_or_default(),
    })
}

fn tool_call_json(call: &ToolCall) -> Value {
    serde_json::json!({
        "id": call.id,
        "type": "function",
        "function": { "name": call.function.name, "arguments": call.function.arguments },
    })
}

fn text_of(content: &ChatContent) -> Option<String> {
    match content {
        ChatContent::Text(text) => Some(text.clone()),
        ChatContent::Null => None,
        ChatContent::Parts(parts) => {
            let text = parts
                .iter()
                .filter_map(|part| part.text.clone())
                .collect::<Vec<_>>()
                .join("");

            if text.is_empty() { None } else { Some(text) }
        }
    }
}

fn truncate(value: &str, limit: usize) -> String {
    value.chars().take(limit).collect()
}

/// Sixteen hex characters of a SHA-256 over the labelled inputs, which is what
/// the upstream uses to key a session or a record.
fn stable_hash(inputs: &[&str]) -> String {
    use sha2::{Digest, Sha256};

    let mut hasher = Sha256::new();
    for input in inputs {
        hasher.update(b"\0");
        hasher.update(input.as_bytes());
    }

    hex::encode(hasher.finalize())[..16].to_owned()
}
