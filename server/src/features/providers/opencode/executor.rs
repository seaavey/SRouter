//! OpenCode Zen provider executor / adapter logic.

use futures_util::StreamExt;
use serde_json::Value;

use crate::error::APIError;
use crate::features::gateway::model::ChatCompletionRequest;
use crate::features::providers::adapter::{
    ProviderAdapter, ProviderStream, encode_stream, upstream_error, upstream_status_error,
    upstream_stream_status_error,
};
use crate::features::providers::model::ModelDefinition;
use crate::features::providers::opencode::types::{
    OPENCODE_ZEN_BASE_URL, OPENCODE_ZEN_KEYS, OPENCODE_ZEN_MODELS, OPENCODE_ZEN_PROVIDER,
};
use crate::infrastructure::upstream::UpstreamClient;

const OPENCODE_HARNESS_PREFIX: &str = include_str!("harness.txt");
const OPENCODE_TOOLS_RAW: &str = include_str!("tools.json");

/// Dedicated executor for OpenCode Zen models.
/// It wraps upstream requests with OpenCode CLI headers and coding agent
/// harness wrappers so that premium free-tier models (Nemotron, MiMo, Big Pickle,
/// LongCat) are unlocked and answered properly.
#[derive(Clone)]
pub struct OpenCodeExecutor {
    id: &'static str,
    keys: &'static [&'static str],
    base_url: String,
    models: &'static [ModelDefinition],
    client: UpstreamClient,
}

impl OpenCodeExecutor {
    pub fn new(
        id: &'static str,
        keys: &'static [&'static str],
        base_url: impl Into<String>,
        models: &'static [ModelDefinition],
        client: UpstreamClient,
    ) -> Self {
        Self {
            id,
            keys,
            base_url: base_url.into(),
            models,
            client,
        }
    }

    pub fn id(&self) -> &'static str {
        self.id
    }

    pub fn keys(&self) -> &'static [&'static str] {
        self.keys
    }

    pub fn models(&self) -> &'static [ModelDefinition] {
        self.models
    }

    pub fn chat_completions_url(&self) -> String {
        format!("{}/chat/completions", self.base_url.trim_end_matches('/'))
    }

    pub async fn chat_completion(
        &self,
        model: &str,
        request: &ChatCompletionRequest,
    ) -> Result<Value, APIError> {
        // space-bunny-free can be invoked with standard direct JSON if not streaming:
        if model == "space-bunny-free" {
            let session_id = generate_opencode_session_id();
            let response = self
                .client
                .raw()
                .post(self.chat_completions_url())
                .timeout(self.client.request_timeout())
                .header("User-Agent", "opencode/latest/2.0.15/cli")
                .header("Authorization", "Bearer public")
                .header("x-opencode-client", "cli")
                .header(
                    "x-opencode-project",
                    "a0e6aa2382ca897f3290ccf5d6aec2593a3eb435",
                )
                .header("x-opencode-session", &session_id)
                .header("x-session-affinity", &session_id)
                .header("x-session-id", &session_id)
                .header("X-Session-Id", &session_id)
                .json(&self.upstream_body(model, request, false)?)
                .send()
                .await
                .map_err(upstream_error)?;

            let status = response.status();
            if !status.is_success() {
                let detail = response.text().await.unwrap_or_default();
                return Err(upstream_status_error(status, &detail));
            }

            return response.json::<Value>().await.map_err(|error| {
                APIError::new(
                    500,
                    format!("could not decode the upstream response: {error}"),
                )
            });
        }

        // For other free models, upstream Zen rejects non-streaming requests with 403.
        // We call upstream with stream=true and aggregate the SSE deltas into a standard
        // non-streaming chat.completion response JSON.
        let session_id = generate_opencode_session_id();
        let response = self
            .client
            .raw()
            .post(self.chat_completions_url())
            .timeout(self.client.request_timeout())
            .header("User-Agent", "opencode/latest/2.0.15/cli")
            .header("Authorization", "Bearer public")
            .header("x-opencode-client", "cli")
            .header(
                "x-opencode-project",
                "a0e6aa2382ca897f3290ccf5d6aec2593a3eb435",
            )
            .header("x-opencode-session", &session_id)
            .header("x-session-affinity", &session_id)
            .header("x-session-id", &session_id)
            .header("X-Session-Id", &session_id)
            .json(&self.upstream_body(model, request, true)?)
            .send()
            .await
            .map_err(upstream_error)?;

        let status = response.status();
        if !status.is_success() {
            let detail = response.text().await.unwrap_or_default();
            return Err(upstream_status_error(status, &detail));
        }

        let mut stream = response.bytes_stream();
        let mut full_content = String::new();
        let mut chunk_id = format!("chatcmpl-{}", random_hex(16));
        let mut created_ts = crate::clock::now_ms() / 1000;

        while let Some(item) = stream.next().await {
            let bytes = item.map_err(upstream_error)?;
            let text = String::from_utf8_lossy(&bytes);
            for line in text.lines() {
                if let Some(json_str) = line.strip_prefix("data: ") {
                    if json_str.trim() == "[DONE]" {
                        break;
                    }
                    if let Ok(val) = serde_json::from_str::<Value>(json_str) {
                        if let Some(id) = val.get("id").and_then(|v| v.as_str()) {
                            chunk_id = id.to_owned();
                        }
                        if let Some(created) = val.get("created").and_then(|v| v.as_i64()) {
                            created_ts = created;
                        }
                        if let Some(content) = val["choices"][0]["delta"]["content"].as_str() {
                            full_content.push_str(content);
                        }
                    }
                }
            }
        }

        Ok(serde_json::json!({
            "id": chunk_id,
            "object": "chat.completion",
            "created": created_ts,
            "model": model,
            "choices": [{
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": full_content
                },
                "finish_reason": "stop"
            }],
            "usage": {
                "prompt_tokens": 0,
                "completion_tokens": 0,
                "total_tokens": 0
            }
        }))
    }

    pub async fn chat_completion_stream(
        &self,
        model: &str,
        request: &ChatCompletionRequest,
    ) -> Result<ProviderStream, APIError> {
        let session_id = generate_opencode_session_id();
        let response = self
            .client
            .raw()
            .post(self.chat_completions_url())
            .header("User-Agent", "opencode/latest/2.0.15/cli")
            .header("Authorization", "Bearer public")
            .header("x-opencode-client", "cli")
            .header(
                "x-opencode-project",
                "a0e6aa2382ca897f3290ccf5d6aec2593a3eb435",
            )
            .header("x-opencode-session", &session_id)
            .header("x-session-affinity", &session_id)
            .header("x-session-id", &session_id)
            .header("X-Session-Id", &session_id)
            .json(&self.upstream_body(model, request, true)?)
            .send()
            .await
            .map_err(upstream_error)?;

        let status = response.status();
        if !status.is_success() {
            let detail = response.text().await.unwrap_or_default();
            return Err(upstream_stream_status_error(status, &detail));
        }

        Ok(encode_stream(response.bytes_stream()))
    }

    fn upstream_body(
        &self,
        model: &str,
        request: &ChatCompletionRequest,
        stream: bool,
    ) -> Result<Value, APIError> {
        let mut body = serde_json::to_value(request).map_err(|error| {
            APIError::new(
                500,
                format!("could not build the upstream request: {error}"),
            )
        })?;
        body["model"] = Value::String(model.to_owned());
        body["stream"] = Value::Bool(stream);

        // Models other than space-bunny-free require OpenCode harness wrapping:
        if model != "space-bunny-free" {
            if let Some(messages) = body.get_mut("messages").and_then(|m| m.as_array_mut()) {
                let needs_harness = messages
                    .first()
                    .and_then(|m| m.get("content"))
                    .and_then(|c| c.as_str())
                    .map(|text| !text.starts_with("You are an AI agent running in OpenCode"))
                    .unwrap_or(true);

                if needs_harness {
                    if let Some(first) = messages.first_mut() {
                        if first.get("role").and_then(|r| r.as_str()) == Some("system") {
                            if let Some(content) = first.get_mut("content") {
                                if let Some(old_str) = content.as_str() {
                                    *content = Value::String(format!(
                                        "{OPENCODE_HARNESS_PREFIX}\n\n{old_str}"
                                    ));
                                }
                            }
                        } else {
                            messages.insert(
                                0,
                                serde_json::json!({
                                    "role": "system",
                                    "content": OPENCODE_HARNESS_PREFIX
                                }),
                            );
                        }
                    } else {
                        messages.push(serde_json::json!({
                            "role": "system",
                            "content": OPENCODE_HARNESS_PREFIX
                        }));
                    }
                }
            }

            if body.get("tools").is_none()
                || body
                    .get("tools")
                    .and_then(|t| t.as_array())
                    .map(|a| a.is_empty())
                    .unwrap_or(false)
            {
                let tools_val: Value = serde_json::from_str(OPENCODE_TOOLS_RAW).map_err(|e| {
                    APIError::new(500, format!("could not parse default OpenCode tools: {e}"))
                })?;
                body["tools"] = tools_val;
                body["tool_choice"] = Value::String("none".to_string());
            }
        }

        Ok(body)
    }
}

static SESSION_COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

/// Generates a valid OpenCode session identifier matching OpenCode CLI's algorithm:
/// `ses_` + 12 hex chars (bitwise NOT of timestamp_ms * 0x1000 + counter) + 14 base62 random chars.
pub fn generate_opencode_session_id() -> String {
    let now_ms = crate::clock::now_ms() as u64;
    let seq = SESSION_COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let n = (now_ms * 0x1000).wrapping_add(seq & 0xfff);
    let a = !n;

    let mut hex_part = String::with_capacity(12);
    for d in 0..6 {
        let b = ((a >> (40 - 8 * d)) & 0xff) as u8;
        use std::fmt::Write;
        let _ = write!(hex_part, "{b:02x}");
    }

    const BASE62: &[u8] = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    let mut rand_bytes = [0u8; 14];
    let _ = getrandom::fill(&mut rand_bytes);

    let mut rand_part = String::with_capacity(14);
    for byte in rand_bytes {
        rand_part.push(BASE62[(byte as usize) % 62] as char);
    }

    format!("ses_{hex_part}{rand_part}")
}

fn random_hex(len: usize) -> String {
    let mut bytes = vec![0u8; len];
    let _ = getrandom::fill(&mut bytes);
    hex::encode(bytes)
}

/// Builds the adapter / executor against the production base URL.
pub fn adapter() -> Result<ProviderAdapter, APIError> {
    adapter_with_base_url(OPENCODE_ZEN_BASE_URL)
}

/// Builds the adapter / executor against an explicit base URL.
pub fn adapter_with_base_url(base_url: impl Into<String>) -> Result<ProviderAdapter, APIError> {
    let client = UpstreamClient::new()?;

    Ok(ProviderAdapter::OpenCode(OpenCodeExecutor::new(
        OPENCODE_ZEN_PROVIDER.id,
        OPENCODE_ZEN_KEYS,
        base_url,
        OPENCODE_ZEN_MODELS,
        client,
    )))
}

pub use adapter as opencode_executor;
pub use adapter_with_base_url as opencode_executor_with_base_url;
