//! Codex streaming translation: decodes the upstream Responses SSE and folds it
//! into OpenAI `chat.completion.chunk` frames (or one buffered completion).

use std::collections::{BTreeMap, HashMap, VecDeque};
use std::pin::Pin;

use axum::body::Bytes;
use futures_util::{Stream, StreamExt};
use serde::Deserialize;
use serde_json::Value;

use crate::clock::now_ms;
use crate::constants;
use crate::error::APIError;
use crate::features::providers::adapter::ProviderStream;
use crate::features::providers::wire::{field_error_message, random_hex};
use crate::infrastructure::upstream::STREAM_IDLE_TIMEOUT;
use crate::protocol::model::{ChatCompletionRequest, ChatContent, ChatMessage};
use crate::protocol::sse;
use crate::protocol::usage::UsageBreakdown;

/// One event of the upstream Responses SSE stream, tagged by its `type`.
/// Events the translator does not care about — and any event a newer upstream
/// grows — land in `Ignored` instead of failing the parse.
#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
pub(super) enum ResponsesEvent {
    #[serde(rename = "response.output_text.delta")]
    OutputTextDelta { delta: String },
    #[serde(rename = "response.reasoning_text.delta")]
    ReasoningTextDelta { delta: String },
    #[serde(rename = "response.reasoning_summary_text.delta")]
    ReasoningSummaryTextDelta { delta: String },
    #[serde(rename = "response.output_item.added")]
    OutputItemAdded {
        output_index: Option<i64>,
        item: Value,
    },
    #[serde(rename = "response.function_call_arguments.delta")]
    FunctionCallArgumentsDelta {
        output_index: Option<i64>,
        delta: String,
    },
    #[serde(rename = "response.completed")]
    Completed { response: Value },
    #[serde(rename = "response.incomplete")]
    Incomplete { response: Value },
    #[serde(rename = "response.failed")]
    Failed { response: Value },
    #[serde(rename = "error")]
    Error {
        message: Option<String>,
        error: Option<Value>,
    },
    #[serde(other)]
    Ignored,
}

impl ResponsesEvent {
    /// The failure this event carries: the message of an `error` event, or the
    /// `response.error` payload of a failed response. A response that merely
    /// ran out of tokens carries no error.
    fn error(&self) -> Option<String> {
        match self {
            Self::Error { message, error } => message
                .clone()
                .or_else(|| error.as_ref().and_then(field_error_message)),
            Self::Failed { response } | Self::Incomplete { response } => response
                .get("error")
                .and_then(field_error_message)
                .filter(|message| !message.is_empty()),
            _ => None,
        }
    }
}

/// Why the turn ended, in the vocabulary of the chat protocol.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum FinishReason {
    Stop,
    ToolCalls,
    Length,
}

impl FinishReason {
    fn as_str(self) -> &'static str {
        match self {
            Self::Stop => "stop",
            Self::ToolCalls => "tool_calls",
            Self::Length => "length",
        }
    }
}

#[derive(Debug)]
pub(super) enum DecodedFrame {
    Event(ResponsesEvent),
    /// A payload the decoder could not parse into an event; forwarded as-is.
    Raw,
    Done,
    Error(APIError),
}

/// Splits an SSE body into events across arbitrary TCP fragmentations: lines
/// accumulate until the blank line that ends an event.
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

        match serde_json::from_str::<Value>(&payload)
            .ok()
            .and_then(|value| serde_json::from_value::<ResponsesEvent>(value).ok())
        {
            Some(event) => match event.error() {
                Some(message) => Some(DecodedFrame::Error(APIError::new(500, message))),
                None => Some(DecodedFrame::Event(event)),
            },
            None => Some(DecodedFrame::Raw),
        }
    }
}

/// Feeds Responses events and produces OpenAI `chat.completion.chunk` values.
/// The buffered path runs the same translator with `emit = false`, folding the
/// accumulated state into one completion instead of chunks.
pub(super) struct Translator {
    pub(super) emit: bool,
    model: String,
    id: String,
    created: i64,
    content: String,
    reasoning: String,
    tool_calls: BTreeMap<usize, Value>,
    arguments: BTreeMap<usize, String>,
    tool_index_by_output: HashMap<i64, usize>,
    next_tool_index: usize,
    usage: Option<Value>,
    finish_reason: Option<FinishReason>,
}

impl Translator {
    pub(super) fn new(model: &str) -> Self {
        Self {
            emit: true,
            model: model.to_owned(),
            id: format!("chatcmpl-{}", random_hex(16)),
            created: now_ms() / 1000,
            content: String::new(),
            reasoning: String::new(),
            tool_calls: BTreeMap::new(),
            arguments: BTreeMap::new(),
            tool_index_by_output: HashMap::new(),
            next_tool_index: 0,
            usage: None,
            finish_reason: None,
        }
    }

    pub(super) fn accept(&mut self, frame: DecodedFrame) -> Result<Vec<Value>, APIError> {
        match frame {
            DecodedFrame::Event(event) => Ok(self.accept_event(event)),
            DecodedFrame::Raw | DecodedFrame::Done => Ok(Vec::new()),
            DecodedFrame::Error(error) => Err(error),
        }
    }

    fn accept_event(&mut self, event: ResponsesEvent) -> Vec<Value> {
        match event {
            ResponsesEvent::OutputTextDelta { delta } => {
                self.content.push_str(&delta);
                self.chunk(serde_json::json!({ "content": delta }))
            }
            ResponsesEvent::ReasoningTextDelta { delta }
            | ResponsesEvent::ReasoningSummaryTextDelta { delta } => {
                self.reasoning.push_str(&delta);
                self.chunk(serde_json::json!({ "reasoning": delta }))
            }
            ResponsesEvent::OutputItemAdded { output_index, item } => {
                if item.get("type").and_then(Value::as_str) != Some("function_call") {
                    return Vec::new();
                }
                let index = self.register_tool_call(&item, output_index);
                self.chunk(serde_json::json!({ "tool_calls": [self.tool_call_start(index)] }))
            }
            ResponsesEvent::FunctionCallArgumentsDelta {
                output_index,
                delta,
            } => {
                let Some(index) = self.tool_index(output_index) else {
                    return Vec::new();
                };
                self.arguments.entry(index).or_default().push_str(&delta);
                self.chunk(serde_json::json!({
                    "tool_calls": [{ "index": index, "function": { "arguments": delta } }]
                }))
            }
            ResponsesEvent::Completed { response } => {
                self.capture_usage(&response);
                self.finish_reason = Some(self.default_finish_reason());
                Vec::new()
            }
            ResponsesEvent::Incomplete { response } => {
                // A response cut off by `max_output_tokens` still is a normal
                // end of stream; the chat protocol reports it as `length`.
                self.capture_usage(&response);
                let reason = response
                    .get("incomplete_details")
                    .and_then(|details| details.get("reason"))
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                self.finish_reason = Some(if reason.contains("max_output") {
                    FinishReason::Length
                } else {
                    self.default_finish_reason()
                });
                Vec::new()
            }
            // Failures arrive as `DecodedFrame::Error` from the decoder; the
            // remaining variants carry nothing the translation needs.
            ResponsesEvent::Failed { .. }
            | ResponsesEvent::Error { .. }
            | ResponsesEvent::Ignored => Vec::new(),
        }
    }

    fn capture_usage(&mut self, response: &Value) {
        if let Some(usage) = response.get("usage").filter(|usage| !usage.is_null()) {
            self.usage = Some(normalize_usage(usage));
        }
    }

    fn register_tool_call(&mut self, item: &Value, output_index: Option<i64>) -> usize {
        let index = self.next_tool_index;
        self.next_tool_index += 1;
        if let Some(output_index) = output_index {
            self.tool_index_by_output.insert(output_index, index);
        }
        let call_id = item
            .get("call_id")
            .or_else(|| item.get("id"))
            .and_then(Value::as_str)
            .unwrap_or_default();
        let mut entry = serde_json::json!({
            "index": index,
            "type": "function",
            "function": {
                "name": item.get("name").and_then(Value::as_str).unwrap_or_default(),
                "arguments": "",
            }
        });
        if !call_id.is_empty() {
            entry["id"] = Value::String(call_id.to_owned());
        }
        self.tool_calls.insert(index, entry);
        index
    }

    fn tool_call_start(&self, index: usize) -> Value {
        let mut call = self
            .tool_calls
            .get(&index)
            .cloned()
            .unwrap_or_else(|| serde_json::json!({ "index": index, "type": "function" }));
        call["function"]["arguments"] = Value::String(String::new());
        call
    }

    fn tool_index(&self, output_index: Option<i64>) -> Option<usize> {
        output_index
            .and_then(|output| self.tool_index_by_output.get(&output))
            .copied()
    }

    fn default_finish_reason(&self) -> FinishReason {
        if self.next_tool_index > 0 {
            FinishReason::ToolCalls
        } else {
            FinishReason::Stop
        }
    }

    fn chunk(&self, delta: Value) -> Vec<Value> {
        if !self.emit {
            return Vec::new();
        }
        vec![serde_json::json!({
            "id": self.id,
            "object": "chat.completion.chunk",
            "created": self.created,
            "model": self.model,
            "choices": [{
                "index": 0,
                "delta": delta,
                "finish_reason": Value::Null,
            }],
        })]
    }

    /// The closing frames of a streamed turn: one chunk carrying the finish
    /// reason and usage, then the `data: [DONE]` terminator.
    fn finish_stream(&mut self) -> Vec<Bytes> {
        let finish_reason = self
            .finish_reason
            .unwrap_or_else(|| self.default_finish_reason());
        let mut chunk = serde_json::json!({
            "id": self.id,
            "object": "chat.completion.chunk",
            "created": self.created,
            "model": self.model,
            "choices": [{
                "index": 0,
                "delta": {},
                "finish_reason": finish_reason.as_str(),
            }],
        });
        if let Some(usage) = &self.usage {
            chunk["usage"] = usage.clone();
        }
        vec![encode_chunk(chunk), Bytes::from_static(b"data: [DONE]\n\n")]
    }

    pub(super) fn finish_buffered(
        mut self,
        request: &ChatCompletionRequest,
    ) -> Result<Value, APIError> {
        for (index, arguments) in std::mem::take(&mut self.arguments) {
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

        let usage = self.usage.unwrap_or_else(|| {
            estimate_usage(&request.messages, &message["content"]).to_openai_json()
        });

        Ok(serde_json::json!({
            "id": self.id,
            "object": "chat.completion",
            "created": self.created,
            "model": self.model,
            "choices": [{
                "index": 0,
                "message": message,
                "finish_reason": self
                    .finish_reason
                    .unwrap_or(if has_tool_calls {
                        FinishReason::ToolCalls
                    } else {
                        FinishReason::Stop
                    })
                    .as_str(),
            }],
            "usage": usage,
        }))
    }
}

/// Translates the upstream Responses SSE into OpenAI chat chunks, keeping the
/// line buffer across network reads and ending the client stream the way the
/// Chat Completions protocol requires.
pub(super) fn translate_stream<S>(upstream: S, model: &str) -> ProviderStream
where
    S: Stream<Item = Result<Bytes, reqwest::Error>> + Send + 'static,
{
    type State<S> = Option<(Pin<Box<S>>, EventDecoder, Translator, VecDeque<Bytes>, bool)>;

    let state: State<S> = Some((
        Box::pin(upstream),
        EventDecoder::default(),
        Translator::new(model),
        VecDeque::new(),
        false,
    ));
    let events = futures_util::stream::unfold(state, |state| async move {
        let (mut upstream, mut decoder, mut translator, mut pending, mut ended) = state?;

        loop {
            if let Some(frame) = pending.pop_front() {
                return Some((frame, Some((upstream, decoder, translator, pending, ended))));
            }
            if ended {
                return None;
            }

            match tokio::time::timeout(STREAM_IDLE_TIMEOUT, upstream.next()).await {
                Ok(Some(Ok(bytes))) => {
                    for frame in decoder.push(&bytes) {
                        match translator.accept(frame) {
                            Ok(chunks) => {
                                pending.extend(chunks.into_iter().map(encode_chunk));
                            }
                            Err(error) => {
                                pending.push_back(sse::error_event_bytes(&error));
                                ended = true;
                                break;
                            }
                        }
                    }
                }
                Ok(Some(Err(error))) => {
                    let failure =
                        APIError::new(500, constants::providers::upstream_stream_failed(&error));
                    pending.push_back(sse::error_event_bytes(&failure));
                    ended = true;
                }
                Ok(None) => {
                    let mut frames = Vec::new();
                    let mut failure = None;
                    for frame in decoder.finish() {
                        match translator.accept(frame) {
                            Ok(chunks) => frames.extend(chunks.into_iter().map(encode_chunk)),
                            Err(error) => {
                                failure = Some(error);
                                break;
                            }
                        }
                    }
                    match failure {
                        Some(error) => frames.push(sse::error_event_bytes(&error)),
                        None => frames.extend(translator.finish_stream()),
                    }
                    pending.extend(frames);
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

fn encode_chunk(chunk: Value) -> Bytes {
    Bytes::from(format!("data: {chunk}\n\n"))
}

/// Folds a Responses usage object (`input_tokens` / `output_tokens`, with the
/// `*_tokens_details` sub-objects) into the OpenAI chat usage shape the client
/// protocol expects.
fn normalize_usage(usage: &Value) -> Value {
    let mut source = usage.clone();
    if let Some(object) = source.as_object_mut() {
        if let Some(cached) = usage
            .get("input_tokens_details")
            .and_then(|details| details.get("cached_tokens"))
            && !object.contains_key("prompt_tokens_details")
        {
            object.insert(
                "prompt_tokens_details".to_owned(),
                serde_json::json!({ "cached_tokens": cached }),
            );
        }
        if let Some(reasoning) = usage
            .get("output_tokens_details")
            .and_then(|details| details.get("reasoning_tokens"))
            && !object.contains_key("completion_tokens_details")
        {
            object.insert(
                "completion_tokens_details".to_owned(),
                serde_json::json!({ "reasoning_tokens": reasoning }),
            );
        }
    }
    UsageBreakdown::from_value(&source).to_openai_json()
}

fn estimate_usage(messages: &[ChatMessage], completion: &Value) -> UsageBreakdown {
    let prompt_chars: usize = messages
        .iter()
        .map(|message| match &message.content {
            ChatContent::Text(text) => text.chars().count(),
            ChatContent::Parts(parts) => parts
                .iter()
                .filter_map(|part| part.text.as_ref())
                .map(|text| text.chars().count())
                .sum(),
            ChatContent::Null => 0,
        })
        .sum();
    let completion_chars = completion.as_str().map(str::chars).map(Iterator::count);
    let prompt_tokens = (prompt_chars / 4).max(1) as i64;
    let completion_tokens = completion_chars.map(|chars| (chars / 4).max(1) as i64);

    UsageBreakdown {
        prompt_tokens,
        completion_tokens: completion_tokens.unwrap_or(1),
        total_tokens: prompt_tokens + completion_tokens.unwrap_or(1),
        ..Default::default()
    }
}
