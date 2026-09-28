//! Anthropic Messages wire types, serialization, and OpenAI translation.
//!
//! Provides conversion between Anthropic's `/v1/messages` protocol and
//! SRouter's internal OpenAI-compatible `ChatCompletionRequest` / `ChatCompletionResponse`.

use axum::body::Bytes;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::features::gateway::model::{
    CacheControl, ChatCompletionRequest, ChatContent, ChatMessage, ChatRole, ContentPart,
    ContentPartType, ImageUrl, StopSequence, Thinking, ThinkingConfig, ThinkingType, ToolCall,
    ToolCallFunction, ToolCallKind, ToolChoice, ToolChoiceFunction, ToolChoiceMode,
    ToolChoiceNamed, ToolDefinition, ToolFunction, ToolKind,
};

/// Generates an Anthropic-formatted identifier (e.g. `msg_...` or `toolu_...`).
pub fn generate_id(prefix: &str) -> String {
    let mut bytes = [0u8; 12];
    let _ = getrandom::fill(&mut bytes);
    format!("{prefix}_{}", hex::encode(bytes))
}

// ============================================================================
// Request Types
// ============================================================================

/// An Anthropic `/v1/messages` request payload.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct AnthropicMessageRequest {
    pub model: String,
    pub messages: Vec<AnthropicMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub system: Option<AnthropicSystem>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_tokens: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub top_p: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub top_k: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stop_sequences: Option<Vec<String>>,
    #[serde(default)]
    pub stream: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tools: Option<Vec<AnthropicTool>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_choice: Option<AnthropicToolChoice>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thinking: Option<AnthropicThinking>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<Value>,
}

/// System prompt: string or array of system content blocks.
#[derive(Clone, Debug, PartialEq)]
pub enum AnthropicSystem {
    Text(String),
    Blocks(Vec<AnthropicSystemBlock>),
}

impl<'de> Deserialize<'de> for AnthropicSystem {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct SystemVisitor;

        impl<'de> serde::de::Visitor<'de> for SystemVisitor {
            type Value = AnthropicSystem;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("a string or an array of text blocks")
            }

            fn visit_str<E: serde::de::Error>(self, value: &str) -> Result<AnthropicSystem, E> {
                Ok(AnthropicSystem::Text(value.to_owned()))
            }

            fn visit_seq<A: serde::de::SeqAccess<'de>>(
                self,
                mut seq: A,
            ) -> Result<AnthropicSystem, A::Error> {
                let mut blocks = Vec::with_capacity(seq.size_hint().unwrap_or(0));
                while let Some(block) = seq.next_element()? {
                    blocks.push(block);
                }
                Ok(AnthropicSystem::Blocks(blocks))
            }
        }

        deserializer.deserialize_any(SystemVisitor)
    }
}

impl Serialize for AnthropicSystem {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            Self::Text(text) => text.serialize(serializer),
            Self::Blocks(blocks) => blocks.serialize(serializer),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct AnthropicSystemBlock {
    #[serde(rename = "type")]
    pub block_type: String,
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cache_control: Option<Value>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct AnthropicMessage {
    pub role: String,
    pub content: AnthropicMessageContent,
}

#[derive(Clone, Debug, PartialEq)]
pub enum AnthropicMessageContent {
    Text(String),
    Blocks(Vec<AnthropicContentBlock>),
}

impl<'de> Deserialize<'de> for AnthropicMessageContent {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct ContentVisitor;

        impl<'de> serde::de::Visitor<'de> for ContentVisitor {
            type Value = AnthropicMessageContent;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("a string or an array of content blocks")
            }

            fn visit_str<E: serde::de::Error>(
                self,
                value: &str,
            ) -> Result<AnthropicMessageContent, E> {
                Ok(AnthropicMessageContent::Text(value.to_owned()))
            }

            fn visit_seq<A: serde::de::SeqAccess<'de>>(
                self,
                mut seq: A,
            ) -> Result<AnthropicMessageContent, A::Error> {
                let mut blocks = Vec::with_capacity(seq.size_hint().unwrap_or(0));
                while let Some(block) = seq.next_element()? {
                    blocks.push(block);
                }
                Ok(AnthropicMessageContent::Blocks(blocks))
            }
        }

        deserializer.deserialize_any(ContentVisitor)
    }
}

impl Serialize for AnthropicMessageContent {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            Self::Text(text) => text.serialize(serializer),
            Self::Blocks(blocks) => blocks.serialize(serializer),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct ImageSource {
    #[serde(rename = "type")]
    pub source_type: String,
    pub media_type: String,
    pub data: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(tag = "type")]
pub enum AnthropicContentBlock {
    #[serde(rename = "text")]
    Text {
        text: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        cache_control: Option<Value>,
    },
    #[serde(rename = "image")]
    Image {
        source: ImageSource,
        #[serde(skip_serializing_if = "Option::is_none")]
        cache_control: Option<Value>,
    },
    #[serde(rename = "tool_use")]
    ToolUse {
        id: String,
        name: String,
        input: Value,
    },
    #[serde(rename = "tool_result")]
    ToolResult {
        tool_use_id: String,
        content: Value,
        #[serde(skip_serializing_if = "Option::is_none")]
        is_error: Option<bool>,
        #[serde(skip_serializing_if = "Option::is_none")]
        cache_control: Option<Value>,
    },
    #[serde(rename = "thinking")]
    Thinking {
        thinking: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        signature: Option<String>,
    },
    #[serde(rename = "redacted_thinking")]
    RedactedThinking { data: String },
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct AnthropicTool {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub input_schema: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cache_control: Option<Value>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(tag = "type")]
pub enum AnthropicToolChoice {
    #[serde(rename = "auto")]
    Auto,
    #[serde(rename = "any")]
    Any,
    #[serde(rename = "tool")]
    Tool { name: String },
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(tag = "type")]
pub enum AnthropicThinking {
    #[serde(rename = "enabled")]
    Enabled {
        #[serde(skip_serializing_if = "Option::is_none")]
        budget_tokens: Option<u32>,
    },
    #[serde(rename = "disabled")]
    Disabled,
}

// ============================================================================
// Error & Envelope Helpers
// ============================================================================

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AnthropicErrorBody {
    #[serde(rename = "type")]
    pub error_type: String,
    pub message: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AnthropicErrorEnvelope {
    #[serde(rename = "type")]
    pub envelope_type: &'static str,
    pub error: AnthropicErrorBody,
}

pub fn anthropic_error(status: u16, message: impl Into<String>) -> Response {
    let error_type = match status {
        400 | 404 | 409 | 422 => "invalid_request_error",
        401 => "authentication_error",
        403 => "permission_error",
        413 => "request_too_large",
        429 => "rate_limit_error",
        529 => "overloaded_error",
        _ => "api_error",
    };

    let envelope = AnthropicErrorEnvelope {
        envelope_type: "error",
        error: AnthropicErrorBody {
            error_type: error_type.to_owned(),
            message: message.into(),
        },
    };

    let status_code = StatusCode::from_u16(status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
    (status_code, axum::Json(envelope)).into_response()
}

pub fn anthropic_error_event_bytes(error_type: &str, message: &str) -> Bytes {
    let payload = serde_json::json!({
        "type": "error",
        "error": {
            "type": error_type,
            "message": message
        }
    });
    Bytes::from(format!("event: error\ndata: {payload}\n\n"))
}

// ============================================================================
// Translation: Anthropic Request -> OpenAI Request
// ============================================================================

fn map_cache_control(val: Option<Value>) -> Option<CacheControl> {
    val.and_then(|v| {
        let t = v
            .get("type")
            .and_then(|s| s.as_str())
            .unwrap_or("ephemeral");
        Some(CacheControl {
            r#type: t.to_owned(),
        })
    })
}

pub fn anthropic_to_openai_request(req: AnthropicMessageRequest) -> ChatCompletionRequest {
    let mut messages: Vec<ChatMessage> = Vec::new();

    if let Some(system) = req.system {
        match system {
            AnthropicSystem::Text(text) => {
                if !text.is_empty() {
                    messages.push(ChatMessage {
                        role: ChatRole::System,
                        content: ChatContent::Text(text),
                        name: None,
                        tool_calls: None,
                        tool_call_id: None,
                        cache_control: None,
                    });
                }
            }
            AnthropicSystem::Blocks(blocks) => {
                let text = blocks
                    .iter()
                    .filter(|b| b.block_type == "text")
                    .map(|b| b.text.as_str())
                    .collect::<Vec<_>>()
                    .join("\n\n");
                let cache_ctrl = blocks
                    .iter()
                    .find_map(|b| map_cache_control(b.cache_control.clone()));
                if !text.is_empty() {
                    messages.push(ChatMessage {
                        role: ChatRole::System,
                        content: ChatContent::Text(text),
                        name: None,
                        tool_calls: None,
                        tool_call_id: None,
                        cache_control: cache_ctrl,
                    });
                }
            }
        }
    }

    for msg in req.messages {
        match msg.content {
            AnthropicMessageContent::Text(text) => {
                let role = if msg.role == "assistant" {
                    ChatRole::Assistant
                } else {
                    ChatRole::User
                };
                messages.push(ChatMessage {
                    role,
                    content: ChatContent::Text(text),
                    name: None,
                    tool_calls: None,
                    tool_call_id: None,
                    cache_control: None,
                });
            }
            AnthropicMessageContent::Blocks(blocks) => {
                let mut parts: Vec<ContentPart> = Vec::new();
                let mut tool_calls: Vec<ToolCall> = Vec::new();
                let mut tool_results: Vec<(String, String, Option<CacheControl>)> = Vec::new();
                let mut last_cache_ctrl = None;

                for block in blocks {
                    match block {
                        AnthropicContentBlock::Text {
                            text,
                            cache_control,
                        } => {
                            let ctrl = map_cache_control(cache_control);
                            if ctrl.is_some() {
                                last_cache_ctrl = ctrl.clone();
                            }
                            parts.push(ContentPart {
                                kind: ContentPartType::Text,
                                text: Some(text),
                                image_url: None,
                                cache_control: ctrl,
                            });
                        }
                        AnthropicContentBlock::Image {
                            source,
                            cache_control,
                        } => {
                            let ctrl = map_cache_control(cache_control);
                            if ctrl.is_some() {
                                last_cache_ctrl = ctrl.clone();
                            }
                            let url = format!("data:{};base64,{}", source.media_type, source.data);
                            parts.push(ContentPart {
                                kind: ContentPartType::ImageUrl,
                                text: None,
                                image_url: Some(ImageUrl { url, detail: None }),
                                cache_control: ctrl,
                            });
                        }
                        AnthropicContentBlock::ToolUse { id, name, input } => {
                            let args = if let Some(s) = input.as_str() {
                                s.to_owned()
                            } else {
                                serde_json::to_string(&input).unwrap_or_else(|_| "{}".to_owned())
                            };
                            tool_calls.push(ToolCall {
                                id,
                                kind: ToolCallKind::Function,
                                function: ToolCallFunction {
                                    name,
                                    arguments: args,
                                },
                            });
                        }
                        AnthropicContentBlock::ToolResult {
                            tool_use_id,
                            content,
                            cache_control,
                            ..
                        } => {
                            let ctrl = map_cache_control(cache_control);
                            let text = match content {
                                Value::String(s) => s,
                                Value::Array(arr) => arr
                                    .iter()
                                    .map(|item| {
                                        if let Some(t) = item.get("text").and_then(|v| v.as_str()) {
                                            t.to_owned()
                                        } else {
                                            serde_json::to_string(item).unwrap_or_default()
                                        }
                                    })
                                    .collect::<Vec<_>>()
                                    .join("\n"),
                                other => serde_json::to_string(&other).unwrap_or_default(),
                            };
                            tool_results.push((tool_use_id, text, ctrl));
                        }
                        AnthropicContentBlock::Thinking { .. }
                        | AnthropicContentBlock::RedactedThinking { .. } => {}
                    }
                }

                if msg.role == "assistant" {
                    let text = parts
                        .iter()
                        .filter_map(|p| p.text.as_deref())
                        .collect::<Vec<_>>()
                        .join("\n");
                    let content = if text.is_empty() {
                        if !tool_calls.is_empty() {
                            ChatContent::Null
                        } else {
                            ChatContent::Text(String::new())
                        }
                    } else {
                        ChatContent::Text(text)
                    };
                    messages.push(ChatMessage {
                        role: ChatRole::Assistant,
                        content,
                        name: None,
                        tool_calls: if tool_calls.is_empty() {
                            None
                        } else {
                            Some(tool_calls)
                        },
                        tool_call_id: None,
                        cache_control: last_cache_ctrl,
                    });
                } else {
                    for (tool_call_id, result_content, ctrl) in tool_results {
                        messages.push(ChatMessage {
                            role: ChatRole::Tool,
                            content: ChatContent::Text(result_content),
                            name: None,
                            tool_calls: None,
                            tool_call_id: Some(tool_call_id),
                            cache_control: ctrl,
                        });
                    }

                    if parts.len() == 1 && parts[0].kind == ContentPartType::Text {
                        if let Some(txt) = parts.remove(0).text {
                            messages.push(ChatMessage {
                                role: ChatRole::User,
                                content: ChatContent::Text(txt),
                                name: None,
                                tool_calls: None,
                                tool_call_id: None,
                                cache_control: last_cache_ctrl,
                            });
                        }
                    } else if !parts.is_empty() {
                        messages.push(ChatMessage {
                            role: ChatRole::User,
                            content: ChatContent::Parts(parts),
                            name: None,
                            tool_calls: None,
                            tool_call_id: None,
                            cache_control: last_cache_ctrl,
                        });
                    }
                }
            }
        }
    }

    let tools = req.tools.map(|tools_list| {
        tools_list
            .into_iter()
            .map(|t| ToolDefinition {
                kind: ToolKind::Function,
                function: ToolFunction {
                    name: t.name,
                    description: t.description,
                    parameters: Some(t.input_schema),
                },
                cache_control: map_cache_control(t.cache_control),
            })
            .collect()
    });

    let tool_choice = req.tool_choice.map(|tc| match tc {
        AnthropicToolChoice::Auto => ToolChoice::Mode(ToolChoiceMode::Auto),
        AnthropicToolChoice::Any => ToolChoice::Mode(ToolChoiceMode::Required),
        AnthropicToolChoice::Tool { name } => ToolChoice::Named(ToolChoiceNamed {
            function: ToolChoiceFunction { name },
        }),
    });

    let (reasoning_effort, thinking) = match &req.thinking {
        Some(AnthropicThinking::Disabled) => (
            Some("none".to_owned()),
            Some(Thinking::Config(ThinkingConfig {
                kind: Some(ThinkingType::Disabled),
                budget_tokens: None,
            })),
        ),
        Some(AnthropicThinking::Enabled { budget_tokens }) => (
            Some("high".to_owned()),
            Some(Thinking::Config(ThinkingConfig {
                kind: Some(ThinkingType::Enabled),
                budget_tokens: *budget_tokens,
            })),
        ),
        None => (None, None),
    };

    ChatCompletionRequest {
        model: req.model,
        messages,
        stream: req.stream,
        stream_options: None,
        temperature: req.temperature,
        top_p: req.top_p,
        n: None,
        stop: req.stop_sequences.map(StopSequence::List),
        max_tokens: req.max_tokens,
        presence_penalty: None,
        frequency_penalty: None,
        user: None,
        tools,
        tool_choice,
        response_format: None,
        reasoning_effort,
        reasoning: None,
        thinking,
        enable_thinking: None,
        thinking_budget: None,
        prompt_cache_key: None,
        prompt_cache_retention: None,
    }
}

// ============================================================================
// Translation: OpenAI Response -> Anthropic Response
// ============================================================================

pub fn openai_to_anthropic_response(
    res: &Value,
    original_model: &str,
    allow_thinking: bool,
) -> Value {
    let choice = res.get("choices").and_then(|c| c.get(0));
    let mut content_blocks: Vec<Value> = Vec::new();

    if let Some(msg) = choice.and_then(|c| c.get("message")) {
        let reasoning = msg
            .get("reasoning_content")
            .or_else(|| msg.get("reasoning"))
            .or_else(|| msg.get("thought"))
            .and_then(|v| v.as_str());

        if let Some(r) = reasoning {
            if allow_thinking && !r.is_empty() {
                content_blocks.push(serde_json::json!({
                    "type": "thinking",
                    "thinking": r
                }));
            }
        }

        if let Some(content) = msg.get("content") {
            if let Some(text) = content.as_str() {
                if !text.is_empty() {
                    content_blocks.push(serde_json::json!({
                        "type": "text",
                        "text": text
                    }));
                }
            } else if let Some(arr) = content.as_array() {
                for item in arr {
                    if item.get("type").and_then(|t| t.as_str()) == Some("text") {
                        if let Some(text) = item.get("text").and_then(|t| t.as_str()) {
                            content_blocks.push(serde_json::json!({
                                "type": "text",
                                "text": text
                            }));
                        }
                    }
                }
            }
        }

        if let Some(tool_calls) = msg.get("tool_calls").and_then(|tc| tc.as_array()) {
            for tc in tool_calls {
                let id = tc.get("id").and_then(|v| v.as_str()).unwrap_or("");
                let name = tc
                    .get("function")
                    .and_then(|f| f.get("name"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let args_str = tc
                    .get("function")
                    .and_then(|f| f.get("arguments"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("{}");
                let input: Value = serde_json::from_str(args_str)
                    .unwrap_or_else(|_| serde_json::json!({ "raw": args_str }));

                content_blocks.push(serde_json::json!({
                    "type": "tool_use",
                    "id": id,
                    "name": name,
                    "input": input
                }));
            }
        }
    }

    let finish_reason = choice
        .and_then(|c| c.get("finish_reason"))
        .and_then(|v| v.as_str());
    let stop_reason = match finish_reason {
        Some("tool_calls") | Some("function_call") => "tool_use",
        Some("length") => "max_tokens",
        Some("stop_sequence") => "stop_sequence",
        _ => "end_turn",
    };

    let msg_id = res
        .get("id")
        .and_then(|v| v.as_str())
        .map(|id| {
            if let Some(rest) = id.strip_prefix("chatcmpl-") {
                format!("msg_{rest}")
            } else {
                format!("msg_{id}")
            }
        })
        .unwrap_or_else(|| generate_id("msg"));

    let usage = res.get("usage");
    let input_tokens = usage
        .and_then(|u| u.get("prompt_tokens"))
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let output_tokens = usage
        .and_then(|u| u.get("completion_tokens"))
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let cache_read = usage
        .and_then(|u| u.get("prompt_tokens_details"))
        .and_then(|d| d.get("cached_tokens"))
        .or_else(|| usage.and_then(|u| u.get("cached_tokens")))
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let cache_creation = usage
        .and_then(|u| u.get("cache_creation_tokens"))
        .and_then(|v| v.as_u64())
        .unwrap_or(0);

    serde_json::json!({
        "id": msg_id,
        "type": "message",
        "role": "assistant",
        "model": original_model,
        "content": content_blocks,
        "stop_reason": stop_reason,
        "stop_sequence": serde_json::Value::Null,
        "usage": {
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "cache_creation_input_tokens": cache_creation,
            "cache_read_input_tokens": cache_read
        }
    })
}

// ============================================================================
// Streaming: Anthropic SSE Stream Translator
// ============================================================================

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum BlockType {
    None,
    Thinking,
    Text,
    ToolUse(usize),
}

#[derive(Clone, Debug)]
#[allow(dead_code)]
struct ToolTracker {
    anthropic_index: i32,
    id: String,
    name: String,
}

pub struct AnthropicStreamTranslator {
    original_model: String,
    message_id: String,
    allow_thinking: bool,
    has_started: bool,
    current_block_index: i32,
    current_block_type: BlockType,
    tool_map: std::collections::BTreeMap<usize, ToolTracker>,
    finish_reason: Option<String>,
    output_tokens_count: usize,
    input_tokens: usize,
    cache_creation_tokens: usize,
    cache_read_tokens: usize,
}

impl AnthropicStreamTranslator {
    pub fn new(original_model: impl Into<String>, allow_thinking: bool) -> Self {
        Self {
            original_model: original_model.into(),
            message_id: generate_id("msg"),
            allow_thinking,
            has_started: false,
            current_block_index: -1,
            current_block_type: BlockType::None,
            tool_map: std::collections::BTreeMap::new(),
            finish_reason: None,
            output_tokens_count: 0,
            input_tokens: 0,
            cache_creation_tokens: 0,
            cache_read_tokens: 0,
        }
    }

    fn sse_event(event_name: &str, data: &Value) -> Bytes {
        let payload = serde_json::to_string(data).unwrap_or_default();
        Bytes::from(format!("event: {event_name}\ndata: {payload}\n\n"))
    }

    pub fn feed_chunk(&mut self, chunk: &Value) -> Vec<Bytes> {
        let mut events = Vec::new();

        if let Some(usage) = chunk.get("usage") {
            if let Some(n) = usage.get("prompt_tokens").and_then(|v| v.as_u64()) {
                self.input_tokens = n as usize;
            }
            if let Some(n) = usage.get("completion_tokens").and_then(|v| v.as_u64()) {
                self.output_tokens_count = n as usize;
            }
            if let Some(n) = usage
                .get("prompt_tokens_details")
                .and_then(|d| d.get("cached_tokens"))
                .or_else(|| usage.get("cached_tokens"))
                .and_then(|v| v.as_u64())
            {
                self.cache_read_tokens = n as usize;
            }
            if let Some(n) = usage.get("cache_creation_tokens").and_then(|v| v.as_u64()) {
                self.cache_creation_tokens = n as usize;
            }
        }

        if !self.has_started {
            self.has_started = true;
            events.push(Self::sse_event(
                "message_start",
                &serde_json::json!({
                    "type": "message_start",
                    "message": {
                        "id": self.message_id,
                        "type": "message",
                        "role": "assistant",
                        "model": self.original_model,
                        "content": [],
                        "stop_reason": serde_json::Value::Null,
                        "stop_sequence": serde_json::Value::Null,
                        "usage": {
                            "input_tokens": self.input_tokens,
                            "output_tokens": 1,
                            "cache_creation_input_tokens": self.cache_creation_tokens,
                            "cache_read_input_tokens": self.cache_read_tokens
                        }
                    }
                }),
            ));
        }

        let choice = chunk.get("choices").and_then(|c| c.get(0));
        let Some(choice) = choice else {
            return events;
        };

        if let Some(fr) = choice.get("finish_reason").and_then(|v| v.as_str()) {
            self.finish_reason = Some(fr.to_owned());
        }

        let delta = choice.get("delta");
        let Some(delta) = delta else {
            return events;
        };

        // 1. Thinking delta
        let reasoning = delta
            .get("reasoning_content")
            .or_else(|| delta.get("reasoning"))
            .or_else(|| delta.get("thought"))
            .and_then(|v| v.as_str());

        if let Some(r) = reasoning {
            if self.allow_thinking && !r.is_empty() {
                if self.current_block_type != BlockType::Thinking {
                    if self.current_block_type != BlockType::None {
                        events.push(Self::sse_event(
                            "content_block_stop",
                            &serde_json::json!({
                                "type": "content_block_stop",
                                "index": self.current_block_index
                            }),
                        ));
                    }
                    self.current_block_index += 1;
                    self.current_block_type = BlockType::Thinking;
                    events.push(Self::sse_event(
                        "content_block_start",
                        &serde_json::json!({
                            "type": "content_block_start",
                            "index": self.current_block_index,
                            "content_block": {
                                "type": "thinking",
                                "thinking": ""
                            }
                        }),
                    ));
                }
                self.output_tokens_count += 1;
                events.push(Self::sse_event(
                    "content_block_delta",
                    &serde_json::json!({
                        "type": "content_block_delta",
                        "index": self.current_block_index,
                        "delta": {
                            "type": "thinking_delta",
                            "thinking": r
                        }
                    }),
                ));
            }
        }

        // 2. Text delta
        if let Some(content) = delta.get("content").and_then(|v| v.as_str()) {
            if !content.is_empty() {
                if self.current_block_type != BlockType::Text {
                    if self.current_block_type != BlockType::None {
                        events.push(Self::sse_event(
                            "content_block_stop",
                            &serde_json::json!({
                                "type": "content_block_stop",
                                "index": self.current_block_index
                            }),
                        ));
                    }
                    self.current_block_index += 1;
                    self.current_block_type = BlockType::Text;
                    events.push(Self::sse_event(
                        "content_block_start",
                        &serde_json::json!({
                            "type": "content_block_start",
                            "index": self.current_block_index,
                            "content_block": {
                                "type": "text",
                                "text": ""
                            }
                        }),
                    ));
                }
                self.output_tokens_count += 1;
                events.push(Self::sse_event(
                    "content_block_delta",
                    &serde_json::json!({
                        "type": "content_block_delta",
                        "index": self.current_block_index,
                        "delta": {
                            "type": "text_delta",
                            "text": content
                        }
                    }),
                ));
            }
        }

        // 3. Tool calls delta
        if let Some(tool_calls) = delta.get("tool_calls").and_then(|v| v.as_array()) {
            for tc in tool_calls {
                let chunk_idx = tc.get("index").and_then(|v| v.as_u64()).unwrap_or(0) as usize;
                let existing = self.tool_map.get(&chunk_idx);

                let anthropic_idx = if let Some(tracker) = existing {
                    tracker.anthropic_index
                } else {
                    if self.current_block_type != BlockType::None {
                        events.push(Self::sse_event(
                            "content_block_stop",
                            &serde_json::json!({
                                "type": "content_block_stop",
                                "index": self.current_block_index
                            }),
                        ));
                    }
                    self.current_block_index += 1;
                    self.current_block_type = BlockType::ToolUse(chunk_idx);
                    let id = tc
                        .get("id")
                        .and_then(|v| v.as_str())
                        .map(str::to_owned)
                        .unwrap_or_else(|| generate_id("toolu"));
                    let name = tc
                        .get("function")
                        .and_then(|f| f.get("name"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_owned();
                    self.tool_map.insert(
                        chunk_idx,
                        ToolTracker {
                            anthropic_index: self.current_block_index,
                            id: id.clone(),
                            name: name.clone(),
                        },
                    );
                    events.push(Self::sse_event(
                        "content_block_start",
                        &serde_json::json!({
                            "type": "content_block_start",
                            "index": self.current_block_index,
                            "content_block": {
                                "type": "tool_use",
                                "id": id,
                                "name": name,
                                "input": {}
                            }
                        }),
                    ));
                    self.current_block_index
                };

                if let Some(args) = tc
                    .get("function")
                    .and_then(|f| f.get("arguments"))
                    .and_then(|v| v.as_str())
                {
                    if !args.is_empty() {
                        self.output_tokens_count += 1;
                        events.push(Self::sse_event(
                            "content_block_delta",
                            &serde_json::json!({
                                "type": "content_block_delta",
                                "index": anthropic_idx,
                                "delta": {
                                    "type": "input_json_delta",
                                    "partial_json": args
                                }
                            }),
                        ));
                    }
                }
            }
        }

        events
    }

    pub fn finish(&mut self) -> Vec<Bytes> {
        let mut events = Vec::new();

        if !self.has_started {
            events.push(Self::sse_event(
                "message_start",
                &serde_json::json!({
                    "type": "message_start",
                    "message": {
                        "id": self.message_id,
                        "type": "message",
                        "role": "assistant",
                        "model": self.original_model,
                        "content": [],
                        "stop_reason": serde_json::Value::Null,
                        "stop_sequence": serde_json::Value::Null,
                        "usage": {
                            "input_tokens": self.input_tokens,
                            "output_tokens": 1,
                            "cache_creation_input_tokens": self.cache_creation_tokens,
                            "cache_read_input_tokens": self.cache_read_tokens
                        }
                    }
                }),
            ));
        }

        if self.current_block_type != BlockType::None {
            events.push(Self::sse_event(
                "content_block_stop",
                &serde_json::json!({
                    "type": "content_block_stop",
                    "index": self.current_block_index
                }),
            ));
        }

        let stop_reason = match self.finish_reason.as_deref() {
            Some("tool_calls") | Some("function_call") => "tool_use",
            Some("length") => "max_tokens",
            Some("stop_sequence") => "stop_sequence",
            _ => "end_turn",
        };

        events.push(Self::sse_event(
            "message_delta",
            &serde_json::json!({
                "type": "message_delta",
                "delta": {
                    "stop_reason": stop_reason,
                    "stop_sequence": serde_json::Value::Null
                },
                "usage": {
                    "output_tokens": self.output_tokens_count.max(1)
                }
            }),
        ));

        events.push(Self::sse_event(
            "message_stop",
            &serde_json::json!({
                "type": "message_stop"
            }),
        ));

        events
    }
}

// ============================================================================
// Token Counting Helper
// ============================================================================

pub fn estimate_tokens(req: &AnthropicMessageRequest) -> usize {
    let mut count = 0;

    if let Some(system) = &req.system {
        match system {
            AnthropicSystem::Text(text) => {
                count += (text.chars().count() + 3) / 4;
            }
            AnthropicSystem::Blocks(blocks) => {
                for b in blocks {
                    count += (b.text.chars().count() + 3) / 4;
                }
            }
        }
    }

    for msg in &req.messages {
        count += 4;
        match &msg.content {
            AnthropicMessageContent::Text(text) => {
                count += (text.chars().count() + 3) / 4;
            }
            AnthropicMessageContent::Blocks(blocks) => {
                for block in blocks {
                    match block {
                        AnthropicContentBlock::Text { text, .. } => {
                            count += (text.chars().count() + 3) / 4;
                        }
                        AnthropicContentBlock::Image { .. } => {
                            count += 1600;
                        }
                        AnthropicContentBlock::ToolUse { name, input, .. } => {
                            let input_len =
                                serde_json::to_string(input).map(|s| s.len()).unwrap_or(0);
                            count += (name.len() + input_len + 3) / 4;
                        }
                        AnthropicContentBlock::ToolResult { content, .. } => {
                            let text_len = match content {
                                Value::String(s) => s.len(),
                                other => serde_json::to_string(other).map(|s| s.len()).unwrap_or(0),
                            };
                            count += (text_len + 3) / 4;
                        }
                        AnthropicContentBlock::Thinking { thinking, .. } => {
                            count += (thinking.chars().count() + 3) / 4;
                        }
                        AnthropicContentBlock::RedactedThinking { data } => {
                            count += (data.len() + 3) / 4;
                        }
                    }
                }
            }
        }
    }

    if let Some(tools) = &req.tools {
        for t in tools {
            count += 20;
            let schema_len = serde_json::to_string(&t.input_schema)
                .map(|s| s.len())
                .unwrap_or(0);
            count +=
                (t.name.len() + t.description.as_deref().unwrap_or("").len() + schema_len + 3) / 4;
        }
    }

    count.max(1)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_anthropic_system_and_messages_to_openai() {
        let req = AnthropicMessageRequest {
            model: "claude-3-7-sonnet-20250219".to_owned(),
            messages: vec![
                AnthropicMessage {
                    role: "user".to_owned(),
                    content: AnthropicMessageContent::Text("Hello Claude".to_owned()),
                },
                AnthropicMessage {
                    role: "assistant".to_owned(),
                    content: AnthropicMessageContent::Blocks(vec![AnthropicContentBlock::Text {
                        text: "Hi user".to_owned(),
                        cache_control: None,
                    }]),
                },
            ],
            system: Some(AnthropicSystem::Text("You are an assistant".to_owned())),
            max_tokens: Some(1024),
            temperature: Some(0.7),
            top_p: Some(0.9),
            top_k: None,
            stop_sequences: Some(vec!["STOP".to_owned()]),
            stream: false,
            tools: None,
            tool_choice: None,
            thinking: None,
            metadata: None,
        };

        let openai_req = anthropic_to_openai_request(req);
        assert_eq!(openai_req.model, "claude-3-7-sonnet-20250219");
        assert_eq!(openai_req.messages.len(), 3);
        assert_eq!(openai_req.messages[0].role, ChatRole::System);
        assert_eq!(openai_req.messages[1].role, ChatRole::User);
        assert_eq!(openai_req.messages[2].role, ChatRole::Assistant);
        assert_eq!(openai_req.max_tokens, Some(1024));
    }

    #[test]
    fn maps_tool_use_and_tool_result() {
        let req = AnthropicMessageRequest {
            model: "claude-3-7-sonnet-20250219".to_owned(),
            messages: vec![
                AnthropicMessage {
                    role: "assistant".to_owned(),
                    content: AnthropicMessageContent::Blocks(vec![
                        AnthropicContentBlock::ToolUse {
                            id: "call_abc".to_owned(),
                            name: "bash".to_owned(),
                            input: serde_json::json!({ "command": "ls" }),
                        },
                    ]),
                },
                AnthropicMessage {
                    role: "user".to_owned(),
                    content: AnthropicMessageContent::Blocks(vec![
                        AnthropicContentBlock::ToolResult {
                            tool_use_id: "call_abc".to_owned(),
                            content: serde_json::json!("file.txt"),
                            is_error: None,
                            cache_control: None,
                        },
                        AnthropicContentBlock::Text {
                            text: "done".to_owned(),
                            cache_control: None,
                        },
                    ]),
                },
            ],
            system: None,
            max_tokens: None,
            temperature: None,
            top_p: None,
            top_k: None,
            stop_sequences: None,
            stream: false,
            tools: Some(vec![AnthropicTool {
                name: "bash".to_owned(),
                description: Some("runs bash".to_owned()),
                input_schema: serde_json::json!({ "type": "object" }),
                cache_control: None,
            }]),
            tool_choice: Some(AnthropicToolChoice::Auto),
            thinking: None,
            metadata: None,
        };

        let openai_req = anthropic_to_openai_request(req);
        assert_eq!(openai_req.messages.len(), 3);
        assert_eq!(openai_req.messages[0].role, ChatRole::Assistant);
        assert!(openai_req.messages[0].tool_calls.is_some());
        assert_eq!(openai_req.messages[1].role, ChatRole::Tool);
        assert_eq!(
            openai_req.messages[1].tool_call_id.as_deref(),
            Some("call_abc")
        );
        assert_eq!(openai_req.messages[2].role, ChatRole::User);
        assert!(openai_req.tools.is_some());
    }

    #[test]
    fn translates_openai_response_to_anthropic() {
        let openai_res = serde_json::json!({
            "id": "chatcmpl-test-123",
            "choices": [
                {
                    "index": 0,
                    "message": {
                        "role": "assistant",
                        "content": "Hello Anthropic!"
                    },
                    "finish_reason": "stop"
                }
            ],
            "usage": {
                "prompt_tokens": 10,
                "completion_tokens": 5,
                "total_tokens": 15
            }
        });

        let ant_res = openai_to_anthropic_response(&openai_res, "claude-3-7-sonnet", false);
        assert_eq!(ant_res["type"], "message");
        assert_eq!(ant_res["id"], "msg_test-123");
        assert_eq!(ant_res["role"], "assistant");
        assert_eq!(ant_res["stop_reason"], "end_turn");
        assert_eq!(ant_res["content"][0]["text"], "Hello Anthropic!");
        assert_eq!(ant_res["usage"]["input_tokens"], 10);
        assert_eq!(ant_res["usage"]["output_tokens"], 5);
    }

    #[test]
    fn stream_translator_emits_expected_events() {
        let mut translator = AnthropicStreamTranslator::new("claude-3-7-sonnet", false);

        let chunk1 = serde_json::json!({
            "choices": [{
                "index": 0,
                "delta": { "content": "Hello " },
                "finish_reason": null
            }]
        });
        let events1 = translator.feed_chunk(&chunk1);
        let sse1 = String::from_utf8(events1.concat()).unwrap();
        assert!(sse1.contains("event: message_start"));
        assert!(sse1.contains("event: content_block_start"));
        assert!(sse1.contains("event: content_block_delta"));
        assert!(sse1.contains("Hello "));

        let chunk2 = serde_json::json!({
            "choices": [{
                "index": 0,
                "delta": { "content": "World!" },
                "finish_reason": "stop"
            }]
        });
        let events2 = translator.feed_chunk(&chunk2);
        let sse2 = String::from_utf8(events2.concat()).unwrap();
        assert!(sse2.contains("event: content_block_delta"));
        assert!(sse2.contains("World!"));

        let finish_events = translator.finish();
        let sse_finish = String::from_utf8(finish_events.concat()).unwrap();
        assert!(sse_finish.contains("event: content_block_stop"));
        assert!(sse_finish.contains("event: message_delta"));
        assert!(sse_finish.contains("event: message_stop"));
        assert!(sse_finish.contains("end_turn"));
    }
}
