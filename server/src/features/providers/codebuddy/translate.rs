//! Translates CodeBuddy's line-delimited stream into OpenAI frames, for both the
//! streamed and the buffered paths.

use std::collections::{BTreeMap, VecDeque};
use std::pin::Pin;

use axum::body::Bytes;
use futures_util::{Stream, StreamExt};
use serde_json::{Value, json};

use crate::clock::now_ms;
use crate::constants;
use crate::error::APIError;
use crate::features::providers::adapter::ProviderStream;
use crate::features::providers::wire::stream_error_message;
use crate::infrastructure::upstream::STREAM_IDLE_TIMEOUT;
use crate::protocol::sse;

#[derive(Debug)]
pub(super) enum DecodedFrame {
    Data(Value),
    Done,
    Error(APIError),
}

/// Splits the upstream body into trimmed lines and decodes each one, handling
/// both OpenAI `data: {...}` framing and raw NDJSON lines (Node's `streamLines`
/// + `parseDataLine`). Malformed JSON is skipped, exactly as the oracle does.
#[derive(Default)]
pub(super) struct LineDecoder {
    buffer: String,
    finished: bool,
}

impl LineDecoder {
    pub(super) fn push(&mut self, bytes: &[u8]) -> Vec<DecodedFrame> {
        if self.finished {
            return Vec::new();
        }
        self.buffer.push_str(&String::from_utf8_lossy(bytes));
        let mut frames = Vec::new();

        while let Some(position) = self.buffer.find('\n') {
            let line = self.buffer[..position].trim().to_owned();
            self.buffer.drain(..=position);
            if let Some(frame) = self.decode_line(&line) {
                frames.push(frame);
                if self.finished {
                    break;
                }
            }
        }

        frames
    }

    pub(super) fn finish(&mut self) -> Vec<DecodedFrame> {
        if self.finished {
            return Vec::new();
        }
        let line = self.buffer.trim().to_owned();
        self.buffer.clear();
        self.decode_line(&line).into_iter().collect()
    }

    fn decode_line(&mut self, line: &str) -> Option<DecodedFrame> {
        let payload = line.strip_prefix("data:").map(str::trim).unwrap_or(line);
        if payload.is_empty() {
            return None;
        }
        if payload == "[DONE]" {
            self.finished = true;
            return Some(DecodedFrame::Done);
        }

        let Ok(value) = serde_json::from_str::<Value>(payload) else {
            return None;
        };
        if let Some(message) = stream_error_message(&value, "CodeBuddy stream failed") {
            self.finished = true;
            return Some(DecodedFrame::Error(APIError::new(500, message)));
        }
        Some(DecodedFrame::Data(value))
    }
}

pub(super) fn translate_stream<S>(upstream: S) -> ProviderStream
where
    S: Stream<Item = Result<Bytes, reqwest::Error>> + Send + 'static,
{
    type State<S> = Option<(Pin<Box<S>>, LineDecoder, VecDeque<Bytes>, bool)>;

    let state: State<S> = Some((
        Box::pin(upstream),
        LineDecoder::default(),
        VecDeque::new(),
        false,
    ));
    let events = futures_util::stream::unfold(state, |state| async move {
        let (mut upstream, mut decoder, mut pending, mut done) = state?;

        loop {
            if let Some(frame) = pending.pop_front() {
                return Some((frame, Some((upstream, decoder, pending, done))));
            }
            if done {
                return None;
            }

            match tokio::time::timeout(STREAM_IDLE_TIMEOUT, upstream.next()).await {
                Ok(Some(Ok(bytes))) => {
                    let mut saw_done = false;
                    for frame in decoder.push(&bytes) {
                        if matches!(frame, DecodedFrame::Done) {
                            saw_done = true;
                        }
                        pending.push_back(encode_frame(frame));
                    }
                    if saw_done {
                        done = true;
                    }
                }
                Ok(Some(Err(error))) => {
                    let failure =
                        APIError::new(500, constants::providers::upstream_stream_failed(&error));
                    pending.push_back(sse::error_event_bytes(&failure));
                    done = true;
                }
                Ok(None) => {
                    let mut saw_done = false;
                    for frame in decoder.finish() {
                        if matches!(frame, DecodedFrame::Done) {
                            saw_done = true;
                        }
                        pending.push_back(encode_frame(frame));
                    }
                    if !saw_done {
                        pending.push_back(Bytes::from_static(b"data: [DONE]\n\n"));
                    }
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

fn encode_frame(frame: DecodedFrame) -> Bytes {
    match frame {
        DecodedFrame::Data(value) => Bytes::from(format!("data: {value}\n\n")),
        DecodedFrame::Done => Bytes::from_static(b"data: [DONE]\n\n"),
        DecodedFrame::Error(error) => sse::error_event_bytes(&error),
    }
}

#[derive(Default)]
struct ToolCallAccumulator {
    id: String,
    name: String,
    arguments: String,
}

pub(super) struct Aggregator {
    model: String,
    id: String,
    created: i64,
    content: String,
    reasoning: String,
    finish_reason: Option<String>,
    usage: Option<Value>,
    tool_calls: BTreeMap<usize, ToolCallAccumulator>,
}

impl Aggregator {
    pub(super) fn new(model: &str) -> Self {
        let now = now_ms();
        Self {
            model: model.to_owned(),
            id: format!("chatcmpl-{now}"),
            created: now / 1000,
            content: String::new(),
            reasoning: String::new(),
            finish_reason: None,
            usage: None,
            tool_calls: BTreeMap::new(),
        }
    }

    pub(super) fn accept(&mut self, frame: DecodedFrame) -> Result<(), APIError> {
        match frame {
            DecodedFrame::Data(value) => self.accept_value(value),
            DecodedFrame::Done => Ok(()),
            DecodedFrame::Error(error) => Err(error),
        }
    }

    fn accept_value(&mut self, value: Value) -> Result<(), APIError> {
        if let Some(usage) = value.get("usage").filter(|usage| !usage.is_null()) {
            self.usage = Some(usage.clone());
        }

        let Some(choice) = value
            .get("choices")
            .and_then(Value::as_array)
            .and_then(|choices| choices.first())
        else {
            return Ok(());
        };
        if let Some(reason) = choice.get("finish_reason").and_then(Value::as_str) {
            self.finish_reason = Some(reason.to_owned());
        }

        let Some(delta) = choice.get("delta") else {
            return Ok(());
        };
        if let Some(content) = delta.get("content").and_then(Value::as_str) {
            self.content.push_str(content);
        }
        let reasoning = match delta.get("reasoning_content").and_then(Value::as_str) {
            Some(text) if !text.is_empty() => Some(text),
            _ => delta.get("reasoning").and_then(Value::as_str),
        };
        if let Some(reasoning) = reasoning {
            self.reasoning.push_str(reasoning);
        }

        for call in delta
            .get("tool_calls")
            .and_then(Value::as_array)
            .map(Vec::as_slice)
            .unwrap_or_default()
        {
            let index = call.get("index").and_then(Value::as_u64).unwrap_or(0) as usize;
            let entry = self.tool_calls.entry(index).or_default();
            // Upstream repeats the call on every argument chunk with an empty
            // id/name, so only a non-empty value may overwrite the one that
            // introduced it (Node's `if (tc.id)` / `if (name)` truthiness).
            if let Some(id) = call.get("id").and_then(Value::as_str)
                && !id.is_empty()
            {
                entry.id = id.to_owned();
            }
            if let Some(name) = call
                .get("function")
                .and_then(|function| function.get("name"))
                .and_then(Value::as_str)
                && !name.is_empty()
            {
                entry.name = name.to_owned();
            }
            if let Some(arguments) = call
                .get("function")
                .and_then(|function| function.get("arguments"))
                .and_then(Value::as_str)
            {
                entry.arguments.push_str(arguments);
            }
        }

        Ok(())
    }

    pub(super) fn finish(self) -> Value {
        let tool_calls: Vec<Value> = self
            .tool_calls
            .into_values()
            .map(|entry| {
                json!({
                    "id": entry.id,
                    "type": "function",
                    "function": { "name": entry.name, "arguments": entry.arguments }
                })
            })
            .collect();
        let has_tool_calls = !tool_calls.is_empty();

        // Reasoning-only models (glm-5.3, kimi-k3) can finish with no content;
        // the reasoning text is the only answer the caller can be given.
        let effective_content = if !self.content.is_empty() {
            Value::String(self.content.clone())
        } else if !self.reasoning.is_empty() {
            Value::String(self.reasoning.clone())
        } else {
            Value::Null
        };

        let mut message = json!({
            "role": "assistant",
            "content": effective_content,
        });
        if !self.reasoning.is_empty() {
            message["reasoning_content"] = Value::String(self.reasoning);
        }
        if has_tool_calls {
            message["tool_calls"] = Value::Array(tool_calls);
        }

        let mut response = json!({
            "id": self.id,
            "object": "chat.completion",
            "created": self.created,
            "model": self.model,
            "choices": [{
                "index": 0,
                "message": message,
                "finish_reason": self.finish_reason.unwrap_or_else(|| "stop".to_owned()),
            }],
        });
        if let Some(usage) = self.usage {
            response["usage"] = usage;
        }

        response
    }
}
