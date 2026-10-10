//! The Anthropic Messages wire translation shared by every driver that speaks
//! that protocol: the Claude Code OAuth driver and a custom provider registered
//! with `protocol: "anthropic"`.
//!
//! Three pieces: the OpenAI request turned into a Messages body, the buffered
//! Messages response turned back into an OpenAI completion, and the Messages SSE
//! stream re-framed as OpenAI chunk frames. The mapping mirrors the oracle
//! (`packages/translator/src/adapter.ts`), reproduced rather than imported.

use std::collections::VecDeque;
use std::pin::Pin;

use axum::body::Bytes;
use futures_util::{Stream, StreamExt};
use serde_json::{Value, json};

use crate::clock::now_ms;
use crate::constants;
use crate::error::APIError;
use crate::features::providers::adapter::ProviderStream;
use crate::infrastructure::upstream::STREAM_IDLE_TIMEOUT;
use crate::protocol::model::{ChatCompletionRequest, ChatContent, ChatRole};
use crate::protocol::sse;

/// Builds the Anthropic Messages body from the internal OpenAI request,
/// mirroring `OpenAIToAnthropicRequest`: the last system message becomes the
/// top-level `system` prompt, user/assistant turns pass through, and a missing
/// `max_tokens` defaults to `4096`.
pub fn anthropic_body(request: &ChatCompletionRequest, model: &str, stream: bool) -> Value {
    let mut system: Option<String> = None;
    let mut messages: Vec<Value> = Vec::new();

    for message in &request.messages {
        match message.role {
            ChatRole::System => {
                system = Some(chat_content_system(&message.content));
            }
            ChatRole::User | ChatRole::Assistant => {
                let role = if message.role == ChatRole::Assistant {
                    "assistant"
                } else {
                    "user"
                };
                messages
                    .push(json!({ "role": role, "content": chat_content_value(&message.content) }));
            }
            _ => {}
        }
    }

    let mut body = json!({
        "model": model,
        "messages": messages,
        "max_tokens": request.max_tokens.unwrap_or(4096),
        "stream": stream,
    });
    if let Some(system) = system {
        body["system"] = Value::String(system);
    }
    if let Some(temperature) = request.temperature {
        body["temperature"] = json!(temperature);
    }
    if let Some(top_p) = request.top_p {
        body["top_p"] = json!(top_p);
    }

    body
}

/// A system message as a plain string; content parts serialize to their JSON
/// text, matching the oracle's `JSON.stringify`.
fn chat_content_system(content: &ChatContent) -> String {
    match content {
        ChatContent::Text(text) => text.clone(),
        ChatContent::Parts(parts) => serde_json::to_string(parts).unwrap_or_default(),
        ChatContent::Null => String::new(),
    }
}

/// A user/assistant message content value: a string stays a string, parts stay
/// an array, and `null` becomes an empty string (the oracle's `?? ""`).
fn chat_content_value(content: &ChatContent) -> Value {
    match content {
        ChatContent::Text(text) => Value::String(text.clone()),
        ChatContent::Parts(parts) => {
            serde_json::to_value(parts).unwrap_or(Value::String(String::new()))
        }
        ChatContent::Null => Value::String(String::new()),
    }
}

/// Translates an Anthropic message response into an OpenAI chat completion,
/// mirroring `AnthropicToOpenAIResponse`: text blocks join, `max_tokens` maps to
/// `length`, and usage is the two token counts.
pub fn anthropic_response_to_openai(payload: &Value, requested_model: &str, created: i64) -> Value {
    let text = payload
        .get("content")
        .and_then(Value::as_array)
        .map(|blocks| {
            blocks
                .iter()
                .filter(|block| block.get("type").and_then(Value::as_str) == Some("text"))
                .filter_map(|block| block.get("text").and_then(Value::as_str))
                .collect::<Vec<_>>()
                .join("")
        })
        .unwrap_or_default();
    let finish_reason = if payload.get("stop_reason").and_then(Value::as_str) == Some("max_tokens")
    {
        "length"
    } else {
        "stop"
    };
    let input_tokens = payload
        .pointer("/usage/input_tokens")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let output_tokens = payload
        .pointer("/usage/output_tokens")
        .and_then(Value::as_u64)
        .unwrap_or(0);

    json!({
        "id": payload.get("id").and_then(Value::as_str).unwrap_or_default(),
        "object": "chat.completion",
        "created": created,
        "model": requested_model,
        "choices": [{
            "index": 0,
            "message": { "role": "assistant", "content": text },
            "finish_reason": finish_reason,
        }],
        "usage": {
            "prompt_tokens": input_tokens,
            "completion_tokens": output_tokens,
            "total_tokens": input_tokens + output_tokens,
        },
    })
}

/// The per-stream translation state: the model to stamp on each chunk and the
/// completion id carried from `message_start`.
struct AnthropicStreamState {
    model: String,
    completion_id: String,
    event: String,
}

impl AnthropicStreamState {
    fn new(model: String) -> Self {
        Self {
            model,
            completion_id: "chatcmpl-0".to_owned(),
            event: String::new(),
        }
    }
}

/// Re-frames the upstream Anthropic SSE body as OpenAI chunk frames, ending the
/// response with exactly one `data: [DONE]`.
pub fn stream_response<S>(upstream: S, model: String) -> ProviderStream
where
    S: Stream<Item = Result<Bytes, reqwest::Error>> + Send + 'static,
{
    type State<S> = (
        Pin<Box<S>>,
        String,
        AnthropicStreamState,
        VecDeque<Bytes>,
        bool,
    );

    let state: State<S> = (
        Box::pin(upstream),
        String::new(),
        AnthropicStreamState::new(model),
        VecDeque::new(),
        false,
    );

    let events = futures_util::stream::unfold(state, |state| async move {
        let (mut upstream, mut buffer, mut stream_state, mut pending, mut done) = state;

        loop {
            if let Some(frame) = pending.pop_front() {
                return Some((frame, (upstream, buffer, stream_state, pending, done)));
            }
            if done {
                return None;
            }

            match tokio::time::timeout(STREAM_IDLE_TIMEOUT, upstream.next()).await {
                Ok(Some(Ok(bytes))) => {
                    buffer.push_str(&String::from_utf8_lossy(&bytes));
                    translate_frames(&mut buffer, &mut stream_state, &mut pending);
                }
                Ok(Some(Err(error))) => {
                    let failure =
                        APIError::new(500, constants::providers::upstream_stream_failed(&error));
                    pending.push_back(sse::error_event_bytes(&failure));
                    done = true;
                }
                Ok(None) => {
                    buffer.push('\n');
                    translate_frames(&mut buffer, &mut stream_state, &mut pending);
                    pending.push_back(Bytes::from_static(b"data: [DONE]\n\n"));
                    done = true;
                }
                Err(_) => {
                    let failure = APIError::new(
                        500,
                        constants::providers::upstream_stalled(STREAM_IDLE_TIMEOUT.as_secs()),
                    );
                    pending.push_back(sse::error_event_bytes(&failure));
                    done = true;
                }
            }
        }
    });

    Box::pin(events)
}

/// Drains every complete line from the buffer, tracking the current SSE event
/// name and appending the OpenAI frames each Anthropic event translates to.
fn translate_frames(
    buffer: &mut String,
    stream_state: &mut AnthropicStreamState,
    pending: &mut VecDeque<Bytes>,
) {
    while let Some(position) = buffer.find('\n') {
        let line = buffer[..position].trim().to_owned();
        buffer.drain(..=position);

        if let Some(name) = line.strip_prefix("event:") {
            stream_state.event = name.trim().to_owned();
            continue;
        }
        let payload = line.strip_prefix("data:").map(str::trim).unwrap_or(&line);
        if payload.is_empty() {
            continue;
        }
        let Ok(frame) = serde_json::from_str::<Value>(payload) else {
            continue;
        };

        match stream_state.event.as_str() {
            "message_start" => {
                if let Some(id) = frame.pointer("/message/id").and_then(Value::as_str) {
                    stream_state.completion_id = id.to_owned();
                }
            }
            "content_block_delta" => {
                let text = frame
                    .pointer("/delta/text")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                let chunk = json!({
                    "id": stream_state.completion_id,
                    "object": "chat.completion.chunk",
                    "created": now_ms() / 1000,
                    "model": stream_state.model,
                    "choices": [{ "index": 0, "delta": { "content": text }, "finish_reason": null }],
                });
                pending.push_back(Bytes::from(format!("data: {chunk}\n\n")));
            }
            "message_stop" => {
                let chunk = json!({
                    "id": stream_state.completion_id,
                    "object": "chat.completion.chunk",
                    "created": now_ms() / 1000,
                    "model": stream_state.model,
                    "choices": [{ "index": 0, "delta": {}, "finish_reason": "stop" }],
                });
                pending.push_back(Bytes::from(format!("data: {chunk}\n\n")));
            }
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{anthropic_body, anthropic_response_to_openai};
    use crate::protocol::model::ChatCompletionRequest;
    use serde_json::json;

    fn request() -> ChatCompletionRequest {
        serde_json::from_value(json!({
            "model": "claude-x",
            "messages": [
                { "role": "system", "content": "be terse" },
                { "role": "user", "content": "hi" }
            ]
        }))
        .expect("request parses")
    }

    #[test]
    fn moves_the_system_message_out_of_the_turn_list() {
        let body = anthropic_body(&request(), "claude-x", false);

        assert_eq!(body["system"], "be terse");
        assert_eq!(body["messages"].as_array().unwrap().len(), 1);
        assert_eq!(body["max_tokens"], 4096);
        assert_eq!(body["stream"], false);
    }

    #[test]
    fn maps_max_tokens_stop_reason_to_length() {
        let payload = json!({
            "id": "msg_1",
            "content": [{ "type": "text", "text": "hello" }],
            "stop_reason": "max_tokens",
            "usage": { "input_tokens": 3, "output_tokens": 5 }
        });

        let completion = anthropic_response_to_openai(&payload, "claude-x", 1);

        assert_eq!(completion["choices"][0]["finish_reason"], "length");
        assert_eq!(completion["choices"][0]["message"]["content"], "hello");
        assert_eq!(completion["usage"]["total_tokens"], 8);
    }
}
