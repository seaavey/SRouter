//! OpenCode Zen provider executor / adapter logic.

use futures_util::StreamExt;
use serde_json::Value;

use crate::constants;
use crate::error::APIError;
use crate::features::providers::adapter::{
    ProviderAdapter, ProviderStream, encode_stream, forward_image_generation, upstream_error,
    upstream_status_error, upstream_stream_status_error,
};
use crate::features::providers::executor::{BoxFuture, ProviderExecutor};
use crate::features::providers::model::ModelDefinition;
use crate::features::providers::opencode::types::{
    OPENCODE_ZEN_BASE_URL, OPENCODE_ZEN_KEYS, OPENCODE_ZEN_MODELS, OPENCODE_ZEN_PROVIDER,
};
use crate::features::providers::wire::{random_hex, stream_error_message};
use crate::infrastructure::upstream::UpstreamClient;
use crate::protocol::image::ImageGenerationRequest;
use crate::protocol::model::{ChatCompletionRequest, ChatContent, ChatMessage};
use crate::protocol::usage::UsageBreakdown;

const OPENCODE_HARNESS_PREFIX: &str = include_str!("harness.txt");
const OPENCODE_TOOLS_RAW: &str = include_str!("tools.json");

/// Upstream Zen rejects requests whose tool set lacks its built-in `read` and
/// `shell` tools with `403 FreeTierError` ("free tier can only be used from
/// within OpenCode"). Client-provided tool sets are padded with inert stubs
/// carrying those exact names so the request is accepted; the full OpenCode
/// tool set is only injected when the client sent no tools at all.
const OPENCODE_GATE_TOOLS: &[&str] = &["read", "shell"];

const OPENCODE_GATE_TOOL_STUB_DESCRIPTION: &str =
    "This tool is unavailable in this session and calling it always fails. Never call it.";

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

    pub fn alias(&self) -> &'static str {
        OPENCODE_ZEN_PROVIDER.alias
    }

    pub fn models(&self) -> Vec<String> {
        self.models
            .iter()
            .map(|model| model.id.to_owned())
            .collect()
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
        if model.starts_with("space-bunny") {
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
                APIError::new(500, constants::providers::could_not_decode_response(&error))
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
        let mut aggregator = BufferedCompletion::new(
            format!("chatcmpl-{}", random_hex(16)),
            crate::clock::now_ms() / 1000,
        );

        // Upstream SSE arrives fragmented across TCP chunks, so `data:` lines
        // must be reassembled across reads instead of parsed per network chunk.
        let mut line_buffer = String::new();

        while let Some(item) = stream.next().await {
            let bytes = item.map_err(upstream_error)?;
            line_buffer.push_str(&String::from_utf8_lossy(&bytes));

            while let Some(pos) = line_buffer.find('\n') {
                let line = line_buffer[..pos].trim_end_matches('\r').to_owned();
                line_buffer.drain(..=pos);

                if let Some(json_str) = line.strip_prefix("data: ") {
                    if json_str.trim() == "[DONE]" {
                        continue;
                    }
                    if let Ok(val) = serde_json::from_str::<Value>(json_str) {
                        aggregator.accept(&val)?;
                    }
                }
            }
        }

        Ok(aggregator.finish(model, request))
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
            APIError::new(500, constants::providers::could_not_build_request(&error))
        })?;
        body["model"] = Value::String(model.to_owned());
        body["stream"] = Value::Bool(stream);

        // Models other than space-bunny require OpenCode harness wrapping:
        if !model.starts_with("space-bunny") {
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
                            if let Some(content) = first.get_mut("content")
                                && let Some(old_str) = content.as_str()
                            {
                                *content = Value::String(format!(
                                    "{OPENCODE_HARNESS_PREFIX}\n\n{old_str}"
                                ));
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
                    APIError::new(500, constants::providers::could_not_parse_tools(&e))
                })?;
                body["tools"] = tools_val;
                body["tool_choice"] = Value::String("none".to_string());
            } else if let Some(tools) = body.get_mut("tools").and_then(|t| t.as_array_mut()) {
                // Client tools: pad with inert gate stubs unless the exact
                // names are already present (the gate match is case-sensitive,
                // and duplicate names make upstream reject the request).
                for name in OPENCODE_GATE_TOOLS {
                    let present = tools
                        .iter()
                        .any(|t| t["function"]["name"].as_str() == Some(*name));
                    if !present {
                        tools.push(serde_json::json!({
                            "type": "function",
                            "function": {
                                "name": name,
                                "description": OPENCODE_GATE_TOOL_STUB_DESCRIPTION,
                                "parameters": { "type": "object", "properties": {} }
                            }
                        }));
                    }
                }
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

fn estimate_prompt_tokens(messages: &[ChatMessage]) -> i64 {
    let mut total_chars = 0;
    for m in messages {
        match &m.content {
            ChatContent::Text(t) => total_chars += t.chars().count(),
            ChatContent::Parts(parts) => {
                for p in parts {
                    if let Some(t) = &p.text {
                        total_chars += t.chars().count();
                    }
                }
            }
            ChatContent::Null => {}
        }
    }
    (total_chars / 4).max(1) as i64
}

/// Folds an upstream OpenAI-shaped SSE stream into one non-streaming
/// `chat.completion` body. Mirrors the aggregator the other providers use:
/// an upstream error frame aborts the fold instead of producing an empty
/// `200`, a reasoning-only model surfaces its reasoning as the answer, and
/// tool-call fragments are reassembled by index.
pub(crate) struct BufferedCompletion {
    id: String,
    created: i64,
    content: String,
    reasoning: String,
    finish_reason: Option<String>,
    usage: Option<Value>,
    tool_calls: std::collections::BTreeMap<usize, Value>,
    arguments: std::collections::BTreeMap<usize, String>,
}

impl BufferedCompletion {
    pub(crate) fn new(id: String, created: i64) -> Self {
        Self {
            id,
            created,
            content: String::new(),
            reasoning: String::new(),
            finish_reason: None,
            usage: None,
            tool_calls: std::collections::BTreeMap::new(),
            arguments: std::collections::BTreeMap::new(),
        }
    }

    pub(crate) fn accept(&mut self, val: &Value) -> Result<(), APIError> {
        // Zen streams failures inside an HTTP 200 body as `data: {"error":…}`;
        // without this the fold would finish on empty content and answer `200`.
        if let Some(message) = stream_error_message(val, "OpenCode Zen stream failed") {
            return Err(APIError::new(500, message));
        }

        if let Some(id) = val.get("id").and_then(|v| v.as_str()) {
            self.id = id.to_owned();
        }
        if let Some(created) = val.get("created").and_then(|v| v.as_i64()) {
            self.created = created;
        }

        let choice = &val["choices"][0];
        let delta = &choice["delta"];
        if let Some(content) = delta["content"].as_str() {
            self.content.push_str(content);
        }
        if let Some(reasoning) = delta["reasoning_content"]
            .as_str()
            .or_else(|| delta["reasoning"].as_str())
        {
            self.reasoning.push_str(reasoning);
        }
        if let Some(reason) = choice["finish_reason"].as_str() {
            self.finish_reason = Some(reason.to_owned());
        }

        // Tool calls stream in fragments: the id/name arrive once, arguments
        // accumulate per index, so they are reassembled before the response.
        if let Some(items) = delta["tool_calls"].as_array() {
            for item in items {
                let index = item.get("index").and_then(|v| v.as_u64()).unwrap_or(0) as usize;
                let entry = self.tool_calls.entry(index).or_insert_with(|| {
                    serde_json::json!({
                        "index": index,
                        "type": "function",
                        "function": { "name": "", "arguments": "" }
                    })
                });
                if let Some(id) = item.get("id").and_then(|v| v.as_str()) {
                    entry["id"] = Value::String(id.to_owned());
                }
                if let Some(name) = item["function"]["name"].as_str() {
                    entry["function"]["name"] = Value::String(name.to_owned());
                }
                if let Some(args) = item["function"]["arguments"].as_str() {
                    self.arguments.entry(index).or_default().push_str(args);
                }
            }
        }

        if let Some(usage) = val.get("usage") {
            self.usage = Some(usage.clone());
        }

        Ok(())
    }

    pub(crate) fn finish(mut self, model: &str, request: &ChatCompletionRequest) -> Value {
        for (index, args) in self.arguments {
            if let Some(entry) = self.tool_calls.get_mut(&index) {
                entry["function"]["arguments"] = Value::String(args);
            }
        }

        let usage = if let Some(u) = self.usage {
            UsageBreakdown::from_value(&u).to_openai_json()
        } else {
            let prompt_tokens = estimate_prompt_tokens(&request.messages);
            let completion_tokens = (self.content.chars().count() / 4).max(1) as i64;
            let total_tokens = prompt_tokens + completion_tokens;
            UsageBreakdown {
                prompt_tokens,
                completion_tokens,
                total_tokens,
                ..Default::default()
            }
            .to_openai_json()
        };

        let tool_calls_list: Vec<Value> = self.tool_calls.into_values().collect();
        let has_tool_calls = !tool_calls_list.is_empty();

        // A reasoning-only model can finish with no visible content; its
        // reasoning is then the only answer the caller can be given.
        let mut message = serde_json::json!({
            "role": "assistant",
            "content": if self.content.is_empty() && !self.reasoning.is_empty() {
                self.reasoning.clone()
            } else {
                self.content.clone()
            }
        });
        if !self.reasoning.is_empty() {
            message["reasoning_content"] = Value::String(std::mem::take(&mut self.reasoning));
        }
        if has_tool_calls {
            message["tool_calls"] = Value::Array(tool_calls_list);
        }

        serde_json::json!({
            "id": self.id,
            "object": "chat.completion",
            "created": self.created,
            "model": model,
            "choices": [{
                "index": 0,
                "message": message,
                "finish_reason": self.finish_reason
                    .unwrap_or_else(|| if has_tool_calls { "tool_calls".to_owned() } else { "stop".to_owned() })
            }],
            "usage": usage
        })
    }
}

impl ProviderExecutor for OpenCodeExecutor {
    fn as_any(&self) -> &dyn std::any::Any {
        self
    }

    fn id(&self) -> &'static str {
        OpenCodeExecutor::id(self)
    }

    fn keys(&self) -> &'static [&'static str] {
        OpenCodeExecutor::keys(self)
    }

    fn alias(&self) -> &'static str {
        OpenCodeExecutor::alias(self)
    }

    fn models(&self) -> Vec<String> {
        OpenCodeExecutor::models(self)
    }

    fn chat_completion<'a>(
        &'a self,
        model: &'a str,
        request: &'a ChatCompletionRequest,
    ) -> BoxFuture<'a, Result<Value, APIError>> {
        Box::pin(async move { OpenCodeExecutor::chat_completion(self, model, request).await })
    }

    fn chat_completion_stream<'a>(
        &'a self,
        model: &'a str,
        request: &'a ChatCompletionRequest,
    ) -> BoxFuture<'a, Result<ProviderStream, APIError>> {
        Box::pin(
            async move { OpenCodeExecutor::chat_completion_stream(self, model, request).await },
        )
    }

    fn generate_image<'a>(
        &'a self,
        model: &'a str,
        request: &'a ImageGenerationRequest,
    ) -> BoxFuture<'a, Result<Value, APIError>> {
        let url = format!("{}/images/generations", self.base_url.trim_end_matches('/'));
        Box::pin(async move { forward_image_generation(&self.client, &url, model, request).await })
    }
}

/// Builds the adapter / executor against the production base URL.
pub fn adapter() -> Result<ProviderAdapter, APIError> {
    adapter_with_base_url(OPENCODE_ZEN_BASE_URL)
}

/// Builds the adapter / executor against an explicit base URL.
pub fn adapter_with_base_url(base_url: impl Into<String>) -> Result<ProviderAdapter, APIError> {
    let client = UpstreamClient::new()?;

    Ok(ProviderAdapter::new(OpenCodeExecutor::new(
        OPENCODE_ZEN_PROVIDER.id,
        OPENCODE_ZEN_KEYS,
        base_url,
        OPENCODE_ZEN_MODELS,
        client,
    )))
}
