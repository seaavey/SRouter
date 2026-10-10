//! OpenAI-compatible chat wire types shared by the gateway handler and the
//! provider adapters that speak the same protocol. The field set mirrors
//! `ChatCompletionRequestSchema` in `packages/types`: unknown fields are
//! dropped while parsing and every documented bound is enforced here, so an
//! invalid body fails with `400` before any provider is contacted.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::constants;
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
            constants::gateway::MODEL_REQUIRED,
            Some("model"),
            constants::ErrorCode::InvalidType,
        ));
    }
    if body.get("messages").is_none() {
        return Err(invalid_request(
            constants::gateway::MESSAGES_REQUIRED,
            Some("messages"),
            constants::ErrorCode::InvalidType,
        ));
    }

    let request: ChatCompletionRequest = serde_json::from_value(body).map_err(|error| {
        invalid_request(
            constants::gateway::invalid_request_body(&error),
            None,
            constants::ErrorCode::InvalidType,
        )
    })?;
    request.validate()?;

    Ok(request)
}

fn invalid_request(
    message: impl Into<String>,
    param: Option<&str>,
    code: constants::ErrorCode,
) -> APIError {
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
                formatter.write_str(constants::gateway::schema::CONTENT_DESCRIPTION)
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

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CacheControl {
    pub r#type: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ContentPart {
    #[serde(rename = "type")]
    pub kind: ContentPartType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image_url: Option<ImageUrl>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cache_control: Option<CacheControl>,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cache_control: Option<CacheControl>,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cache_control: Option<CacheControl>,
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

/// A named function selector. The `type` discriminator is required: Node's
/// schema rejects a named selector without it (probed `400 Invalid input`)
/// and the upstream body always carries `{"type":"function", ...}` (probed).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ToolChoiceNamed {
    #[serde(rename = "type")]
    pub kind: ToolKind,
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

/// The reasoning levels the OpenAI wire protocol accepts. Anything outside this
/// set is not a level, so a caller can fall back instead of forwarding a value
/// upstream would reject.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ReasoningEffort {
    None,
    Minimal,
    Low,
    Medium,
    High,
    Xhigh,
}

impl ReasoningEffort {
    /// Every level, weakest first, in the order upstream documents them.
    const ALL: [Self; 6] = [
        Self::None,
        Self::Minimal,
        Self::Low,
        Self::Medium,
        Self::High,
        Self::Xhigh,
    ];

    /// The wire spelling.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::None => "none",
            Self::Minimal => "minimal",
            Self::Low => "low",
            Self::Medium => "medium",
            Self::High => "high",
            Self::Xhigh => "xhigh",
        }
    }

    /// Reads a level off the wire, case-insensitively. An unknown value yields
    /// `None` so the caller decides the fallback.
    pub fn from_wire(value: &str) -> Option<Self> {
        let value = value.trim();
        Self::ALL
            .into_iter()
            .find(|level| level.as_str().eq_ignore_ascii_case(value))
    }

    /// Whether the level turns reasoning off.
    pub fn is_disabled(self) -> bool {
        self == Self::None
    }
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt_cache_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt_cache_retention: Option<String>,
}

impl ChatCompletionRequest {
    /// Enforces the schema's numeric and length bounds. Types and enum values
    /// are already guaranteed by deserialization.
    pub fn validate(&self) -> Result<(), APIError> {
        let model_length = self.model.chars().count();
        if model_length < 1 {
            return Err(invalid_request(
                constants::gateway::schema::STRING_MIN_1,
                Some("model"),
                constants::ErrorCode::TooSmall,
            ));
        }
        if model_length > MAX_MODEL_LENGTH {
            return Err(invalid_request(
                constants::gateway::schema::STRING_MAX_300,
                Some("model"),
                constants::ErrorCode::TooBig,
            ));
        }

        if self.messages.is_empty() {
            return Err(invalid_request(
                constants::gateway::schema::MESSAGES_NOT_EMPTY,
                Some("messages"),
                constants::ErrorCode::TooSmall,
            ));
        }
        if self.messages.len() > MAX_MESSAGES {
            return Err(invalid_request(
                constants::gateway::schema::MESSAGES_MAX_1000,
                Some("messages"),
                constants::ErrorCode::TooBig,
            ));
        }

        if let Some(max_tokens) = self.max_tokens {
            if max_tokens < 1 {
                return Err(invalid_request(
                    constants::gateway::schema::NUMBER_MIN_1,
                    Some("max_tokens"),
                    constants::ErrorCode::TooSmall,
                ));
            }
            if max_tokens > MAX_TOKENS_CAP {
                return Err(invalid_request(
                    constants::gateway::schema::MAX_TOKENS_ABOVE_CAP,
                    Some("max_tokens"),
                    constants::ErrorCode::TooBig,
                ));
            }
        }

        if let Some(n) = self.n {
            if n < 1 {
                return Err(invalid_request(
                    constants::gateway::schema::NUMBER_MIN_1,
                    Some("n"),
                    constants::ErrorCode::TooSmall,
                ));
            }
            if n > MAX_N {
                return Err(invalid_request(
                    constants::gateway::schema::NUMBER_MAX_8,
                    Some("n"),
                    constants::ErrorCode::TooBig,
                ));
            }
        }

        check_range("temperature", self.temperature, 0.0, 2.0)?;
        check_range("top_p", self.top_p, 0.0, 1.0)?;
        check_range("presence_penalty", self.presence_penalty, -2.0, 2.0)?;
        check_range("frequency_penalty", self.frequency_penalty, -2.0, 2.0)?;

        if let Some(user) = &self.user
            && user.chars().count() > MAX_USER_LENGTH
        {
            return Err(invalid_request(
                constants::gateway::schema::STRING_MAX_300,
                Some("user"),
                constants::ErrorCode::TooBig,
            ));
        }

        if let Some(tools) = &self.tools {
            if tools.len() > MAX_TOOLS {
                return Err(invalid_request(
                    constants::gateway::schema::ARRAY_MAX_128,
                    Some("tools"),
                    constants::ErrorCode::TooBig,
                ));
            }
            for (index, tool) in tools.iter().enumerate() {
                if let Some(parameters) = &tool.function.parameters
                    && !parameters.is_object()
                {
                    return Err(invalid_request(
                        constants::gateway::schema::EXPECTED_OBJECT,
                        Some(&format!("tools.{index}.function.parameters")),
                        constants::ErrorCode::InvalidType,
                    ));
                }
            }
        }

        if let Some(stop) = &self.stop
            && let StopSequence::List(sequences) = stop
        {
            if sequences.len() > MAX_STOP_SEQUENCES {
                return Err(invalid_request(
                    constants::gateway::schema::ARRAY_MAX_16,
                    Some("stop"),
                    constants::ErrorCode::TooBig,
                ));
            }
            if sequences
                .iter()
                .any(|sequence| sequence.chars().count() > MAX_STOP_SEQUENCE_LENGTH)
            {
                return Err(invalid_request(
                    constants::gateway::schema::STRING_MAX_1000,
                    Some("stop"),
                    constants::ErrorCode::TooBig,
                ));
            }
        }

        if let Some(reasoning_effort) = &self.reasoning_effort
            && reasoning_effort.chars().count() > MAX_REASONING_TEXT
        {
            return Err(invalid_request(
                constants::gateway::schema::STRING_MAX_64,
                Some("reasoning_effort"),
                constants::ErrorCode::TooBig,
            ));
        }

        if let Some(reasoning) = &self.reasoning {
            for (field, value) in [
                ("effort", &reasoning.effort),
                ("summary", &reasoning.summary),
            ] {
                if let Some(value) = value
                    && value.chars().count() > MAX_REASONING_TEXT
                {
                    return Err(invalid_request(
                        constants::gateway::schema::STRING_MAX_64,
                        Some(&format!("reasoning.{field}")),
                        constants::ErrorCode::TooBig,
                    ));
                }
            }
        }

        if let Some(thinking_budget) = self.thinking_budget {
            check_positive_cap(thinking_budget, "thinking_budget")?;
        }
        if let Some(Thinking::Config(config)) = &self.thinking
            && let Some(budget_tokens) = config.budget_tokens
        {
            check_positive_cap(budget_tokens, "thinking.budget_tokens")?;
        }

        if let Some(prompt_cache_key) = &self.prompt_cache_key
            && prompt_cache_key.chars().count() > MAX_MODEL_LENGTH
        {
            return Err(invalid_request(
                constants::gateway::schema::STRING_MAX_300,
                Some("prompt_cache_key"),
                constants::ErrorCode::TooBig,
            ));
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
            constants::gateway::schema::number_min(min),
            Some(param),
            constants::ErrorCode::TooSmall,
        ));
    }
    if value > max {
        return Err(invalid_request(
            constants::gateway::schema::number_max(max),
            Some(param),
            constants::ErrorCode::TooBig,
        ));
    }
    Ok(())
}

fn check_positive_cap(value: u32, param: &str) -> Result<(), APIError> {
    if value < 1 {
        return Err(invalid_request(
            constants::gateway::schema::NUMBER_MIN_1,
            Some(param),
            constants::ErrorCode::TooSmall,
        ));
    }
    if value > MAX_TOKENS_CAP {
        return Err(invalid_request(
            constants::gateway::schema::NUMBER_MAX_1000000,
            Some(param),
            constants::ErrorCode::TooBig,
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::ReasoningEffort;

    #[test]
    fn every_level_round_trips_through_the_wire_spelling() {
        for level in ReasoningEffort::ALL {
            assert_eq!(ReasoningEffort::from_wire(level.as_str()), Some(level));
        }
    }

    #[test]
    fn a_level_is_read_case_insensitively_and_trimmed() {
        assert_eq!(
            ReasoningEffort::from_wire("  HIGH "),
            Some(ReasoningEffort::High)
        );
        assert_eq!(
            ReasoningEffort::from_wire("XHigh"),
            Some(ReasoningEffort::Xhigh)
        );
    }

    #[test]
    fn an_unknown_or_absent_level_is_not_a_level() {
        assert_eq!(ReasoningEffort::from_wire("sok-ajaib"), None);
        assert_eq!(ReasoningEffort::from_wire(""), None);
        assert_eq!(ReasoningEffort::from_wire("  "), None);
        assert_eq!(
            ReasoningEffort::from_wire("medium"),
            Some(ReasoningEffort::Medium)
        );
    }

    #[test]
    fn only_none_is_disabled() {
        assert!(ReasoningEffort::None.is_disabled());
        for level in ReasoningEffort::ALL {
            if level != ReasoningEffort::None {
                assert!(!level.is_disabled(), "{level:?}");
            }
        }
    }
}
