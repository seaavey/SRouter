//! Translates Cline's OpenAI-compatible SSE into OpenAI frames, for both the
//! streamed and the buffered paths.

use std::collections::{BTreeMap, VecDeque};
use std::pin::Pin;

use axum::body::Bytes;
use futures_util::{Stream, StreamExt};
use serde_json::Value;

use super::auth::unwrap_success;
use crate::clock::now_ms;
use crate::constants;
use crate::error::APIError;
use crate::features::providers::adapter::ProviderStream;
use crate::features::providers::wire::{estimate_usage, random_hex, stream_error_message};
use crate::infrastructure::upstream::STREAM_IDLE_TIMEOUT;
use crate::protocol::model::ChatCompletionRequest;
use crate::protocol::sse;
use crate::protocol::usage::UsageBreakdown;

#[derive(Debug)]
pub(super) enum DecodedFrame {
    Data(Value),
    Raw(String),
    Done,
    Error(APIError),
}

#[derive(Default)]
pub(super) struct EventDecoder {
    buffer: String,
    event_lines: Vec<String>,
    finished: bool,
}

impl EventDecoder {
    pub(super) fn push(&mut self, bytes: &[u8]) -> Vec<DecodedFrame> {
        if self.finished {
            return Vec::new();
        }
        self.buffer.push_str(&String::from_utf8_lossy(bytes));
        let mut frames = Vec::new();

        while let Some(position) = self.buffer.find('\n') {
            let line = self.buffer[..position].trim_end_matches('\r').to_owned();
            self.buffer.drain(..=position);
            if line.is_empty() {
                if let Some(frame) = self.take_event() {
                    frames.push(frame);
                }
            } else {
                self.event_lines.push(line);
            }
        }

        frames
    }

    pub(super) fn finish(&mut self) -> Vec<DecodedFrame> {
        if self.finished {
            return Vec::new();
        }
        if !self.buffer.is_empty() {
            self.event_lines.push(
                std::mem::take(&mut self.buffer)
                    .trim_end_matches('\r')
                    .to_owned(),
            );
        }

        self.take_event().into_iter().collect()
    }

    fn take_event(&mut self) -> Option<DecodedFrame> {
        let lines = std::mem::take(&mut self.event_lines);
        let payload = lines
            .iter()
            .filter_map(|line| line.strip_prefix("data:").map(str::trim_start))
            .collect::<Vec<_>>()
            .join("\n");
        if payload.is_empty() {
            return None;
        }
        if payload.trim() == "[DONE]" {
            self.finished = true;
            return Some(DecodedFrame::Done);
        }

        let Ok(value) = serde_json::from_str::<Value>(&payload) else {
            return Some(DecodedFrame::Raw(payload));
        };
        match unwrap_success(value) {
            Err(error) => Some(DecodedFrame::Error(error)),
            Ok(value) => match stream_error_message(&value, "Cline stream failed") {
                Some(message) => Some(DecodedFrame::Error(APIError::new(500, message))),
                None => Some(DecodedFrame::Data(value)),
            },
        }
    }
}

pub(super) fn translate_stream<S>(upstream: S) -> ProviderStream
where
    S: Stream<Item = Result<Bytes, reqwest::Error>> + Send + 'static,
{
    type State<S> = Option<(Pin<Box<S>>, EventDecoder, VecDeque<Bytes>, bool)>;

    let state: State<S> = Some((
        Box::pin(upstream),
        EventDecoder::default(),
        VecDeque::new(),
        false,
    ));
    let events = futures_util::stream::unfold(state, |state| async move {
        let (mut upstream, mut decoder, mut pending, mut ended) = state?;

        loop {
            if let Some(frame) = pending.pop_front() {
                return Some((frame, Some((upstream, decoder, pending, ended))));
            }
            if ended {
                return None;
            }

            match tokio::time::timeout(STREAM_IDLE_TIMEOUT, upstream.next()).await {
                Ok(Some(Ok(bytes))) => {
                    pending.extend(decoder.push(&bytes).into_iter().map(encode_frame));
                }
                Ok(Some(Err(error))) => {
                    let failure =
                        APIError::new(500, constants::providers::upstream_stream_failed(&error));
                    pending.push_back(sse::error_event_bytes(&failure));
                    ended = true;
                }
                Ok(None) => {
                    pending.extend(decoder.finish().into_iter().map(encode_frame));
                    ended = true;
                }
                Err(_) => {
                    let failure = APIError::new(
                        500,
                        constants::providers::upstream_stalled(STREAM_IDLE_TIMEOUT.as_secs()),
                    );
                    pending.push_back(sse::error_event_bytes(&failure));
                    ended = true;
                }
            }
        }
    });

    Box::pin(events)
}

fn encode_frame(frame: DecodedFrame) -> Bytes {
    match frame {
        DecodedFrame::Data(value) => Bytes::from(format!("data: {value}\n\n")),
        DecodedFrame::Raw(payload) => Bytes::from(format!("data: {payload}\n\n")),
        DecodedFrame::Done => Bytes::from_static(b"data: [DONE]\n\n"),
        DecodedFrame::Error(error) => sse::error_event_bytes(&error),
    }
}

pub(super) struct Aggregator {
    model: String,
    id: String,
    created: i64,
    content: String,
    reasoning: String,
    finish_reason: Option<String>,
    usage: Option<Value>,
    tool_calls: BTreeMap<usize, Value>,
    arguments: BTreeMap<usize, String>,
    completed: Option<Value>,
}

impl Aggregator {
    pub(super) fn new(model: &str) -> Self {
        Self {
            model: model.to_owned(),
            id: format!("chatcmpl-{}", random_hex(16)),
            created: now_ms() / 1000,
            content: String::new(),
            reasoning: String::new(),
            finish_reason: None,
            usage: None,
            tool_calls: BTreeMap::new(),
            arguments: BTreeMap::new(),
            completed: None,
        }
    }

    pub(super) fn accept(&mut self, frame: DecodedFrame) -> Result<(), APIError> {
        match frame {
            DecodedFrame::Data(value) => self.accept_value(value),
            DecodedFrame::Raw(_) | DecodedFrame::Done => Ok(()),
            DecodedFrame::Error(error) => Err(error),
        }
    }

    fn accept_value(&mut self, value: Value) -> Result<(), APIError> {
        if let Some(message) = stream_error_message(&value, "Cline stream failed") {
            return Err(APIError::new(500, message));
        }
        if value
            .get("choices")
            .and_then(Value::as_array)
            .and_then(|choices| choices.first())
            .and_then(|choice| choice.get("message"))
            .is_some()
        {
            self.completed = Some(value);
            return Ok(());
        }
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
        if let Some(id) = value.get("id").and_then(Value::as_str) {
            self.id = id.to_owned();
        }
        if let Some(created) = value.get("created").and_then(Value::as_i64) {
            self.created = created;
        }
        if let Some(reason) = choice.get("finish_reason").and_then(Value::as_str) {
            self.finish_reason = Some(reason.to_owned());
        }

        let Some(delta) = choice.get("delta") else {
            return Ok(());
        };
        if let Some(content) = delta.get("content").and_then(Value::as_str) {
            self.content.push_str(content);
        }
        if let Some(reasoning) = delta
            .get("reasoning")
            .or_else(|| delta.get("reasoning_content"))
            .and_then(Value::as_str)
        {
            self.reasoning.push_str(reasoning);
        }

        for call in delta
            .get("tool_calls")
            .and_then(Value::as_array)
            .map(Vec::as_slice)
            .unwrap_or_default()
        {
            let index = call.get("index").and_then(Value::as_u64).unwrap_or(0) as usize;
            let entry = self.tool_calls.entry(index).or_insert_with(|| {
                serde_json::json!({
                    "index": index,
                    "type": "function",
                    "function": { "name": "", "arguments": "" }
                })
            });
            if let Some(id) = call.get("id").and_then(Value::as_str) {
                entry["id"] = Value::String(id.to_owned());
            }
            if let Some(name) = call
                .get("function")
                .and_then(|function| function.get("name"))
                .and_then(Value::as_str)
            {
                entry["function"]["name"] = Value::String(name.to_owned());
            }
            if let Some(arguments) = call
                .get("function")
                .and_then(|function| function.get("arguments"))
                .and_then(Value::as_str)
            {
                self.arguments.entry(index).or_default().push_str(arguments);
            }
        }

        Ok(())
    }

    pub(super) fn finish(mut self, request: &ChatCompletionRequest) -> Result<Value, APIError> {
        if let Some(completed) = self.completed {
            return Ok(completed);
        }

        for (index, arguments) in self.arguments {
            if let Some(call) = self.tool_calls.get_mut(&index) {
                call["function"]["arguments"] = Value::String(arguments);
            }
        }
        let tool_calls: Vec<Value> = self.tool_calls.into_values().collect();
        let has_tool_calls = !tool_calls.is_empty();
        let mut message = serde_json::json!({
            "role": "assistant",
            "content": self.content,
        });
        if !self.reasoning.is_empty() {
            message["reasoning"] = Value::String(self.reasoning);
        }
        if has_tool_calls {
            message["tool_calls"] = Value::Array(tool_calls);
        }

        let usage = self
            .usage
            .map(normalize_usage)
            .unwrap_or_else(|| estimate_usage(&request.messages, &self.content).to_openai_json());

        Ok(serde_json::json!({
            "id": self.id,
            "object": "chat.completion",
            "created": self.created,
            "model": self.model,
            "choices": [{
                "index": 0,
                "message": message,
                "finish_reason": self.finish_reason.unwrap_or_else(|| {
                    if has_tool_calls { "tool_calls".to_owned() } else { "stop".to_owned() }
                }),
            }],
            "usage": usage,
        }))
    }
}

fn normalize_usage(mut usage: Value) -> Value {
    let normalized = UsageBreakdown::from_value(&usage).to_openai_json();
    if let (Some(target), Some(source)) = (usage.as_object_mut(), normalized.as_object()) {
        for (key, value) in source {
            target.insert(key.clone(), value.clone());
        }
    }
    usage
}
