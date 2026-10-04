//! OpenAI ⇄ Anthropic protocol translation (`translation.rs` per the migration
//! plan, Task 9: this module owns the contract translation).
//!
//! Three parts: the Anthropic Messages wire types and validation, the pure
//! request/response converters onto the internal OpenAI-compatible types, and
//! the streaming SSE translator. Validation wording and every mapping rule are
//! frozen against `apps/api` (`MessagesController` + `@srouter/translator`),
//! probed black-box because the Node schema lives in `packages/*` and cannot
//! be read.
//!
//! Recorded deviation: an upstream tool call without a `name` translates to
//! `name: ""` and the request still succeeds; Node crashes with a `500` on the
//! same payload, and reproducing a crash is not a contract.

use axum::body::Bytes;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::constants;

use crate::features::gateway::model::{
    ChatCompletionRequest, ChatContent, ChatMessage, ChatRole, ContentPart, ContentPartType,
    ImageUrl, ReasoningOptions, StopSequence, ToolCall, ToolCallFunction, ToolCallKind, ToolChoice,
    ToolChoiceFunction, ToolChoiceMode, ToolChoiceNamed, ToolDefinition, ToolFunction, ToolKind,
};

/// Generates an Anthropic-formatted identifier (e.g. `msg_...` or `toolu_...`).
pub fn generate_id(prefix: &str) -> String {
    let mut bytes = [0u8; 12];
    let _ = getrandom::fill(&mut bytes);
    format!("{prefix}_{}", hex::encode(bytes))
}

/// The `call_<8 hex>` id Node mints for a `tool_use` block that arrived
/// without one (probed: `call_f7d3e216`).
fn generate_call_id() -> String {
    let mut bytes = [0u8; 4];
    let _ = getrandom::fill(&mut bytes);
    format!("call_{}", hex::encode(bytes))
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
    #[serde(default)]
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
        #[serde(default)]
        text: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        cache_control: Option<Value>,
    },
    #[serde(rename = "image")]
    Image {
        /// Absent sources pass validation in Node and the whole block is
        /// dropped during translation.
        source: Option<ImageSource>,
        #[serde(skip_serializing_if = "Option::is_none")]
        cache_control: Option<Value>,
    },
    #[serde(rename = "tool_use")]
    ToolUse {
        #[serde(default)]
        id: String,
        #[serde(default)]
        name: String,
        #[serde(default = "empty_object")]
        input: Value,
    },
    #[serde(rename = "tool_result")]
    ToolResult {
        #[serde(default)]
        tool_use_id: String,
        /// `None` (absent on the wire) becomes an empty tool result.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        content: Option<Value>,
        #[serde(skip_serializing_if = "Option::is_none")]
        is_error: Option<bool>,
        #[serde(skip_serializing_if = "Option::is_none")]
        cache_control: Option<Value>,
    },
    #[serde(rename = "thinking")]
    Thinking {
        #[serde(default)]
        thinking: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        signature: Option<String>,
    },
    #[serde(rename = "redacted_thinking")]
    RedactedThinking {
        #[serde(default)]
        data: String,
    },
}

fn empty_object() -> Value {
    serde_json::json!({})
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
    Tool {
        /// Node accepts a `tool` selector without a name and then drops the
        /// whole `tool_choice` during translation.
        #[serde(skip_serializing_if = "Option::is_none")]
        name: Option<String>,
    },
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(tag = "type")]
pub enum AnthropicThinking {
    #[serde(rename = "enabled")]
    Enabled {
        #[serde(skip_serializing_if = "Option::is_none")]
        budget_tokens: Option<i64>,
    },
    /// Accepted by the Node schema and mapped like `enabled`; `budget_tokens`
    /// is validated but never forwarded (Node drops it too).
    #[serde(rename = "adaptive")]
    Adaptive {
        #[serde(skip_serializing_if = "Option::is_none")]
        budget_tokens: Option<i64>,
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

/// Node's `GetErrorTypeFromStatus` for the Anthropic envelope. It has no
/// `413`/`529` special cases, so neither does this map.
pub fn anthropic_error_type(status: u16) -> &'static str {
    match status {
        400 | 404 | 409 | 422 => "invalid_request_error",
        401 => "authentication_error",
        403 => "permission_error",
        429 => "rate_limit_error",
        _ => "api_error",
    }
}

pub fn anthropic_error(status: u16, message: impl Into<String>) -> Response {
    anthropic_error_typed(status, anthropic_error_type(status), message)
}

/// Renders an envelope with an explicit error type. The route's own body
/// limit pins `invalid_request_error` for `413`, the one case Node passes
/// by hand (`MessagesController`), while an upstream `413` would still map
/// to `api_error` through [`anthropic_error_type`].
pub fn anthropic_error_typed(
    status: u16,
    error_type: &'static str,
    message: impl Into<String>,
) -> Response {
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

pub fn anthropic_to_openai_request(req: AnthropicMessageRequest) -> ChatCompletionRequest {
    let mut messages: Vec<ChatMessage> = Vec::new();

    // Node joins the system blocks and drops their `cache_control`, exactly
    // like every other block marker: none of the executors read them and the
    // OpenAI upstreams have no such concept.
    if let Some(system) = req.system {
        let text = match system {
            AnthropicSystem::Text(text) => text,
            AnthropicSystem::Blocks(blocks) => blocks
                .iter()
                .filter(|b| b.block_type == "text")
                .map(|b| b.text.as_str())
                .collect::<Vec<_>>()
                .join("\n\n"),
        };
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

    for msg in req.messages {
        match msg.content {
            AnthropicMessageContent::Text(text) => {
                // Node passes `system` through for string content, but its
                // block branch folds a system role into `user`; only the
                // string arm keeps the role (probed both ways).
                let role = match msg.role.as_str() {
                    "assistant" => ChatRole::Assistant,
                    "system" => ChatRole::System,
                    _ => ChatRole::User,
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
                let mut tool_results: Vec<(String, String)> = Vec::new();

                for block in blocks {
                    match block {
                        AnthropicContentBlock::Text { text, .. } => {
                            // Empty and absent text blocks produce no part:
                            // a user message whose parts end up empty is
                            // dropped entirely (probed).
                            if !text.is_empty() {
                                parts.push(ContentPart {
                                    kind: ContentPartType::Text,
                                    text: Some(text),
                                    image_url: None,
                                    cache_control: None,
                                });
                            }
                        }
                        AnthropicContentBlock::Image { source, .. } => {
                            if let Some(source) = source {
                                let url =
                                    format!("data:{};base64,{}", source.media_type, source.data);
                                parts.push(ContentPart {
                                    kind: ContentPartType::ImageUrl,
                                    text: None,
                                    image_url: Some(ImageUrl { url, detail: None }),
                                    cache_control: None,
                                });
                            }
                        }
                        AnthropicContentBlock::ToolUse { id, name, input } => {
                            let args = if let Some(s) = input.as_str() {
                                s.to_owned()
                            } else {
                                serde_json::to_string(&input).unwrap_or_else(|_| "{}".to_owned())
                            };
                            tool_calls.push(ToolCall {
                                id: if id.is_empty() {
                                    generate_call_id()
                                } else {
                                    id
                                },
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
                            ..
                        } => {
                            let text = match content {
                                None => String::new(),
                                Some(Value::String(s)) => s,
                                Some(Value::Array(arr)) => arr
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
                                Some(other) => serde_json::to_string(&other).unwrap_or_default(),
                            };
                            tool_results.push((tool_use_id, text));
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
                        cache_control: None,
                    });
                } else {
                    for (tool_call_id, result_content) in tool_results {
                        messages.push(ChatMessage {
                            role: ChatRole::Tool,
                            content: ChatContent::Text(result_content),
                            name: None,
                            tool_calls: None,
                            // A tool_result without an id sends no
                            // `tool_call_id` key at all (probed).
                            tool_call_id: (!tool_call_id.is_empty()).then_some(tool_call_id),
                            cache_control: None,
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
                                cache_control: None,
                            });
                        }
                    } else if !parts.is_empty() {
                        messages.push(ChatMessage {
                            role: ChatRole::User,
                            content: ChatContent::Parts(parts),
                            name: None,
                            tool_calls: None,
                            tool_call_id: None,
                            cache_control: None,
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
                cache_control: None,
            })
            .collect()
    });

    // `any` becomes `required`; a named selector without a name is dropped
    // entirely (probed: Node sends no `tool_choice` key at all).
    let tool_choice = req.tool_choice.and_then(|tc| match tc {
        AnthropicToolChoice::Auto => Some(ToolChoice::Mode(ToolChoiceMode::Auto)),
        AnthropicToolChoice::Any => Some(ToolChoice::Mode(ToolChoiceMode::Required)),
        AnthropicToolChoice::Tool { name } => name.filter(|n| !n.is_empty()).map(|name| {
            ToolChoice::Named(ToolChoiceNamed {
                kind: ToolKind::Function,
                function: ToolChoiceFunction { name },
            })
        }),
    });

    // Node's split shapes: `disabled` sends top-level `reasoning_effort:
    // "none"`, `enabled`/`adaptive` send `reasoning: {effort: "high"}`,
    // `budget_tokens` is never forwarded, and no `thinking` key ever leaves
    // the gateway (all probed).
    let (reasoning_effort, reasoning) = match &req.thinking {
        Some(AnthropicThinking::Disabled) => (Some("none".to_owned()), None),
        Some(AnthropicThinking::Enabled { .. }) | Some(AnthropicThinking::Adaptive { .. }) => (
            None,
            Some(ReasoningOptions {
                effort: Some("high".to_owned()),
                summary: None,
            }),
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
        reasoning,
        thinking: None,
        enable_thinking: None,
        thinking_budget: None,
        prompt_cache_key: None,
        prompt_cache_retention: None,
    }
}

// Request validation: the observable `AnthropicMessageRequestSchema` rules,
// probed black-box through `apps/api`. Returns the first failure in schema
// order, the same string `MessagesController` puts in the envelope.
//
// Message content, system, and tool_result content are unions on the Node
// side, so every type failure inside them collapses to `Invalid input`;
// top-level scalar fields keep their specific `Expected ..., received ...`
// messages (both shapes probed).

fn received(value: &Value) -> &'static str {
    match value {
        Value::Null => "null",
        Value::Bool(_) => "boolean",
        Value::Number(_) => "number",
        Value::String(_) => "string",
        Value::Array(_) => "array",
        Value::Object(_) => "object",
    }
}

fn expected_type(value: &Value, expected: &str) -> String {
    constants::gateway::anthropic::expected(expected, received(value))
}

fn check_string(value: &Value) -> Result<(), String> {
    if value.is_string() {
        Ok(())
    } else {
        Err(expected_type(value, "string"))
    }
}

fn check_boolean(value: &Value) -> Result<(), String> {
    if value.is_boolean() {
        Ok(())
    } else {
        Err(expected_type(value, "boolean"))
    }
}

fn check_number(value: &Value) -> Result<(), String> {
    if value.is_number() {
        Ok(())
    } else {
        Err(expected_type(value, "number"))
    }
}

fn check_integer(value: &Value) -> Result<(), String> {
    check_number(value)?;
    if value.as_f64().is_some_and(|number| number.fract() == 0.0) {
        Ok(())
    } else {
        Err(constants::gateway::anthropic::expected("integer", "float"))
    }
}

fn check_object(value: &Value) -> Result<(), String> {
    if value.is_object() {
        Ok(())
    } else {
        Err(expected_type(value, "object"))
    }
}

fn check_array(value: &Value) -> Result<(), String> {
    if value.is_array() {
        Ok(())
    } else {
        Err(expected_type(value, "array"))
    }
}

fn check_enum(value: &Value, allowed: &str, variants: &[&str]) -> Result<(), String> {
    match value.as_str() {
        Some(candidate) if variants.contains(&candidate) => Ok(()),
        // A wrong string carries the `Invalid enum value.` prefix; a
        // non-string is a plain type error (probed for `role`).
        Some(candidate) => Err(constants::gateway::anthropic::enum_value(
            allowed,
            &format!("'{candidate}'"),
        )),
        None => Err(constants::gateway::anthropic::expected(
            allowed,
            received(value),
        )),
    }
}

fn check_max_tokens(value: &Value) -> Result<(), String> {
    check_integer(value)?;
    let number = value.as_f64().expect("checked number");
    if number < 1.0 {
        return Err(constants::gateway::anthropic::NUMBER_GREATER_THAN_ZERO.to_owned());
    }
    if number > 1_000_000.0 {
        return Err(constants::gateway::schema::MAX_TOKENS_ABOVE_CAP.to_owned());
    }
    Ok(())
}

fn check_unit_interval(value: &Value) -> Result<(), String> {
    check_number(value)?;
    let number = value.as_f64().expect("checked number");
    if number < 0.0 {
        return Err(constants::gateway::anthropic::NUMBER_AT_LEAST_ZERO.to_owned());
    }
    if number > 1.0 {
        return Err(constants::gateway::anthropic::NUMBER_AT_MOST_ONE.to_owned());
    }
    Ok(())
}

fn check_positive_integer(value: &Value) -> Result<(), String> {
    check_integer(value)?;
    if value.as_f64().expect("checked number") < 1.0 {
        return Err(constants::gateway::anthropic::NUMBER_GREATER_THAN_ZERO.to_owned());
    }
    Ok(())
}

fn check_optional(
    object: &serde_json::Map<String, Value>,
    key: &str,
    check: impl Fn(&Value) -> Result<(), String>,
) -> Result<(), String> {
    match object.get(key) {
        Some(value) => check(value),
        None => Ok(()),
    }
}

fn validate_image_source(source: &Value) -> Result<(), String> {
    check_object(source)?;
    let source = source.as_object().expect("checked object");
    match source.get("type").and_then(Value::as_str) {
        Some("base64") => {}
        _ => return Err(constants::gateway::anthropic::INVALID_INPUT.to_owned()),
    }
    check_string(source.get("media_type").unwrap_or(&Value::Null))?;
    check_string(source.get("data").unwrap_or(&Value::Null))
}

fn validate_content_blocks(blocks: &[Value]) -> Result<(), String> {
    let invalid = || constants::gateway::anthropic::INVALID_INPUT.to_owned();
    for block in blocks {
        content_block_fields(block).map_err(|_| invalid())?;
    }
    Ok(())
}

/// Field checks for one content block. Callers map every error to the union's
/// `Invalid input`; only the shape (object + known `type`) is checked here.
fn content_block_fields(block: &Value) -> Result<(), String> {
    let invalid = || constants::gateway::anthropic::INVALID_INPUT.to_owned();
    let Some(object) = block.as_object() else {
        return Err(invalid());
    };
    let Some(kind) = object.get("type").and_then(Value::as_str) else {
        return Err(invalid());
    };
    match kind {
        "text" => {
            if let Some(text) = object.get("text") {
                check_string(text)?;
            }
        }
        "image" => {
            if let Some(source) = object.get("source") {
                validate_image_source(source)?;
            }
        }
        "tool_use" => {
            check_optional(object, "id", check_string)?;
            check_optional(object, "name", check_string)?;
            check_optional(object, "input", check_object)?;
        }
        "tool_result" => {
            check_optional(object, "tool_use_id", check_string)?;
            if let Some(content) = object.get("content") {
                if content.is_string() {
                    // A string result needs no further checks.
                } else {
                    check_array(content)?;
                    for item in content.as_array().expect("checked array") {
                        let Some(item) = item.as_object() else {
                            return Err(invalid());
                        };
                        if let Some(text) = item.get("text") {
                            check_string(text)?;
                        }
                    }
                }
            }
            check_optional(object, "is_error", check_boolean)?;
        }
        "thinking" => {
            check_optional(object, "thinking", check_string)?;
            check_optional(object, "signature", check_string)?;
        }
        "redacted_thinking" => {
            check_optional(object, "data", check_string)?;
        }
        _ => return Err(invalid()),
    }
    Ok(())
}

/// `system` is a union (string | text blocks) on the Node side, so every
/// failure here — non-string non-array, bad entry, bad field — is `Invalid input`.
fn validate_system(system: &Value) -> Result<(), String> {
    let invalid = || constants::gateway::anthropic::INVALID_INPUT.to_owned();
    if system.is_string() {
        return Ok(());
    }
    let Some(entries) = system.as_array() else {
        return Err(invalid());
    };
    for entry in entries {
        let Some(object) = entry.as_object() else {
            return Err(invalid());
        };
        if object.get("type").and_then(Value::as_str) != Some("text") {
            return Err(invalid());
        }
        if let Some(text) = object.get("text")
            && !text.is_string()
        {
            return Err(invalid());
        }
    }
    Ok(())
}

fn validate_tool_choice(tool_choice: &Value) -> Result<(), String> {
    check_object(tool_choice)?;
    let object = tool_choice.as_object().expect("checked object");
    let kind = object
        .get("type")
        .ok_or_else(|| constants::gateway::anthropic::REQUIRED.to_owned())?;
    check_enum(
        kind,
        constants::gateway::anthropic::TOOL_CHOICE_ENUM,
        &["auto", "any", "tool"],
    )?;
    if kind.as_str() == Some("tool")
        && let Some(name) = object.get("name")
    {
        check_string(name)?;
    }
    Ok(())
}

fn validate_thinking(thinking: &Value) -> Result<(), String> {
    check_object(thinking)?;
    let object = thinking.as_object().expect("checked object");
    let kind = object
        .get("type")
        .ok_or_else(|| constants::gateway::anthropic::REQUIRED.to_owned())?;
    check_enum(
        kind,
        constants::gateway::anthropic::THINKING_ENUM,
        &["enabled", "disabled", "adaptive"],
    )?;
    check_optional(object, "budget_tokens", check_integer)
}

fn validate_tools(tools: &Value) -> Result<(), String> {
    check_array(tools)?;
    let tools = tools.as_array().expect("checked array");
    if tools.len() > 128 {
        return Err(constants::gateway::anthropic::TOOLS_MAX_128.to_owned());
    }
    for tool in tools {
        check_object(tool)?;
        let object = tool.as_object().expect("checked object");
        match object.get("name") {
            None => return Err(constants::gateway::anthropic::REQUIRED.to_owned()),
            Some(name) => check_string(name)?,
        }
        check_optional(object, "description", check_string)?;
        match object.get("input_schema") {
            None => return Err(constants::gateway::anthropic::REQUIRED.to_owned()),
            Some(schema) => check_object(schema)?,
        }
    }
    Ok(())
}

/// Validates a decoded `/v1/messages` body before it is deserialized. The
/// caller has already separated `null`/scalar bodies (their own message) from
/// objects and arrays; arrays fail here with `Expected object, received array`.
pub fn validate_anthropic_request(body: &Value) -> Result<(), String> {
    let invalid = || constants::gateway::anthropic::INVALID_INPUT.to_owned();
    let Some(object) = body.as_object() else {
        return Err(expected_type(body, "object"));
    };

    let Some(model) = object.get("model") else {
        return Err(constants::gateway::anthropic::MODEL_FIELD.to_owned());
    };
    if !model.is_string() {
        return Err(expected_type(model, "string"));
    }
    if model.as_str().expect("checked string").is_empty() {
        return Err(constants::gateway::anthropic::MODEL_FIELD.to_owned());
    }

    let messages = object
        .get("messages")
        .ok_or_else(|| constants::gateway::anthropic::MESSAGES_FIELD.to_owned())?;
    check_array(messages)?;
    let messages = messages.as_array().expect("checked array");
    if messages.is_empty() {
        return Err(constants::gateway::schema::MESSAGES_NOT_EMPTY.to_owned());
    }
    if messages.len() > 1000 {
        return Err(constants::gateway::schema::MESSAGES_MAX_1000.to_owned());
    }
    for message in messages {
        let Some(message) = message.as_object() else {
            return Err(expected_type(message, "object"));
        };
        match message.get("role") {
            None => return Err(constants::gateway::anthropic::REQUIRED.to_owned()),
            Some(role) => check_enum(
                role,
                constants::gateway::anthropic::ROLE_ENUM,
                &["user", "assistant", "system"],
            )?,
        }
        match message.get("content") {
            None => return Err(invalid()),
            Some(Value::String(_)) => {}
            Some(Value::Array(blocks)) => validate_content_blocks(blocks)?,
            Some(_) => return Err(invalid()),
        }
    }

    check_optional(object, "max_tokens", check_max_tokens)?;
    check_optional(object, "temperature", check_unit_interval)?;
    check_optional(object, "top_p", check_unit_interval)?;
    check_optional(object, "top_k", check_positive_integer)?;
    if let Some(stop) = object.get("stop_sequences") {
        check_array(stop)?;
        for sequence in stop.as_array().expect("checked array") {
            check_string(sequence)?;
        }
    }
    check_optional(object, "stream", check_boolean)?;
    check_optional(object, "tools", validate_tools)?;
    check_optional(object, "tool_choice", validate_tool_choice)?;
    check_optional(object, "thinking", validate_thinking)?;
    check_optional(object, "system", validate_system)?;
    check_optional(object, "metadata", check_object)
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

        if let Some(r) = reasoning
            && allow_thinking
            && !r.is_empty()
        {
            content_blocks.push(serde_json::json!({
                "type": "thinking",
                "thinking": r
            }));
        }

        if let Some(content) = msg.get("content") {
            if let Some(text) = content.as_str() {
                // Node keeps an empty string as an empty text block and only
                // omits the block for `null` content (probed both ways).
                content_blocks.push(serde_json::json!({
                    "type": "text",
                    "text": text
                }));
            } else if let Some(arr) = content.as_array() {
                // An array of parts collapses into ONE text block joined by
                // newlines; parts with no text produce no block at all
                // (probed: [p1,p2] -> "p1\np2", all-image -> []).
                let texts: Vec<&str> = arr
                    .iter()
                    .filter(|item| item.get("type").and_then(|t| t.as_str()) == Some("text"))
                    .filter_map(|item| item.get("text").and_then(|t| t.as_str()))
                    .collect();
                if !texts.is_empty() {
                    content_blocks.push(serde_json::json!({
                        "type": "text",
                        "text": texts.join("\n")
                    }));
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

                // A tool call without an id omits the key entirely (probed);
                // a missing name degrades to "" instead of Node's `500`.
                let mut block = serde_json::json!({
                    "type": "tool_use",
                    "name": name,
                    "input": input
                });
                if !id.is_empty() {
                    block["id"] = serde_json::Value::String(id.to_owned());
                }
                content_blocks.push(block);
            }
        }
    }

    let finish_reason = choice
        .and_then(|c| c.get("finish_reason"))
        .and_then(|v| v.as_str());
    let stop_reason = match finish_reason {
        Some("tool_calls") | Some("function_call") => "tool_use",
        Some("length") => "max_tokens",
        // `stop_sequence` maps to `end_turn` too: Node only knows the two
        // special values above (probed).
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
        // Node falls back to `msg_<uuid>` with dashes for a response that
        // carries no id at all (probed).
        .unwrap_or_else(|| format!("msg_{}", uuid::Uuid::new_v4()));

    let usage = res.get("usage");
    let input_tokens = usage
        .and_then(|u| u.get("prompt_tokens"))
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let output_tokens = usage
        .and_then(|u| u.get("completion_tokens"))
        .and_then(|v| v.as_u64())
        .unwrap_or(0);

    // Node reports exactly two usage keys; the cache fields are dropped even
    // when the upstream sent them (probed with both OpenAI and Anthropic
    // shapes).
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
            "output_tokens": output_tokens
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
        }
    }

    fn sse_event(event_name: &str, data: &Value) -> Bytes {
        let payload = serde_json::to_string(data).unwrap_or_default();
        Bytes::from(format!("event: {event_name}\ndata: {payload}\n\n"))
    }

    pub fn feed_chunk(&mut self, chunk: &Value) -> Vec<Bytes> {
        let mut events = Vec::new();

        // Node reads only `prompt_tokens` here (it lands in the `message_start`
        // usage when the first chunk carries it); `output_tokens` is always the
        // delta count accumulated in this translator, never `completion_tokens`
        // (probed: a final chunk with `completion_tokens: 9` over one text delta
        // still reports `output_tokens: 1`).
        if let Some(usage) = chunk.get("usage")
            && let Some(n) = usage.get("prompt_tokens").and_then(|v| v.as_u64())
        {
            self.input_tokens = n as usize;
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
                            "output_tokens": 1
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

        if let Some(r) = reasoning
            && self.allow_thinking
            && !r.is_empty()
        {
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

        // 2. Text delta
        if let Some(content) = delta.get("content").and_then(|v| v.as_str())
            && !content.is_empty()
        {
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
                    && !args.is_empty()
                {
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

        events
    }

    pub fn finish(&mut self) -> Vec<Bytes> {
        let mut events = Vec::new();

        // Node never backfills `message_start`: an empty stream emits only
        // `message_delta` + `message_stop` (probed), and a stream that ran
        // already started in `feed_chunk`.

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
                count += text.chars().count().div_ceil(4);
            }
            AnthropicSystem::Blocks(blocks) => {
                for b in blocks {
                    count += b.text.chars().count().div_ceil(4);
                }
            }
        }
    }

    for msg in &req.messages {
        count += 4;
        match &msg.content {
            AnthropicMessageContent::Text(text) => {
                count += text.chars().count().div_ceil(4);
            }
            AnthropicMessageContent::Blocks(blocks) => {
                for block in blocks {
                    match block {
                        AnthropicContentBlock::Text { text, .. } => {
                            count += text.chars().count().div_ceil(4);
                        }
                        AnthropicContentBlock::Image { .. } => {
                            count += 1600;
                        }
                        AnthropicContentBlock::ToolUse { name, input, .. } => {
                            let input_len =
                                serde_json::to_string(input).map(|s| s.len()).unwrap_or(0);
                            count += (name.len() + input_len).div_ceil(4);
                        }
                        AnthropicContentBlock::ToolResult { content, .. } => {
                            let text_len = match content {
                                None => 0,
                                Some(Value::String(s)) => s.len(),
                                Some(other) => {
                                    serde_json::to_string(other).map(|s| s.len()).unwrap_or(0)
                                }
                            };
                            count += text_len.div_ceil(4);
                        }
                        AnthropicContentBlock::Thinking { thinking, .. } => {
                            count += thinking.chars().count().div_ceil(4);
                        }
                        AnthropicContentBlock::RedactedThinking { data } => {
                            count += data.len().div_ceil(4);
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
            count += (t.name.len() + t.description.as_deref().unwrap_or("").len() + schema_len)
                .div_ceil(4);
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
                            content: Some(serde_json::json!("file.txt")),
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

    // ==========================================================================
    // Parity tests frozen against the Node black-box probes (`probe3`-`probe15`).
    // Each expectation is the exact status/message/body `apps/api` produced.
    // ==========================================================================

    fn request(body: &Value) -> Result<AnthropicMessageRequest, String> {
        serde_json::from_value(body.clone()).map_err(|e| e.to_string())
    }

    fn validation_error(body: &Value) -> String {
        validate_anthropic_request(body).expect_err("payload should be rejected")
    }

    fn base() -> Value {
        serde_json::json!({
            "model": "probe-model-1",
            "max_tokens": 16,
            "messages": [{ "role": "user", "content": "hi" }]
        })
    }

    /// Merges `patch` into a fresh `base()` body — `json!` has no spread syntax.
    fn with(patch: Value) -> Value {
        let mut body = base();
        let target = body.as_object_mut().expect("base is an object");
        for (key, value) in patch.as_object().expect("patch is an object") {
            target.insert(key.clone(), value.clone());
        }
        body
    }

    fn serialized_keys(req: &ChatCompletionRequest) -> Vec<String> {
        let value = serde_json::to_value(req).expect("serializable request");
        let mut keys: Vec<String> = value
            .as_object()
            .expect("request serializes to an object")
            .keys()
            .cloned()
            .collect();
        keys.sort();
        keys
    }

    // -- Validation: scalar fields keep specific messages (probe3, probe9) -----

    #[test]
    fn validation_reports_exact_scalar_messages() {
        // probe3: role / messages / max_tokens / stop_sequences shapes.
        assert_eq!(
            validation_error(&with(
                serde_json::json!({"messages": [{ "role": 7, "content": "x" }] })
            )),
            "Expected 'user' | 'assistant' | 'system', received number"
        );
        assert_eq!(
            validation_error(&with(
                serde_json::json!({"messages": [{ "role": "User", "content": "x" }] })
            )),
            "Invalid enum value. Expected 'user' | 'assistant' | 'system', received 'User'"
        );
        assert_eq!(
            validation_error(&with(serde_json::json!({"messages": "x" }))),
            "Expected array, received string"
        );
        assert_eq!(
            validation_error(&with(serde_json::json!({"max_tokens": 1.5 }))),
            "Expected integer, received float"
        );
        assert_eq!(
            validation_error(&with(serde_json::json!({"max_tokens": -5 }))),
            "Number must be greater than 0"
        );
        assert_eq!(
            validation_error(&with(serde_json::json!({"stop_sequences": [7] }))),
            "Expected string, received number"
        );
        // probe3: a non-object message item.
        assert_eq!(
            validation_error(&with(serde_json::json!({"messages": [42] }))),
            "Expected object, received number"
        );
        // probe9: null message item.
        assert_eq!(
            validation_error(&with(serde_json::json!({"messages": [null] }))),
            "Expected object, received null"
        );
        // probe9: metadata accepts objects only.
        assert_eq!(
            validation_error(&with(serde_json::json!({"metadata": null }))),
            "Expected object, received null"
        );
        assert_eq!(
            validation_error(&with(serde_json::json!({"metadata": [] }))),
            "Expected object, received array"
        );
        // probe9: top_k is a positive integer.
        assert_eq!(
            validation_error(&with(serde_json::json!({"top_k": 0 }))),
            "Number must be greater than 0"
        );
        // probe3/probe9: tools array and per-tool fields.
        assert_eq!(
            validation_error(&with(serde_json::json!({"tools": {} }))),
            "Expected array, received object"
        );
        assert_eq!(
            validation_error(&with(
                serde_json::json!({"tools": [{ "name": 7, "input_schema": {} }]
                })
            )),
            "Expected string, received number"
        );
        assert_eq!(
            validation_error(&with(
                serde_json::json!({"tools": [{ "name": "t", "input_schema": 7 }]
                })
            )),
            "Expected object, received number"
        );
        // probe9: the 128-tool cap reports the Zod array message at 129 and 1000.
        let many: Vec<Value> = (0..129)
            .map(|i| serde_json::json!({ "name": format!("t{i}"), "input_schema": {} }))
            .collect();
        assert_eq!(
            validation_error(&with(serde_json::json!({"tools": many }))),
            "Array must contain at most 128 element(s)"
        );
        // probe3/probe9: enum fields.
        assert_eq!(
            validation_error(&with(serde_json::json!({"tool_choice": { "type": "nope" }
            }))),
            "Invalid enum value. Expected 'auto' | 'any' | 'tool', received 'nope'"
        );
        assert_eq!(
            validation_error(&with(serde_json::json!({"thinking": { "type": "nope" }
            }))),
            "Invalid enum value. Expected 'enabled' | 'disabled' | 'adaptive', received 'nope'"
        );
        assert_eq!(
            validation_error(&with(
                serde_json::json!({"thinking": { "type": "enabled", "budget_tokens": "5" }
                })
            )),
            "Expected number, received string"
        );
        assert_eq!(
            validation_error(&with(
                serde_json::json!({"thinking": { "type": "enabled", "budget_tokens": 1.5 }
                })
            )),
            "Expected integer, received float"
        );
    }

    #[test]
    fn validation_reports_the_required_field_messages() {
        assert_eq!(
            validate_anthropic_request(&serde_json::json!({ "messages": [] })).unwrap_err(),
            "Missing required field 'model'"
        );
        assert_eq!(
            validate_anthropic_request(&serde_json::json!({ "model": "m" })).unwrap_err(),
            "Missing required field 'messages'"
        );
        assert_eq!(
            validate_anthropic_request(&serde_json::json!({
                "model": "m",
                "messages": []
            }))
            .unwrap_err(),
            "Parameter 'messages' cannot be empty"
        );
    }

    // -- Validation: unions collapse to "Invalid input" (probe3, probe9) -------

    #[test]
    fn union_failures_report_invalid_input() {
        // probe3: message content is a string|blocks union.
        for content in [
            serde_json::Value::Null,
            serde_json::json!(5),
            serde_json::json!({ "a": 1 }),
        ] {
            assert_eq!(
                validation_error(&with(
                    serde_json::json!({"messages": [{ "role": "user", "content": content }]
                    })
                )),
                "Invalid input"
            );
        }
        assert_eq!(
            validation_error(&with(serde_json::json!({"messages": [{ "role": "user" }]
            }))),
            "Invalid input"
        );
        // probe3: a block that is not an object, or lacks `type`.
        assert_eq!(
            validation_error(&with(
                serde_json::json!({"messages": [{ "role": "user", "content": [7] }]
                })
            )),
            "Invalid input"
        );
        assert_eq!(
            validation_error(&with(
                serde_json::json!({"messages": [{ "role": "user", "content": [{ "text": "x" }] }]
                })
            )),
            "Invalid input"
        );
        // probe9: every field failure inside a block reports the union message.
        let block_cases: Vec<Value> = vec![
            serde_json::json!([{ "type": "text", "text": 5 }]),
            serde_json::json!([
                { "role": "assistant" },
                { "type": "tool_use", "id": 7, "name": "s", "input": {} }
            ]),
            serde_json::json!([
                { "type": "tool_result", "tool_use_id": "t", "content": 5 }
            ]),
            serde_json::json!([
                { "type": "tool_result", "tool_use_id": "t", "content": "x", "is_error": "yes" }
            ]),
            serde_json::json!([{ "type": "image", "source": { "type": "base64", "media_type": 5, "data": "AA" } }]),
        ];
        for (i, content) in block_cases.iter().enumerate() {
            let messages = if i == 1 {
                serde_json::json!([
                    { "role": "user", "content": "u" },
                    { "role": "assistant", "content": content }
                ])
            } else {
                serde_json::json!([{ "role": "user", "content": content }])
            };
            assert_eq!(
                validation_error(&with(serde_json::json!({"messages": messages }))),
                "Invalid input",
                "block case {i}"
            );
        }
        // probe9: a thinking block with a non-string field.
        assert_eq!(
            validation_error(&with(serde_json::json!({"messages": [
                    { "role": "assistant", "content": [{ "type": "thinking", "thinking": 5 }] },
                    { "role": "user", "content": "u" }
                ]
            }))),
            "Invalid input"
        );
        // probe3/probe9: `system` is string|blocks; every failure is the union message.
        for system in [
            serde_json::json!(123),
            serde_json::json!(null),
            serde_json::json!([{ "type": "nope" }]),
        ] {
            assert_eq!(
                validation_error(&with(serde_json::json!({"system": system }))),
                "Invalid input"
            );
        }
        // probe9: an empty system array and an empty content array are accepted.
        validate_anthropic_request(&with(serde_json::json!({"system": [] })))
            .expect("empty system array is valid");
        validate_anthropic_request(&with(
            serde_json::json!({"messages": [{ "role": "user", "content": [] }]
            }),
        ))
        .expect("empty content array is valid");
    }

    #[test]
    fn a_body_that_is_not_an_object_is_a_type_error() {
        assert_eq!(
            validate_anthropic_request(&serde_json::json!([1, 2])).unwrap_err(),
            "Expected object, received array"
        );
    }

    // -- Request mapping (probe4, probe9, probe14) -----------------------------

    #[test]
    fn system_blocks_join_with_blank_lines_and_drop_cache_markers() {
        let req = request(&serde_json::json!({
            "model": "m",
            "messages": [{ "role": "user", "content": "hi" }],
            "system": [
                { "type": "text", "text": "a", "cache_control": { "type": "ephemeral" } },
                { "type": "text", "text": "b" }
            ]
        }))
        .expect("valid request");

        let openai = anthropic_to_openai_request(req);
        assert_eq!(openai.messages[0].role, ChatRole::System);
        assert_eq!(
            openai.messages[0].content,
            ChatContent::Text("a\n\nb".to_owned())
        );
    }

    #[test]
    fn named_tool_choice_carries_the_function_discriminator() {
        // probe14: the upstream body is {"type":"function","function":{...}}.
        let req = request(&serde_json::json!({
            "model": "m",
            "messages": [{ "role": "user", "content": "hi" }],
            "tool_choice": { "type": "tool", "name": "t" }
        }))
        .expect("valid request");

        let openai = anthropic_to_openai_request(req);
        let value = serde_json::to_value(&openai.tool_choice).expect("serializable");
        assert_eq!(
            value,
            serde_json::json!({
                "type": "function",
                "function": { "name": "t" }
            })
        );
    }

    #[test]
    fn a_named_tool_choice_without_a_name_is_dropped() {
        // probe: Node emits no tool_choice key at all for {type:"tool"}.
        let req = request(&serde_json::json!({
            "model": "m",
            "messages": [{ "role": "user", "content": "hi" }],
            "tool_choice": { "type": "tool" }
        }))
        .expect("valid request");

        let openai = anthropic_to_openai_request(req);
        assert!(openai.tool_choice.is_none());
    }

    #[test]
    fn thinking_variants_map_to_the_split_reasoning_shapes() {
        // probe4/probe9: enabled/adaptive -> reasoning:{effort:"high"} and
        // NO reasoning_effort; disabled -> reasoning_effort:"none" only;
        // budget_tokens is never forwarded and no `thinking` key exists.
        for thinking in ["enabled", "adaptive"] {
            let req = request(&serde_json::json!({
                "model": "m",
                "messages": [{ "role": "user", "content": "hi" }],
                "thinking": { "type": thinking, "budget_tokens": 512 }
            }))
            .expect("valid request");
            let openai = anthropic_to_openai_request(req);
            assert_eq!(
                serde_json::to_value(&openai.reasoning).unwrap(),
                serde_json::json!({ "effort": "high" })
            );
            assert!(openai.reasoning_effort.is_none());
            assert!(openai.thinking.is_none());
        }

        let req = request(&serde_json::json!({
            "model": "m",
            "messages": [{ "role": "user", "content": "hi" }],
            "thinking": { "type": "disabled" }
        }))
        .expect("valid request");
        let openai = anthropic_to_openai_request(req);
        assert_eq!(openai.reasoning_effort.as_deref(), Some("none"));
        assert!(openai.reasoning.is_none());
    }

    #[test]
    fn the_upstream_body_drops_every_openai_only_field() {
        // probe14: top_k, metadata, n, user, penalties, stream_options and
        // response_format never reach the upstream; the key set is exact.
        let req = request(&serde_json::json!({
            "model": "m",
            "messages": [{ "role": "user", "content": "hi" }],
            "max_tokens": 64,
            "temperature": 0.7,
            "top_p": 0.9,
            "top_k": 40,
            "stop_sequences": ["STOP"],
            "metadata": { "user_id": "u-1" },
            "n": 2,
            "user": "alice",
            "presence_penalty": 0.1,
            "frequency_penalty": 0.2,
            "stream_options": { "include_usage": true },
            "response_format": { "type": "json_object" },
            "extra_unknown_field": 123
        }))
        .expect("valid request");

        let openai = anthropic_to_openai_request(req);
        assert_eq!(
            serialized_keys(&openai),
            vec![
                "max_tokens",
                "messages",
                "model",
                "stop",
                "stream",
                "temperature",
                "top_p"
            ]
        );
        let stop = serde_json::to_value(&openai.stop).unwrap();
        assert_eq!(stop, serde_json::json!(["STOP"]));
    }

    #[test]
    fn optional_block_shapes_match_the_upstream_captures() {
        // probe4: assistant tool_use only -> content null; two text blocks ->
        // one "a\nb" string; user two text blocks -> parts array; a tool_result
        // content array joins with "\n".
        let req = request(&serde_json::json!({
            "model": "m",
            "messages": [
                { "role": "assistant", "content": [
                    { "type": "tool_use", "id": "tu_1", "name": "search", "input": { "q": "x" } }
                ]},
                { "role": "user", "content": [
                    { "type": "tool_result", "tool_use_id": "tu_1",
                      "content": [{ "type": "text", "text": "a" }, { "type": "text", "text": "b" }] }
                ]},
                { "role": "assistant", "content": [
                    { "type": "text", "text": "a" }, { "type": "text", "text": "b" }
                ]}
            ]
        }))
        .expect("valid request");

        let openai = anthropic_to_openai_request(req);
        assert_eq!(openai.messages.len(), 3);
        assert_eq!(openai.messages[0].content, ChatContent::Null);
        assert_eq!(
            openai.messages[0].tool_calls.as_ref().map(Vec::len),
            Some(1)
        );
        assert_eq!(openai.messages[1].role, ChatRole::Tool);
        assert_eq!(
            openai.messages[1].content,
            ChatContent::Text("a\nb".to_owned())
        );
        assert_eq!(
            openai.messages[2].content,
            ChatContent::Text("a\nb".to_owned())
        );
    }

    #[test]
    fn empty_text_blocks_produce_no_part_and_drop_the_message() {
        // probe9: [{type:"text"}] alone yields no user message; adding a
        // non-empty block keeps only that text.
        let req = request(&serde_json::json!({
            "model": "m",
            "messages": [{ "role": "user", "content": [{ "type": "text" }] }]
        }))
        .expect("valid request");
        let openai = anthropic_to_openai_request(req);
        assert!(
            !openai.messages.iter().any(|m| m.role == ChatRole::User),
            "a message with no parts must be dropped"
        );

        let req = request(&serde_json::json!({
            "model": "m",
            "messages": [{ "role": "user", "content": [
                { "type": "text" }, { "type": "text", "text": "after" }
            ]}]
        }))
        .expect("valid request");
        let openai = anthropic_to_openai_request(req);
        let user = openai
            .messages
            .iter()
            .find(|m| m.role == ChatRole::User)
            .expect("the non-empty block keeps the message");
        assert_eq!(user.content, ChatContent::Text("after".to_owned()));
    }

    #[test]
    fn an_image_without_a_source_is_dropped() {
        // probe9: {type:"image"} with no source contributes no part.
        let req = request(&serde_json::json!({
            "model": "m",
            "messages": [{ "role": "user", "content": [
                { "type": "image" }, { "type": "text", "text": "after-image" }
            ]}]
        }))
        .expect("valid request");
        let openai = anthropic_to_openai_request(req);
        let user = openai
            .messages
            .iter()
            .find(|m| m.role == ChatRole::User)
            .expect("the text block keeps the message");
        match &user.content {
            ChatContent::Text(text) => assert_eq!(text, "after-image"),
            other => panic!("expected text content, got {other:?}"),
        }
    }

    #[test]
    fn a_tool_use_without_an_id_gets_a_minted_call_id() {
        // probe9: upstream ids always exist; the gateway mints `call_<hex>`.
        let req = request(&serde_json::json!({
            "model": "m",
            "messages": [{ "role": "assistant", "content": [
                { "type": "tool_use", "name": "s", "input": {} }
            ]}]
        }))
        .expect("valid request");
        let openai = anthropic_to_openai_request(req);
        let calls = openai.messages[0]
            .tool_calls
            .as_ref()
            .expect("tool_calls present");
        assert!(calls[0].id.starts_with("call_"), "got {}", calls[0].id);
        assert_eq!(calls[0].id.len(), "call_".len() + 8);
    }

    // -- Response mapping (probe4, probe13, probe15) --------------------------

    fn response_with_finish(finish: Value) -> Value {
        serde_json::json!({
            "id": "chatcmpl-z",
            "choices": [{
                "index": 0,
                "message": { "role": "assistant", "content": "x" },
                "finish_reason": finish
            }],
            "usage": { "prompt_tokens": 1, "completion_tokens": 1 }
        })
    }

    #[test]
    fn finish_reason_maps_exactly_as_node_does() {
        // probe15: every finish_reason value and its stop_reason.
        for (finish, expected) in [
            ("stop_sequence", "end_turn"),
            ("length", "max_tokens"),
            ("stop", "end_turn"),
            ("tool_calls", "tool_use"),
            ("function_call", "tool_use"),
            ("content_filter", "end_turn"),
        ] {
            let res = openai_to_anthropic_response(
                &response_with_finish(serde_json::json!(finish)),
                "m",
                false,
            );
            assert_eq!(res["stop_reason"], expected, "finish_reason {finish}");
        }
        let res = openai_to_anthropic_response(&response_with_finish(Value::Null), "m", false);
        assert_eq!(res["stop_reason"], "end_turn", "finish_reason null");
    }

    #[test]
    fn response_content_arrays_collapse_into_one_text_block() {
        // probe4: [p1,p2] -> one block "p1\np2"; all-image/empty/number -> [].
        let parts = serde_json::json!({
            "id": "chatcmpl-x",
            "choices": [{
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": [
                        { "type": "text", "text": "p1" },
                        { "type": "image", "image_url": { "url": "data:image/png;base64,QQ==" } },
                        { "type": "text", "text": "p2" }
                    ]
                },
                "finish_reason": "stop"
            }],
            "usage": {}
        });
        let res = openai_to_anthropic_response(&parts, "m", false);
        assert_eq!(res["content"].as_array().unwrap().len(), 1);
        assert_eq!(res["content"][0]["text"], "p1\np2");

        for content in [
            serde_json::json!([]),
            serde_json::json!([{ "type": "image", "image_url": { "url": "u" } }]),
            serde_json::json!(42),
            Value::Null,
        ] {
            let body = serde_json::json!({
                "id": "chatcmpl-x",
                "choices": [{
                    "index": 0,
                    "message": { "role": "assistant", "content": content },
                    "finish_reason": "stop"
                }],
                "usage": {}
            });
            let res = openai_to_anthropic_response(&body, "m", false);
            assert_eq!(res["content"], serde_json::json!([]), "content {content}");
        }
    }

    #[test]
    fn an_empty_string_content_keeps_an_empty_text_block() {
        // probe4: "" -> [{"type":"text","text":""}] (null would drop the block).
        let body = serde_json::json!({
            "id": "chatcmpl-x",
            "choices": [{
                "index": 0,
                "message": { "role": "assistant", "content": "" },
                "finish_reason": "stop"
            }],
            "usage": {}
        });
        let res = openai_to_anthropic_response(&body, "m", false);
        assert_eq!(
            res["content"],
            serde_json::json!([{ "type": "text", "text": "" }])
        );
    }

    #[test]
    fn usage_reports_only_the_two_input_output_counters() {
        // probe4: cache fields are dropped; missing usage -> 0/0.
        let with_details = serde_json::json!({
            "id": "chatcmpl-x",
            "choices": [{ "index": 0, "message": { "role": "assistant", "content": "x" }, "finish_reason": "stop" }],
            "usage": {
                "prompt_tokens": 11,
                "completion_tokens": 7,
                "prompt_tokens_details": { "cached_tokens": 3 },
                "cache_read_input_tokens": 128,
                "cache_creation_input_tokens": 5
            }
        });
        let res = openai_to_anthropic_response(&with_details, "m", false);
        assert_eq!(
            res["usage"],
            serde_json::json!({ "input_tokens": 11, "output_tokens": 7 })
        );
        assert_eq!(res["usage"].as_object().unwrap().len(), 2);

        let missing = serde_json::json!({
            "id": "chatcmpl-x",
            "choices": [{ "index": 0, "message": { "role": "assistant", "content": "x" }, "finish_reason": "stop" }]
        });
        let res = openai_to_anthropic_response(&missing, "m", false);
        assert_eq!(
            res["usage"],
            serde_json::json!({ "input_tokens": 0, "output_tokens": 0 })
        );
    }

    #[test]
    fn the_message_id_strips_the_chatcmpl_prefix_only() {
        // probe4: "chatcmpl-z" -> "msg_z"; "custom-9" -> "msg_custom-9".
        let custom = serde_json::json!({
            "id": "custom-9",
            "choices": [{ "index": 0, "message": { "role": "assistant", "content": "x" }, "finish_reason": "stop" }],
            "usage": {}
        });
        let res = openai_to_anthropic_response(&custom, "m", false);
        assert_eq!(res["id"], "msg_custom-9");

        let no_id = serde_json::json!({
            "choices": [{ "index": 0, "message": { "role": "assistant", "content": "x" }, "finish_reason": "stop" }],
            "usage": {}
        });
        let res = openai_to_anthropic_response(&no_id, "m", false);
        let id = res["id"].as_str().expect("id present");
        assert!(id.starts_with("msg_"), "got {id}");
        assert_eq!(id.len(), "msg_".len() + 36, "uuid keeps its dashes");
    }

    #[test]
    fn thinking_blocks_follow_the_allow_flag() {
        let body = serde_json::json!({
            "id": "chatcmpl-x",
            "choices": [{
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": "x",
                    "reasoning_content": "thinking hard"
                },
                "finish_reason": "stop"
            }],
            "usage": {}
        });
        let allowed = openai_to_anthropic_response(&body, "m", true);
        assert_eq!(allowed["content"][0]["type"], "thinking");
        assert_eq!(allowed["content"][0]["thinking"], "thinking hard");

        let suppressed = openai_to_anthropic_response(&body, "m", false);
        assert_eq!(suppressed["content"][0]["type"], "text");
        assert!(suppressed["content"].as_array().unwrap().len() == 1);
    }

    // -- Stream translator (probe13, probe15) ---------------------------------

    fn feed(translator: &mut AnthropicStreamTranslator, chunk: Value) -> String {
        String::from_utf8(translator.feed_chunk(&chunk).concat()).unwrap()
    }

    fn finish_sse(translator: &mut AnthropicStreamTranslator) -> String {
        String::from_utf8(translator.finish().concat()).unwrap()
    }

    #[test]
    fn an_empty_stream_never_emits_message_start() {
        // probe13: zero chunks -> only message_delta (output_tokens 1) + message_stop.
        let mut translator = AnthropicStreamTranslator::new("m", false);
        let sse = finish_sse(&mut translator);
        assert!(!sse.contains("message_start"));
        assert!(sse.contains("event: message_delta"));
        assert!(sse.contains("\"output_tokens\":1"));
        assert!(sse.contains("event: message_stop"));
        assert!(sse.contains("\"stop_reason\":\"end_turn\""));
    }

    #[test]
    fn usage_on_the_first_chunk_lands_in_message_start() {
        // probe13: prompt_tokens 42 read BEFORE message_start is emitted.
        let mut translator = AnthropicStreamTranslator::new("m", false);
        let sse = feed(
            &mut translator,
            serde_json::json!({
                "choices": [{ "index": 0, "delta": {}, "finish_reason": null }],
                "usage": { "prompt_tokens": 42, "completion_tokens": 7, "total_tokens": 49 }
            }),
        );
        assert!(sse.contains("event: message_start"));
        let start = sse.split("event: message_start").nth(1).unwrap();
        let start = start.split("event:").next().unwrap();
        assert!(start.contains("\"input_tokens\":42"), "{start}");
        assert!(start.contains("\"output_tokens\":1"), "{start}");

        let sse2 = feed(
            &mut translator,
            serde_json::json!({
                "choices": [{ "index": 0, "delta": { "content": "hi" }, "finish_reason": "stop" }]
            }),
        );
        assert!(sse2.contains("\"text\":\"hi\""));

        let sse3 = finish_sse(&mut translator);
        // One delta -> output_tokens 1, never completion_tokens 7.
        assert!(sse3.contains("\"output_tokens\":1"), "{sse3}");
        assert!(!sse3.contains("\"output_tokens\":7"));
    }

    #[test]
    fn output_tokens_counts_deltas_not_completion_tokens() {
        // probe13: two text deltas over a final chunk with completion_tokens 9
        // reports output_tokens 2.
        let mut translator = AnthropicStreamTranslator::new("m", false);
        feed(
            &mut translator,
            serde_json::json!({
                "choices": [{ "index": 0, "delta": { "content": "a" }, "finish_reason": null }]
            }),
        );
        feed(
            &mut translator,
            serde_json::json!({
                "choices": [{ "index": 0, "delta": { "content": "b" }, "finish_reason": "stop" }],
                "usage": { "prompt_tokens": 5, "completion_tokens": 9, "total_tokens": 14 }
            }),
        );
        let sse = finish_sse(&mut translator);
        assert!(sse.contains("\"output_tokens\":2"), "{sse}");
        assert!(sse.contains("\"stop_reason\":\"end_turn\""));
    }

    #[test]
    fn stream_finish_reason_maps_like_the_buffered_path() {
        for (finish, expected) in [
            ("length", "max_tokens"),
            ("tool_calls", "tool_use"),
            ("function_call", "tool_use"),
            ("stop_sequence", "end_turn"),
            ("stop", "end_turn"),
        ] {
            let mut translator = AnthropicStreamTranslator::new("m", false);
            feed(
                &mut translator,
                serde_json::json!({
                    "choices": [{ "index": 0, "delta": { "content": "x" }, "finish_reason": finish }]
                }),
            );
            let sse = finish_sse(&mut translator);
            assert!(
                sse.contains(&format!("\"stop_reason\":\"{expected}\"")),
                "finish_reason {finish}: {sse}"
            );
        }
    }

    #[test]
    fn stream_tool_deltas_open_and_close_the_tool_block() {
        // probe: partial JSON deltas flow as input_json_delta on one block.
        let mut translator = AnthropicStreamTranslator::new("m", false);
        let sse1 = feed(
            &mut translator,
            serde_json::json!({
                "choices": [{
                    "index": 0,
                    "delta": {
                        "tool_calls": [{
                            "index": 0,
                            "id": "call_1",
                            "function": { "name": "search", "arguments": "{\"q\":" }
                        }]
                    },
                    "finish_reason": null
                }]
            }),
        );
        assert!(sse1.contains("event: content_block_start"), "{sse1}");
        assert!(sse1.contains("\"type\":\"tool_use\""), "{sse1}");

        let sse2 = feed(
            &mut translator,
            serde_json::json!({
                "choices": [{
                    "index": 0,
                    "delta": { "tool_calls": [{ "index": 0, "function": { "arguments": "\"rust\"}" } }] },
                    "finish_reason": "tool_calls"
                }]
            }),
        );
        assert!(sse2.contains("input_json_delta"), "{sse2}");

        let sse3 = finish_sse(&mut translator);
        assert!(sse3.contains("event: content_block_stop"), "{sse3}");
        assert!(sse3.contains("\"stop_reason\":\"tool_use\""), "{sse3}");
    }

    // -- Error envelope type mapping (contract) -------------------------------

    #[test]
    fn error_types_follow_the_contract_table() {
        // docs/api-v1-contract.md "Error envelopes": the same mapping Node's
        // GetErrorTypeFromStatus uses (probed via probe-401/-429/-500 outputs).
        assert_eq!(anthropic_error_type(400), "invalid_request_error");
        assert_eq!(anthropic_error_type(404), "invalid_request_error");
        assert_eq!(anthropic_error_type(409), "invalid_request_error");
        assert_eq!(anthropic_error_type(422), "invalid_request_error");
        assert_eq!(anthropic_error_type(401), "authentication_error");
        assert_eq!(anthropic_error_type(403), "permission_error");
        assert_eq!(anthropic_error_type(429), "rate_limit_error");
        assert_eq!(anthropic_error_type(500), "api_error");
        assert_eq!(anthropic_error_type(502), "api_error");
    }
}
