//! OpenAI-compatible chat wire types shared by the gateway handler and the
//! provider adapters that speak the same protocol. The field set mirrors
//! `ChatCompletionRequestSchema` in `packages/types`: unknown fields are
//! dropped while parsing and every documented bound is enforced here, so an
//! invalid body fails with `400` before any provider is contacted.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::APIError;

/// Bounds frozen in `ChatCompletionRequestSchema`.
const MAX_MODEL_LENGTH: usize = 300;
const MAX_MESSAGES: usize = 1000;
const MAX_TOOLS: usize = 128;
const MAX_STOP_SEQUENCES: usize = 16;
const MAX_STOP_SEQUENCE_LENGTH: usize = 1000;
const MAX_TOKENS_CAP: u32 = 1_000_000;
const MAX_N: u32 = 8;
const MAX_USER_LENGTH: usize = 300;
const MAX_REASONING_TEXT: usize = 64;

/// Parses and validates a decoded chat-completion body against the frozen
/// request schema. Every failure is a `400` error envelope.
pub fn parse_chat_completion_request(body: Value) -> Result<ChatCompletionRequest, APIError> {
    if body.get("model").is_none() {
        return Err(invalid_request(
            "Missing required parameter 'model'",
            Some("model"),
            "invalid_type",
        ));
    }
    if body.get("messages").is_none() {
        return Err(invalid_request(
            "Missing required parameter 'messages'",
            Some("messages"),
            "invalid_type",
        ));
    }

    let request: ChatCompletionRequest = serde_json::from_value(body).map_err(|error| {
        invalid_request(
            format!("Invalid request body: {error}"),
            None,
            "invalid_type",
        )
    })?;
    request.validate()?;

    Ok(request)
}

fn invalid_request(message: impl Into<String>, param: Option<&str>, code: &str) -> APIError {
    let mut error = APIError::new(400, message).with_code(code);
    if let Some(param) = param {
        error = error.with_param(param);
    }
    error
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ChatRole {
    System,
    User,
    Assistant,
    Tool,
    Function,
    Developer,
}

/// Message content: plain text, an array of content parts, or `null` (used by
/// assistant turns that only carry tool calls).
#[derive(Clone, Debug, PartialEq)]
pub enum ChatContent {
    Text(String),
    Parts(Vec<ContentPart>),
    Null,
}

impl Serialize for ChatContent {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            Self::Text(text) => text.serialize(serializer),
            Self::Parts(parts) => parts.serialize(serializer),
            Self::Null => serializer.serialize_none(),
        }
    }
}

impl<'de> Deserialize<'de> for ChatContent {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct ContentVisitor;

        impl<'de> serde::de::Visitor<'de> for ContentVisitor {
            type Value = ChatContent;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("a string, an array of content parts, or null")
            }

            fn visit_str<E: serde::de::Error>(self, value: &str) -> Result<ChatContent, E> {
                Ok(ChatContent::Text(value.to_owned()))
            }

            fn visit_seq<A: serde::de::SeqAccess<'de>>(
                self,
                mut seq: A,
            ) -> Result<ChatContent, A::Error> {
                let mut parts = Vec::with_capacity(seq.size_hint().unwrap_or(0));
                while let Some(part) = seq.next_element()? {
                    parts.push(part);
                }
                Ok(ChatContent::Parts(parts))
            }

            fn visit_unit<E: serde::de::Error>(self) -> Result<ChatContent, E> {
                Ok(ChatContent::Null)
            }

            fn visit_none<E: serde::de::Error>(self) -> Result<ChatContent, E> {
                Ok(ChatContent::Null)
            }
        }

        deserializer.deserialize_any(ContentVisitor)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ContentPartType {
    Text,
    ImageUrl,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ImageDetail {
    Auto,
    Low,
    High,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ImageUrl {
    pub url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<ImageDetail>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ContentPart {
    #[serde(rename = "type")]
    pub kind: ContentPartType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image_url: Option<ImageUrl>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ToolCallKind {
    Function,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ToolCallFunction {
    pub name: String,
    pub arguments: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ToolCall {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: ToolCallKind,
    pub function: ToolCallFunction,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: ChatRole,
    pub content: ChatContent,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<ToolCall>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct StreamOptions {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub include_usage: Option<bool>,
}

/// `stop` is either a single sequence or a list of sequences.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum StopSequence {
    Text(String),
    List(Vec<String>),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ToolKind {
    Function,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ToolFunction {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parameters: Option<Value>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ToolDefinition {
    #[serde(rename = "type")]
    pub kind: ToolKind,
    pub function: ToolFunction,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ToolChoiceMode {
    None,
    Auto,
    Required,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ToolChoiceFunction {
    pub name: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ToolChoiceNamed {
    pub function: ToolChoiceFunction,
}

/// `tool_choice` is a mode string or a named function selector.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ToolChoice {
    Mode(ToolChoiceMode),
    Named(ToolChoiceNamed),
}

/// Unknown `response_format` keys pass through, matching the schema's
/// `passthrough()` behaviour.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ResponseFormat {
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub json_schema: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub strict: Option<bool>,
}

/// Unknown `reasoning` keys pass through.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ReasoningOptions {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub effort: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ThinkingType {
    Enabled,
    Disabled,
    Adaptive,
}

/// Unknown `thinking` keys pass through.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ThinkingConfig {
    #[serde(rename = "type", skip_serializing_if = "Option::is_none")]
    pub kind: Option<ThinkingType>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub budget_tokens: Option<u32>,
}

/// `thinking` is either a flag or a configuration object.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Thinking {
    Flag(bool),
    Config(ThinkingConfig),
}

/// An OpenAI-compatible chat completion request.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ChatCompletionRequest {
    pub model: String,
    pub messages: Vec<ChatMessage>,
    #[serde(default)]
    pub stream: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stream_options: Option<StreamOptions>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub top_p: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub n: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stop: Option<StopSequence>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_tokens: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub presence_penalty: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub frequency_penalty: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tools: Option<Vec<ToolDefinition>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_choice: Option<ToolChoice>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub response_format: Option<ResponseFormat>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning_effort: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning: Option<ReasoningOptions>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thinking: Option<Thinking>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enable_thinking: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thinking_budget: Option<u32>,
}

impl ChatCompletionRequest {
    /// Enforces the schema's numeric and length bounds. Types and enum values
    /// are already guaranteed by deserialization.
    pub fn validate(&self) -> Result<(), APIError> {
        let model_length = self.model.chars().count();
        if model_length < 1 {
            return Err(invalid_request(
                "String must contain at least 1 character(s)",
                Some("model"),
                "too_small",
            ));
        }
        if model_length > MAX_MODEL_LENGTH {
            return Err(invalid_request(
                "String must contain at most 300 character(s)",
                Some("model"),
                "too_big",
            ));
        }

        if self.messages.is_empty() {
            return Err(invalid_request(
                "Parameter 'messages' cannot be empty",
                Some("messages"),
                "too_small",
            ));
        }
        if self.messages.len() > MAX_MESSAGES {
            return Err(invalid_request(
                "Parameter 'messages' exceeds the maximum of 1000 entries",
                Some("messages"),
                "too_big",
            ));
        }

        if let Some(max_tokens) = self.max_tokens {
            if max_tokens < 1 {
                return Err(invalid_request(
                    "Number must be greater than or equal to 1",
                    Some("max_tokens"),
                    "too_small",
                ));
            }
            if max_tokens > MAX_TOKENS_CAP {
                return Err(invalid_request(
                    "Parameter 'max_tokens' exceeds the gateway maximum",
                    Some("max_tokens"),
                    "too_big",
                ));
            }
        }

        if let Some(n) = self.n {
            if n < 1 {
                return Err(invalid_request(
                    "Number must be greater than or equal to 1",
                    Some("n"),
                    "too_small",
                ));
            }
            if n > MAX_N {
                return Err(invalid_request(
                    "Number must be less than or equal to 8",
                    Some("n"),
                    "too_big",
                ));
            }
        }

        check_range("temperature", self.temperature, 0.0, 2.0)?;
        check_range("top_p", self.top_p, 0.0, 1.0)?;
        check_range("presence_penalty", self.presence_penalty, -2.0, 2.0)?;
        check_range("frequency_penalty", self.frequency_penalty, -2.0, 2.0)?;

        if let Some(user) = &self.user {
            if user.chars().count() > MAX_USER_LENGTH {
                return Err(invalid_request(
                    "String must contain at most 300 character(s)",
                    Some("user"),
                    "too_big",
                ));
            }
        }

        if let Some(tools) = &self.tools {
            if tools.len() > MAX_TOOLS {
                return Err(invalid_request(
                    "Array must contain at most 128 element(s)",
                    Some("tools"),
                    "too_big",
                ));
            }
            for (index, tool) in tools.iter().enumerate() {
                if let Some(parameters) = &tool.function.parameters {
                    if !parameters.is_object() {
                        return Err(invalid_request(
                            "Invalid input: expected object",
                            Some(&format!("tools.{index}.function.parameters")),
                            "invalid_type",
                        ));
                    }
                }
            }
        }

        if let Some(stop) = &self.stop {
            if let StopSequence::List(sequences) = stop {
                if sequences.len() > MAX_STOP_SEQUENCES {
                    return Err(invalid_request(
                        "Array must contain at most 16 element(s)",
                        Some("stop"),
                        "too_big",
                    ));
                }
                if sequences
                    .iter()
                    .any(|sequence| sequence.chars().count() > MAX_STOP_SEQUENCE_LENGTH)
                {
                    return Err(invalid_request(
                        "String must contain at most 1000 character(s)",
                        Some("stop"),
                        "too_big",
                    ));
                }
            }
        }

        if let Some(reasoning_effort) = &self.reasoning_effort {
            if reasoning_effort.chars().count() > MAX_REASONING_TEXT {
                return Err(invalid_request(
                    "String must contain at most 64 character(s)",
                    Some("reasoning_effort"),
                    "too_big",
                ));
            }
        }

        if let Some(reasoning) = &self.reasoning {
            for (field, value) in [
                ("effort", &reasoning.effort),
                ("summary", &reasoning.summary),
            ] {
                if let Some(value) = value {
                    if value.chars().count() > MAX_REASONING_TEXT {
                        return Err(invalid_request(
                            "String must contain at most 64 character(s)",
                            Some(&format!("reasoning.{field}")),
                            "too_big",
                        ));
                    }
                }
            }
        }

        if let Some(thinking_budget) = self.thinking_budget {
            check_positive_cap(thinking_budget, "thinking_budget")?;
        }
        if let Some(Thinking::Config(config)) = &self.thinking {
            if let Some(budget_tokens) = config.budget_tokens {
                check_positive_cap(budget_tokens, "thinking.budget_tokens")?;
            }
        }

        Ok(())
    }
}

fn check_range(param: &str, value: Option<f64>, min: f64, max: f64) -> Result<(), APIError> {
    let Some(value) = value else {
        return Ok(());
    };
    if value < min {
        return Err(invalid_request(
            format!("Number must be greater than or equal to {min}"),
            Some(param),
            "too_small",
        ));
    }
    if value > max {
        return Err(invalid_request(
            format!("Number must be less than or equal to {max}"),
            Some(param),
            "too_big",
        ));
    }
    Ok(())
}

fn check_positive_cap(value: u32, param: &str) -> Result<(), APIError> {
    if value < 1 {
        return Err(invalid_request(
            "Number must be greater than or equal to 1",
            Some(param),
            "too_small",
        ));
    }
    if value > MAX_TOKENS_CAP {
        return Err(invalid_request(
            "Number must be less than or equal to 1000000",
            Some(param),
            "too_big",
        ));
    }
    Ok(())
}
