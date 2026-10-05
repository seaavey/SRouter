use axum::body::Bytes;
use serde_json::Value;

use super::types::generate_id;

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
struct ToolTracker {
    anthropic_index: i32,
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
