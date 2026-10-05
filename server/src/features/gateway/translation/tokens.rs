use serde_json::Value;

use super::types::AnthropicMessageRequest;
use super::*;

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
