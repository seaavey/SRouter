//! Translates the Qoder gateway's wrapped SSE envelope back into OpenAI frames,
//! for both the streamed and the buffered paths.

use std::collections::{BTreeMap, VecDeque};
use std::pin::Pin;

use axum::body::Bytes;
use futures_util::{Stream, StreamExt};
use serde_json::Value;

use crate::clock::now_ms;
use crate::constants;
use crate::error::APIError;
use crate::features::providers::adapter::ProviderStream;
use crate::features::providers::wire::{estimate_usage, random_hex};
use crate::infrastructure::upstream::STREAM_IDLE_TIMEOUT;
use crate::protocol::model::ChatCompletionRequest;
use crate::protocol::sse;
use crate::protocol::usage::UsageBreakdown;

/// Extracts the payload of a `data:` line, or `None` for any other line.
pub(super) fn data_payload(line: &str) -> Option<&str> {
    let trimmed = line.trim();
    let payload = trimmed.strip_prefix("data:")?.trim();

    if payload.is_empty() || payload == "[DONE]" {
        return None;
    }

    Some(payload)
}

/// Turns one upstream envelope into an OpenAI frame. An envelope reporting a
/// failed status becomes an in-stream error event instead of a chunk.
fn translate_envelope(
    payload: &str,
    translator: &EnvelopeTranslator,
) -> Option<Result<Bytes, APIError>> {
    let envelope: Value = serde_json::from_str(payload).ok()?;
    let status = envelope
        .get("statusCodeValue")
        .and_then(Value::as_i64)
        .unwrap_or(200);
    let body = envelope.get("body").and_then(Value::as_str).unwrap_or("");

    if status != 200 {
        return Some(Err(APIError::new(
            500,
            constants::providers::upstream_stream_error(status as u16, body),
        )));
    }

    if body.is_empty() || body == "[DONE]" {
        return None;
    }

    let inner: Value = serde_json::from_str(body).ok()?;
    let chunk = translator.normalize(inner);

    Some(Ok(Bytes::from(format!("data: {chunk}\n\n"))))
}

/// Accumulates the upstream stream and emits OpenAI frames. The buffer spans
/// network reads, because the upstream splits a `data:` line across chunks.
pub(super) struct EnvelopeTranslator {
    buffer: String,
    model: String,
    chunk_id: String,
    created: i64,
    finished: bool,
}

impl EnvelopeTranslator {
    pub(super) fn new(model: &str) -> Self {
        Self {
            buffer: String::new(),
            model: model.to_owned(),
            chunk_id: format!("chatcmpl-{}", random_hex(16)),
            created: now_ms() / 1000,
            finished: false,
        }
    }

    pub(super) fn push(&mut self, bytes: &[u8]) -> Vec<Result<Bytes, APIError>> {
        if self.finished {
            return Vec::new();
        }

        self.buffer.push_str(&String::from_utf8_lossy(bytes));
        let mut output = Vec::new();

        while let Some(position) = self.buffer.find('\n') {
            let line = self.buffer[..position].trim_end_matches('\r').to_owned();
            self.buffer.drain(..=position);

            if let Some(payload) = data_payload(&line)
                && let Some(frame) = translate_envelope(payload, self)
            {
                output.push(frame);
            }
        }

        output
    }

    pub(super) fn finish(&mut self) -> Vec<Result<Bytes, APIError>> {
        if self.finished {
            return Vec::new();
        }
        self.finished = true;

        let mut output = Vec::new();
        let rest = std::mem::take(&mut self.buffer);
        if let Some(payload) = data_payload(&rest)
            && let Some(frame) = translate_envelope(payload, self)
        {
            output.push(frame);
        }

        // The upstream never terminates the stream itself, and the gateway
        // forwards provider bytes verbatim, so the terminator is added here.
        output.push(Ok(Bytes::from("data: [DONE]\n\n")));

        output
    }

    /// Fills in the fields a client expects on every chunk. The upstream omits
    /// them because its own consumers read only the delta.
    fn normalize(&self, mut chunk: Value) -> Value {
        if !chunk.is_object() {
            chunk = serde_json::json!({ "choices": [] });
        }

        let object = chunk.as_object_mut().expect("chunk is an object");
        object
            .entry("id")
            .or_insert_with(|| Value::String(self.chunk_id.clone()));
        object
            .entry("object")
            .or_insert_with(|| Value::String("chat.completion.chunk".to_owned()));
        object
            .entry("created")
            .or_insert_with(|| Value::Number(self.created.into()));
        object
            .entry("model")
            .or_insert_with(|| Value::String(self.model.clone()));

        if let Some(choices) = object.get_mut("choices").and_then(Value::as_array_mut) {
            for (index, choice) in choices.iter_mut().enumerate() {
                if let Some(choice) = choice.as_object_mut() {
                    choice.entry("index").or_insert_with(|| index.into());
                }
            }
        }

        Value::Object(std::mem::take(object))
    }
}

/// The unfold state: the upstream, the translator, frames waiting to be
/// emitted, and whether the stream is finished.
type TranslateState<S> = Option<(
    Pin<Box<S>>,
    EnvelopeTranslator,
    VecDeque<Result<Bytes, APIError>>,
    bool,
)>;

/// Wraps the upstream byte stream in the envelope translation, keeping the
/// stall and transport guarantees the other providers have.
pub(super) fn translate_stream<S>(upstream: S, model: String) -> ProviderStream
where
    S: Stream<Item = Result<Bytes, reqwest::Error>> + Send + 'static,
{
    let upstream: Pin<Box<S>> = Box::pin(upstream);
    let state: TranslateState<S> = Some((
        upstream,
        EnvelopeTranslator::new(&model),
        VecDeque::new(),
        false,
    ));

    let events = futures_util::stream::unfold(state, |state| async move {
        let (mut upstream, mut translator, mut pending, mut stalled) = state?;

        loop {
            if let Some(frame) = pending.pop_front() {
                let bytes = match frame {
                    Ok(bytes) => bytes,
                    Err(error) => sse::error_event_bytes(&error),
                };
                return Some((bytes, Some((upstream, translator, pending, stalled))));
            }

            if stalled {
                return None;
            }

            match tokio::time::timeout(STREAM_IDLE_TIMEOUT, upstream.next()).await {
                Ok(Some(Ok(bytes))) => {
                    pending.extend(translator.push(&bytes));
                }
                Ok(Some(Err(error))) => {
                    let failure =
                        APIError::new(500, constants::providers::upstream_stream_failed(&error));
                    pending.push_back(Err(failure));
                    stalled = true;
                }
                Ok(None) => {
                    pending.extend(translator.finish());
                    stalled = true;
                }
                Err(_) => {
                    let failure = APIError::new(
                        500,
                        constants::providers::upstream_stalled(STREAM_IDLE_TIMEOUT.as_secs()),
                    );
                    pending.push_back(Err(failure));
                    stalled = true;
                }
            }
        }
    });

    Box::pin(events)
}

/// Aggregates the upstream stream into one buffered `chat.completion`.
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
    failed: Option<APIError>,
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
            failed: None,
        }
    }

    /// Accepts one upstream envelope payload. An error envelope stops the
    /// aggregation and is returned to the caller.
    pub(super) fn accept(&mut self, payload: &str) -> Result<(), APIError> {
        if let Some(failure) = &self.failed {
            return Err(APIError::new(500, failure.message()));
        }

        let envelope: Value = serde_json::from_str(payload).unwrap_or(Value::Null);
        let status = envelope
            .get("statusCodeValue")
            .and_then(Value::as_i64)
            .unwrap_or(200);
        let body = envelope.get("body").and_then(Value::as_str).unwrap_or("");

        if status != 200 {
            let failure = APIError::new(
                500,
                constants::providers::upstream_stream_error(status as u16, body),
            );
            self.failed = Some(failure.clone());
            return Err(failure);
        }

        if body.is_empty() || body == "[DONE]" {
            return Ok(());
        }

        let Ok(chunk) = serde_json::from_str::<Value>(body) else {
            return Ok(());
        };

        if let Some(usage) = chunk.get("usage").filter(|value| !value.is_null()) {
            self.usage = Some(usage.clone());
        }

        let Some(choice) = chunk
            .get("choices")
            .and_then(Value::as_array)
            .and_then(|c| c.first())
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
        if let Some(reasoning) = delta
            .get("reasoning_content")
            .or_else(|| delta.get("reasoning"))
            .and_then(Value::as_str)
        {
            self.reasoning.push_str(reasoning);
        }

        for item in delta
            .get("tool_calls")
            .and_then(Value::as_array)
            .map(Vec::as_slice)
            .unwrap_or_default()
        {
            let index = item.get("index").and_then(Value::as_u64).unwrap_or(0) as usize;
            let entry = self.tool_calls.entry(index).or_insert_with(|| {
                serde_json::json!({
                    "index": index,
                    "type": "function",
                    "function": { "name": "", "arguments": "" }
                })
            });

            if let Some(id) = item.get("id").and_then(Value::as_str) {
                entry["id"] = Value::String(id.to_owned());
            }
            if let Some(name) = item
                .get("function")
                .and_then(|f| f.get("name"))
                .and_then(Value::as_str)
            {
                entry["function"]["name"] = Value::String(name.to_owned());
            }
            if let Some(arguments) = item
                .get("function")
                .and_then(|f| f.get("arguments"))
                .and_then(Value::as_str)
            {
                self.arguments.entry(index).or_default().push_str(arguments);
            }
        }

        Ok(())
    }

    pub(super) fn finish(mut self, request: &ChatCompletionRequest) -> Result<Value, APIError> {
        if let Some(failure) = self.failed.take() {
            return Err(failure);
        }

        for (index, arguments) in self.arguments {
            if let Some(entry) = self.tool_calls.get_mut(&index) {
                entry["function"]["arguments"] = Value::String(arguments);
            }
        }

        let tool_calls: Vec<Value> = self.tool_calls.into_values().collect();
        let has_tool_calls = !tool_calls.is_empty();
        let mut message = serde_json::json!({ "role": "assistant", "content": self.content });

        if !self.reasoning.is_empty() {
            message["reasoning_content"] = Value::String(self.reasoning);
        }
        if has_tool_calls {
            message["tool_calls"] = Value::Array(tool_calls);
        }

        let usage = match self.usage {
            Some(upstream) => UsageBreakdown::from_value(&upstream).to_openai_json(),
            None => estimate_usage(&request.messages, &self.content).to_openai_json(),
        };

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
                })
            }],
            "usage": usage
        }))
    }
}
