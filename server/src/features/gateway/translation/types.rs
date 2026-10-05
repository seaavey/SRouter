use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Generates an Anthropic-formatted identifier (e.g. `msg_...` or `toolu_...`).
pub fn generate_id(prefix: &str) -> String {
    let mut bytes = [0u8; 12];
    let _ = getrandom::fill(&mut bytes);
    format!("{prefix}_{}", hex::encode(bytes))
}

/// The `call_<8 hex>` id Node mints for a `tool_use` block that arrived
/// without one (probed: `call_f7d3e216`).
pub(super) fn generate_call_id() -> String {
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
