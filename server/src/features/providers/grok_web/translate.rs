//! Translation between the grok.com NDJSON frames and OpenAI chat-completion
//! chunks, including the text-channel tool-call emulation and usage accounting.

use std::collections::VecDeque;
use std::time::Duration;

use axum::body::Bytes;
use serde_json::{Value, json};

use super::transport::GrokSocket;
use crate::clock::now_ms;
use crate::protocol::usage::UsageBreakdown;

/// Mutable state of the streaming translation.
pub(super) struct TranslateState {
    pub(super) ws: GrokSocket,
    pub(super) id: String,
    pub(super) created: i64,
    pub(super) model: String,
    pub(super) pending: VecDeque<Bytes>,
    pub(super) finished: bool,
    pub(super) idle_timeout: Duration,
    pub(super) prompt_tokens: i64,
    pub(super) completion_chars: usize,
    /// When set, assistant text is accumulated in `buffer` instead of streamed,
    /// so a completed turn can be re-read as a tool envelope or as text.
    pub(super) tool_mode: bool,
    pub(super) buffer: String,
}

/// Rough token estimate (chars / 4) used because the upstream reports no usage.
pub(super) fn estimate_tokens(text: &str) -> i64 {
    (text.chars().count() / 4).max(1) as i64
}

pub(super) fn encode_frame(
    id: &str,
    created: i64,
    model: &str,
    delta: Value,
    finish_reason: Option<&str>,
    usage: Option<Value>,
) -> Bytes {
    let mut frame = json!({
        "id": id,
        "object": "chat.completion.chunk",
        "created": created,
        "model": model,
        "choices": [{
            "index": 0,
            "delta": delta,
            "finish_reason": finish_reason
        }]
    });
    if let Some(usage) = usage {
        frame["usage"] = usage;
    }
    Bytes::from(format!("data: {frame}\n\n"))
}

pub(super) fn chunk_id() -> String {
    let mut bytes = [0u8; 16];
    let _ = getrandom::fill(&mut bytes);
    format!("chatcmpl-{}", hex::encode(bytes))
}

/// One function call the model asked for, decoded from its emulated JSON reply.
pub(super) struct ParsedToolCall {
    pub(super) name: String,
    pub(super) arguments: String,
}

/// Decodes an emulated tool-call envelope from the assistant text. Accepts the
/// JSON alone, inside a ```json fence, or as the first balanced object in prose.
/// Anything without a non-empty, well-formed `tool_calls` array yields `None`.
pub(super) fn parse_tool_calls(content: &str) -> Option<Vec<ParsedToolCall>> {
    let candidate = extract_first_object(content)?;
    let value: Value = serde_json::from_str(candidate).ok()?;
    let calls = value.get("tool_calls")?.as_array()?;
    if calls.is_empty() {
        return None;
    }

    let mut parsed = Vec::with_capacity(calls.len());
    for call in calls {
        let name = call.get("name").and_then(Value::as_str)?.trim();
        if name.is_empty() {
            return None;
        }
        let arguments = match call.get("arguments") {
            Some(Value::String(text)) => text.clone(),
            Some(value) => serde_json::to_string(value).ok()?,
            None => "{}".to_owned(),
        };
        parsed.push(ParsedToolCall {
            name: name.to_owned(),
            arguments,
        });
    }
    Some(parsed)
}

/// Returns the first balanced `{...}` object in `text`, ignoring braces inside
/// string literals. `None` when the text has no complete object.
pub(super) fn extract_first_object(text: &str) -> Option<&str> {
    let start = text.find('{')?;
    let mut depth = 0usize;
    let mut in_string = false;
    let mut escaped = false;

    for (offset, byte) in text.as_bytes()[start..].iter().enumerate() {
        let index = start + offset;
        if in_string {
            if escaped {
                escaped = false;
            } else if *byte == b'\\' {
                escaped = true;
            } else if *byte == b'"' {
                in_string = false;
            }
            continue;
        }
        match *byte {
            b'"' => in_string = true,
            b'{' => depth += 1,
            b'}' => {
                depth -= 1;
                if depth == 0 {
                    return Some(&text[start..=index]);
                }
            }
            _ => {}
        }
    }
    None
}

fn tool_call_id() -> String {
    let mut bytes = [0u8; 12];
    let _ = getrandom::fill(&mut bytes);
    format!("call_{}", hex::encode(bytes))
}

/// The OpenAI `tool_calls` delta for a streaming frame.
pub(super) fn tool_calls_delta(calls: &[ParsedToolCall]) -> Value {
    let entries: Vec<Value> = calls
        .iter()
        .enumerate()
        .map(|(index, call)| {
            json!({
                "index": index,
                "id": tool_call_id(),
                "type": "function",
                "function": { "name": call.name, "arguments": call.arguments }
            })
        })
        .collect();
    json!({ "tool_calls": entries })
}

/// A non-streaming completion whose only choice is a set of tool calls.
pub(super) fn tool_call_response(
    model: &str,
    calls: &[ParsedToolCall],
    prompt_tokens: i64,
    reasoning: &str,
) -> Value {
    let tool_calls: Vec<Value> = calls
        .iter()
        .map(|call| {
            json!({
                "id": tool_call_id(),
                "type": "function",
                "function": { "name": call.name, "arguments": call.arguments }
            })
        })
        .collect();
    let call_chars: usize = calls
        .iter()
        .map(|call| call.name.chars().count() + call.arguments.chars().count())
        .sum();
    let completion_tokens = (call_chars / 4).max(1) as i64;
    let usage = UsageBreakdown {
        prompt_tokens,
        completion_tokens,
        total_tokens: prompt_tokens + completion_tokens,
        ..Default::default()
    };

    let mut message = json!({
        "role": "assistant",
        "content": Value::Null,
        "tool_calls": tool_calls
    });
    if !reasoning.is_empty() {
        message["reasoning_content"] = Value::String(reasoning.to_owned());
    }

    json!({
        "id": chunk_id(),
        "object": "chat.completion",
        "created": now_ms() / 1000,
        "model": model,
        "choices": [{ "index": 0, "message": message, "finish_reason": "tool_calls" }],
        "usage": usage.to_openai_json()
    })
}
