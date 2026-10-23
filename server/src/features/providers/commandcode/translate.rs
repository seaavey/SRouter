//! Translates Command Code's line-delimited events into OpenAI SSE frames, for
//! both the streamed and the buffered paths.
//!
//! The relay answers `HTTP 200` with NDJSON — one event per line, no `data:`
//! prefix — and can carry a failure *inside* that stream
//! (`{"type":"error","statusCode":402,"error":"Insufficient Balance"}`). That is
//! a failure, not an empty completion, and a stream that stops before `finish`
//! is reported the same way: handing the caller a silently empty turn is worse
//! than an error. Oracle: `_iter_events` / `_iter_stream` in the Hermes plugin.

use std::collections::VecDeque;
use std::pin::Pin;

use axum::body::Bytes;
use futures_util::{Stream, StreamExt};
use serde_json::{Value, json};

use crate::clock::now_ms;
use crate::constants;
use crate::error::APIError;
use crate::features::providers::adapter::ProviderStream;
use crate::features::providers::wire::random_hex;
use crate::infrastructure::upstream::STREAM_IDLE_TIMEOUT;
use crate::protocol::sse;

/// One decoded wire event, already reduced to what the two consumers use.
pub(super) enum Event {
    Text(String),
    Reasoning(String),
    ToolCall {
        id: String,
        name: String,
        arguments: String,
    },
    /// An OpenAI-shaped usage object, mapped from the wire's `totalUsage`.
    Usage(Value),
    Finish(Option<String>),
    Failed(APIError),
}

/// Splits the upstream body into trimmed lines and decodes each one. A line that
/// is not JSON is skipped, exactly as the CLI does.
#[derive(Default)]
pub(super) struct LineDecoder {
    buffer: String,
    finished: bool,
}

impl LineDecoder {
    pub(super) fn push(&mut self, bytes: &[u8]) -> Vec<Event> {
        if self.finished {
            return Vec::new();
        }
        self.buffer.push_str(&String::from_utf8_lossy(bytes));
        let mut events = Vec::new();

        while let Some(position) = self.buffer.find('\n') {
            let line = self.buffer[..position].trim().to_owned();
            self.buffer.drain(..=position);
            events.extend(self.decode_line(&line));
            if self.finished {
                break;
            }
        }

        events
    }

    pub(super) fn finish(&mut self) -> Vec<Event> {
        if self.finished {
            return Vec::new();
        }
        let line = self.buffer.trim().to_owned();
        self.buffer.clear();

        self.decode_line(&line)
    }

    fn decode_line(&mut self, line: &str) -> Vec<Event> {
        if line.is_empty() {
            return Vec::new();
        }
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            return Vec::new();
        };
        if !value.is_object() {
            return Vec::new();
        }

        match value.get("type").and_then(Value::as_str) {
            Some("text-delta") => text_event(&value, false),
            Some("reasoning-delta") => text_event(&value, true),
            Some("tool-call") => tool_call_event(&value),
            Some("finish-step") => usage_event(&value),
            Some("finish") => {
                let mut events = usage_event(&value);
                events.push(Event::Finish(
                    value
                        .get("finishReason")
                        .and_then(Value::as_str)
                        .map(str::to_owned),
                ));
                events
            }
            Some("error") => {
                self.finished = true;
                vec![Event::Failed(stream_error(&value))]
            }
            _ => Vec::new(),
        }
    }
}

fn text_event(value: &Value, reasoning: bool) -> Vec<Event> {
    match value.get("text").and_then(Value::as_str) {
        Some(text) if !text.is_empty() => {
            if reasoning {
                vec![Event::Reasoning(text.to_owned())]
            } else {
                vec![Event::Text(text.to_owned())]
            }
        }
        _ => Vec::new(),
    }
}

fn tool_call_event(value: &Value) -> Vec<Event> {
    let id = value
        .get("toolCallId")
        .and_then(Value::as_str)
        .map(str::to_owned)
        .filter(|id| !id.is_empty())
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let name = value
        .get("toolName")
        .and_then(Value::as_str)
        .map(str::to_owned)
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| "tool".to_owned());
    let arguments = match value.get("input") {
        Some(Value::String(raw)) => raw.clone(),
        Some(input) => input.to_string(),
        None => "{}".to_owned(),
    };

    vec![Event::ToolCall {
        id,
        name,
        arguments,
    }]
}

/// The wire states its usage at the top level (`totalUsage`), and the status of a
/// failure beside the message rather than inside it.
fn stream_error(value: &Value) -> APIError {
    let nested = value.get("error");
    let message = nested
        .and_then(|error| error.get("message"))
        .and_then(Value::as_str)
        .or_else(|| nested.and_then(Value::as_str))
        .or_else(|| value.get("message").and_then(Value::as_str))
        .unwrap_or("generation error");
    let status = value
        .get("statusCode")
        .or_else(|| value.get("status_code"))
        .and_then(Value::as_u64)
        .or_else(|| {
            nested
                .and_then(|error| error.get("statusCode"))
                .and_then(Value::as_u64)
        });

    APIError::new(
        status.unwrap_or(502) as u16,
        constants::providers::commandcode::stream_error(message),
    )
}

fn usage_event(value: &Value) -> Vec<Event> {
    let raw = value.get("totalUsage").or_else(|| value.get("usage"));
    match raw.and_then(openai_usage) {
        Some(usage) => vec![Event::Usage(usage)],
        None => Vec::new(),
    }
}

/// `{inputTokens, outputTokens, inputTokenDetails:{cacheReadTokens,…}}` mapped
/// onto the OpenAI usage object the gateway already accounts.
fn openai_usage(raw: &Value) -> Option<Value> {
    if !raw.is_object() {
        return None;
    }
    let tokens = |key: &str| raw.get(key).and_then(Value::as_i64);
    let input = tokens("inputTokens")
        .or_else(|| tokens("prompt_tokens"))
        .unwrap_or(0);
    let output = tokens("outputTokens")
        .or_else(|| tokens("completion_tokens"))
        .unwrap_or(0);
    let mut usage = json!({
        "prompt_tokens": input,
        "completion_tokens": output,
        "total_tokens": input + output,
    });

    let cached = raw
        .get("inputTokenDetails")
        .and_then(|details| details.get("cacheReadTokens"))
        .and_then(Value::as_i64)
        .or_else(|| tokens("cacheReadTokens"))
        .or_else(|| tokens("cachedInputTokens"))
        .unwrap_or(0);
    if cached > 0 {
        usage["prompt_tokens_details"] = json!({ "cached_tokens": cached });
    }

    Some(usage)
}

/// `tool-calls` and `content-filter` are the two wire values OpenAI spells
/// differently; everything unrecognised degrades to a normal stop.
fn finish_reason(reason: Option<&str>, tool_calls: bool) -> String {
    if tool_calls {
        return "tool_calls".to_owned();
    }

    match reason {
        Some("length") => "length",
        Some("content-filter") => "content_filter",
        _ => "stop",
    }
    .to_owned()
}

struct Frame {
    id: String,
    model: String,
    created: i64,
}

impl Frame {
    fn new(model: &str) -> Self {
        Self {
            id: format!("chatcmpl-{}", random_hex(12)),
            model: model.to_owned(),
            created: now_ms() / 1000,
        }
    }

    fn chunk(&self, delta: Value, finish_reason: Option<&str>) -> Bytes {
        data_frame(json!({
            "id": self.id,
            "object": "chat.completion.chunk",
            "created": self.created,
            "model": self.model,
            "choices": [{
                "index": 0,
                "delta": delta,
                "finish_reason": finish_reason,
            }],
        }))
    }

    fn closing(&self, finish_reason: &str, usage: Option<&Value>) -> Bytes {
        let mut payload = json!({
            "id": self.id,
            "object": "chat.completion.chunk",
            "created": self.created,
            "model": self.model,
            "choices": [{
                "index": 0,
                "delta": {},
                "finish_reason": finish_reason,
            }],
        });
        if let Some(usage) = usage {
            payload["usage"] = usage.clone();
        }

        data_frame(payload)
    }
}

fn data_frame(payload: Value) -> Bytes {
    Bytes::from(format!("data: {payload}\n\n"))
}

pub(super) fn translate_stream<S>(upstream: S, model: String) -> ProviderStream
where
    S: Stream<Item = Result<Bytes, reqwest::Error>> + Send + 'static,
{
    type State<S> = Option<(
        Pin<Box<S>>,
        LineDecoder,
        VecDeque<Bytes>,
        Frame,
        bool,
        bool,
        bool,
        Option<Value>,
    )>;

    let state: State<S> = Some((
        Box::pin(upstream),
        LineDecoder::default(),
        VecDeque::new(),
        Frame::new(&model),
        false, // done
        false, // started
        false, // called a tool
        None,  // usage
    ));
    let events = futures_util::stream::unfold(state, |state| async move {
        let (
            mut upstream,
            mut decoder,
            mut pending,
            frame,
            mut done,
            mut started,
            mut tool,
            mut usage,
        ) = state?;

        loop {
            if let Some(bytes) = pending.pop_front() {
                return Some((
                    bytes,
                    Some((
                        upstream, decoder, pending, frame, done, started, tool, usage,
                    )),
                ));
            }
            if done {
                return None;
            }

            match tokio::time::timeout(STREAM_IDLE_TIMEOUT, upstream.next()).await {
                Ok(Some(Ok(bytes))) => {
                    for event in decoder.push(&bytes) {
                        absorb(
                            event,
                            &frame,
                            &mut pending,
                            &mut done,
                            &mut started,
                            &mut tool,
                            &mut usage,
                        );
                    }
                }
                Ok(Some(Err(error))) => {
                    pending.push_back(sse::error_event_bytes(&APIError::new(
                        500,
                        constants::providers::upstream_stream_failed(&error),
                    )));
                    done = true;
                }
                Ok(None) => {
                    for event in decoder.finish() {
                        absorb(
                            event,
                            &frame,
                            &mut pending,
                            &mut done,
                            &mut started,
                            &mut tool,
                            &mut usage,
                        );
                    }
                    if !done {
                        // Reaching the end without a finish event is the
                        // truncation the CLI refuses to hand over.
                        pending.push_back(empty_stream_event());
                        done = true;
                    }
                }
                Err(_) => {
                    pending.push_back(sse::error_event_bytes(&APIError::new(
                        500,
                        constants::providers::upstream_stalled(STREAM_IDLE_TIMEOUT.as_secs()),
                    )));
                    done = true;
                }
            }
        }
    });

    Box::pin(events)
}

fn absorb(
    event: Event,
    frame: &Frame,
    pending: &mut VecDeque<Bytes>,
    done: &mut bool,
    started: &mut bool,
    tool: &mut bool,
    usage: &mut Option<Value>,
) {
    match event {
        Event::Text(text) => {
            *started = true;
            pending.push_back(frame.chunk(json!({ "content": text }), None));
        }
        Event::Reasoning(text) => {
            *started = true;
            pending.push_back(frame.chunk(json!({ "reasoning_content": text }), None));
        }
        Event::ToolCall {
            id,
            name,
            arguments,
        } => {
            *started = true;
            *tool = true;
            pending.push_back(frame.chunk(
                json!({
                    "tool_calls": [{
                        "index": 0,
                        "id": id,
                        "type": "function",
                        "function": { "name": name, "arguments": arguments },
                    }],
                }),
                None,
            ));
        }
        Event::Usage(mapped) => *usage = Some(mapped),
        Event::Finish(reason) => {
            if !*started {
                pending.push_back(empty_stream_event());
            } else {
                pending.push_back(
                    frame.closing(&finish_reason(reason.as_deref(), *tool), usage.as_ref()),
                );
                pending.push_back(Bytes::from_static(b"data: [DONE]\n\n"));
            }
            *done = true;
        }
        Event::Failed(error) => {
            pending.push_back(sse::error_event_bytes(&error));
            *done = true;
        }
    }
}

fn empty_stream_event() -> Bytes {
    sse::error_event_bytes(&APIError::new(
        502,
        constants::providers::commandcode::EMPTY_STREAM,
    ))
}

/// The buffered path: the same events, collected into one `chat.completion`.
pub(super) struct Aggregator {
    frame: Frame,
    content: String,
    reasoning: String,
    tool_calls: Vec<Value>,
    finish: Option<String>,
    usage: Option<Value>,
    started: bool,
}

impl Aggregator {
    pub(super) fn new(model: &str) -> Self {
        Self {
            frame: Frame::new(model),
            content: String::new(),
            reasoning: String::new(),
            tool_calls: Vec::new(),
            finish: None,
            usage: None,
            started: false,
        }
    }

    pub(super) fn accept(&mut self, event: Event) -> Result<(), APIError> {
        match event {
            Event::Text(text) => {
                self.started = true;
                self.content.push_str(&text);
            }
            Event::Reasoning(text) => {
                self.started = true;
                self.reasoning.push_str(&text);
            }
            Event::ToolCall {
                id,
                name,
                arguments,
            } => {
                self.started = true;
                self.tool_calls.push(json!({
                    "id": id,
                    "type": "function",
                    "function": { "name": name, "arguments": arguments },
                }));
            }
            Event::Usage(usage) => self.usage = Some(usage),
            Event::Finish(reason) => {
                self.finish = Some(finish_reason(
                    reason.as_deref(),
                    !self.tool_calls.is_empty(),
                ))
            }
            Event::Failed(error) => return Err(error),
        }

        Ok(())
    }

    /// Refuses an empty or truncated turn rather than returning a 200 with no
    /// content, which the caller cannot tell apart from a successful stop.
    pub(super) fn finish(self) -> Result<Value, APIError> {
        if !self.started || self.finish.is_none() {
            return Err(APIError::new(
                502,
                constants::providers::commandcode::EMPTY_STREAM,
            ));
        }

        // A reasoning-only turn's text is the only answer the caller can be
        // given, so it becomes the content instead of being lost.
        let content = if !self.content.is_empty() {
            Value::String(self.content)
        } else if !self.reasoning.is_empty() {
            Value::String(self.reasoning.clone())
        } else {
            Value::Null
        };
        let mut message = json!({ "role": "assistant", "content": content });
        if !self.reasoning.is_empty() {
            message["reasoning_content"] = Value::String(self.reasoning);
        }
        if !self.tool_calls.is_empty() {
            message["tool_calls"] = Value::Array(self.tool_calls);
        }

        let mut response = json!({
            "id": self.frame.id,
            "object": "chat.completion",
            "created": self.frame.created,
            "model": self.frame.model,
            "choices": [{
                "index": 0,
                "message": message,
                "finish_reason": self.finish.unwrap_or_else(|| "stop".to_owned()),
            }],
        });
        if let Some(usage) = self.usage {
            response["usage"] = usage;
        }

        Ok(response)
    }
}
