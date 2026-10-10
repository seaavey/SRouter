use std::convert::Infallible;

use axum::body::{Body, Bytes};
use axum::http::{StatusCode, Version, header};
use axum::response::Response;
use axum::response::sse::Event;
use futures_util::Stream;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::constants;
use crate::error::APIError;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum ReasoningEvent {
    ReasoningStart { id: String },
    ReasoningDelta { id: String, text: String },
    ReasoningEnd { id: String },
}

#[derive(Default)]
pub struct ReasoningStreamParser {
    active_id: Option<String>,
}

impl ReasoningStreamParser {
    pub fn new() -> Self {
        Self::default()
    }

    /// Process a stream delta containing either thinking/reasoning delta or text/tools.
    /// If reasoning text arrives and wasn't started, emits Start then Delta.
    /// If non-reasoning tokens arrive while reasoning is active, emits End.
    pub fn parse_chunk(
        &mut self,
        id: &str,
        reasoning_delta: Option<&str>,
        has_other_content: bool,
    ) -> Vec<ReasoningEvent> {
        let mut events = Vec::new();

        if let Some(delta) = reasoning_delta
            && !delta.is_empty()
        {
            if self.active_id.as_deref() != Some(id) {
                if let Some(prev) = self.active_id.take() {
                    events.push(ReasoningEvent::ReasoningEnd { id: prev });
                }
                self.active_id = Some(id.to_string());
                events.push(ReasoningEvent::ReasoningStart { id: id.to_string() });
            }
            events.push(ReasoningEvent::ReasoningDelta {
                id: id.to_string(),
                text: delta.to_string(),
            });
        }

        if has_other_content && let Some(active) = self.active_id.take() {
            events.push(ReasoningEvent::ReasoningEnd { id: active });
        }

        events
    }

    /// Flush and close any remaining active reasoning block at the end of the stream.
    pub fn finish(&mut self) -> Option<ReasoningEvent> {
        self.active_id
            .take()
            .map(|id| ReasoningEvent::ReasoningEnd { id })
    }
}

pub fn to_sse_event(event: &ReasoningEvent) -> Result<Event, serde_json::Error> {
    let json = serde_json::to_string(event)?;
    let event_type = match event {
        ReasoningEvent::ReasoningStart { .. } => "reasoning-start",
        ReasoningEvent::ReasoningDelta { .. } => "reasoning-delta",
        ReasoningEvent::ReasoningEnd { .. } => "reasoning-end",
    };
    Ok(Event::default().event(event_type).data(json))
}

/// Encodes an error as an SSE `data` record carrying the standard error
/// envelope, so a failure inside an already-opened stream keeps the
/// `text/event-stream` response instead of switching to a JSON body.
pub fn error_event_bytes(error: &APIError) -> Bytes {
    let payload = serde_json::to_string(&error.to_envelope()).unwrap_or_else(|_| {
        serde_json::json!({
            "error": {
                "message": constants::common::INTERNAL_SERVER_ERROR,
                "type": "api_error"
            }
        })
        .to_string()
    });

    Bytes::from(format!("data: {payload}\n\n"))
}

/// Splits upstream SSE bytes into the JSON `data:` payloads they carry,
/// buffering partial lines across reads. Non-`data:` lines, the empty payload,
/// and the `[DONE]` sentinel are skipped; a payload that is not JSON is
/// dropped, matching the Node reader. Shared by the chat and messages streaming
/// loops, which differ only in what they do with each payload.
#[derive(Default)]
pub struct SseDataDecoder {
    line_buffer: String,
}

impl SseDataDecoder {
    pub fn new() -> Self {
        Self::default()
    }

    /// Feeds one upstream read and returns every JSON payload it completed.
    pub fn push(&mut self, bytes: &[u8]) -> Vec<Value> {
        let Ok(text) = std::str::from_utf8(bytes) else {
            return Vec::new();
        };
        self.line_buffer.push_str(text);

        let mut payloads = Vec::new();
        while let Some(pos) = self.line_buffer.find('\n') {
            let line = self.line_buffer[..pos].trim_end_matches('\r').to_owned();
            self.line_buffer.drain(..=pos);

            let Some(data) = line.strip_prefix("data:") else {
                continue;
            };
            let data = data.trim();
            if data.is_empty() || data == "[DONE]" {
                continue;
            }
            if let Ok(json) = serde_json::from_str::<Value>(data) {
                payloads.push(json);
            }
        }
        payloads
    }
}

/// Builds the frozen SSE response: event-stream content type, no-cache, and the
/// proxy-buffering opt-out, plus `Connection: keep-alive` on HTTP/1.x only
/// (HTTP/2 forbids the hop-by-hop header). Shared by the chat and messages
/// streaming routes.
pub fn sse_response<S>(events: S, version: Version) -> Result<Response, axum::http::Error>
where
    S: Stream<Item = Result<Bytes, Infallible>> + Send + 'static,
{
    let mut builder = Response::builder()
        .status(StatusCode::OK)
        .header(
            header::CONTENT_TYPE,
            constants::headers::value::EVENT_STREAM,
        )
        .header(
            header::CACHE_CONTROL,
            constants::headers::value::SSE_CACHE_CONTROL,
        )
        .header(
            constants::headers::name::X_ACCEL_BUFFERING,
            constants::headers::value::ACCEL_BUFFERING_OFF,
        );

    if version == Version::HTTP_10 || version == Version::HTTP_11 {
        builder = builder.header(header::CONNECTION, constants::headers::value::KEEP_ALIVE);
    }

    builder.body(Body::from_stream(events))
}
