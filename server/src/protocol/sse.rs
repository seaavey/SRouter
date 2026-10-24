use std::convert::Infallible;
use std::time::Duration;

use axum::body::{Body, Bytes};
use axum::http::{StatusCode, Version, header};
use axum::response::Response;
use axum::response::sse::Event;
use futures_util::{Stream, StreamExt};
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

/// Cadence for the gateway's own SSE comment frames. It stays well below the
/// 125 s idle cutoff of a proxied response and leaves room for a missed tick.
pub const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(15);

/// A comment frame the gateway itself emits while an upstream is quiet. Clients
/// ignore it; the edge sees a byte. It must never enter the SSE data decoder.
pub fn heartbeat_bytes() -> Bytes {
    Bytes::from_static(b": keep-alive\n\n")
}

/// Tracks whether the bytes already written to a client ended on an SSE line
/// boundary. A gateway heartbeat is only safe there: forwarding a chunk may
/// stop mid-line, and a comment inserted into that line would corrupt the
/// `data:` payload on the client.
#[derive(Debug)]
pub struct SseLineBoundary {
    at_boundary: bool,
}

impl Default for SseLineBoundary {
    fn default() -> Self {
        Self { at_boundary: true }
    }
}

impl SseLineBoundary {
    pub fn new() -> Self {
        Self::default()
    }

    /// Records one outbound chunk. An empty chunk cannot move the boundary.
    pub fn observe(&mut self, bytes: &[u8]) {
        if let Some(last) = bytes.last() {
            self.at_boundary = *last == b'\n';
        }
    }

    pub fn is_at_boundary(&self) -> bool {
        self.at_boundary
    }
}

/// Splits upstream SSE bytes into the JSON `data:` payloads they carry,
/// buffering partial lines across reads. Non-`data:` lines, the empty payload,
/// and the `[DONE]` sentinel are skipped; a payload that is not JSON is
/// dropped, matching the Node reader. Shared by the chat and messages streaming
/// loops, which differ only in what they do with each payload.
#[derive(Default)]
pub struct SseDataDecoder {
    line_buffer: String,
    done_seen: bool,
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
            if data.is_empty() {
                continue;
            }
            if data == "[DONE]" {
                self.done_seen = true;
                continue;
            }
            if let Ok(json) = serde_json::from_str::<Value>(data) {
                payloads.push(json);
            }
        }
        payloads
    }

    /// Whether a `data: [DONE]` sentinel has crossed the decoder, including one
    /// split across reads.
    pub fn saw_done(&self) -> bool {
        self.done_seen
    }
}

/// Builds the frozen SSE response: event-stream content type, no-cache, and the
/// proxy-buffering opt-out, plus `Connection: keep-alive` on HTTP/1.x only
/// (HTTP/2 forbids the hop-by-hop header). The first body item is a gateway
/// heartbeat, so the edge sees a byte before the first upstream event.
pub fn sse_response<S>(events: S, version: Version) -> Result<Response, axum::http::Error>
where
    S: Stream<Item = Result<Bytes, Infallible>> + Send + 'static,
{
    let events = futures_util::stream::once(async { Ok::<Bytes, Infallible>(heartbeat_bytes()) })
        .chain(events);
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

#[cfg(test)]
mod tests {
    use super::SseLineBoundary;

    #[test]
    fn a_heartbeat_is_a_comment_record() {
        assert_eq!(&super::heartbeat_bytes()[..], b": keep-alive\n\n");
    }

    #[test]
    fn a_fresh_stream_is_at_a_line_boundary() {
        assert!(SseLineBoundary::new().is_at_boundary());
    }

    #[test]
    fn a_partial_line_is_not_a_line_boundary() {
        let mut boundary = SseLineBoundary::new();

        boundary.observe(b"data: {\"choices\"");

        assert!(!boundary.is_at_boundary());
    }

    #[test]
    fn a_complete_line_feed_restores_the_boundary() {
        let mut boundary = SseLineBoundary::new();

        boundary.observe(b"data: {\"choices\":[]}\n");

        assert!(boundary.is_at_boundary());
    }

    #[test]
    fn a_crlf_split_stays_closed_until_the_line_feed_arrives() {
        let mut boundary = SseLineBoundary::new();

        boundary.observe(b"data: {}\r");
        assert!(!boundary.is_at_boundary());

        boundary.observe(b"\n");
        assert!(boundary.is_at_boundary());
    }

    #[test]
    fn a_multi_line_event_ending_in_a_blank_line_is_a_boundary() {
        let mut boundary = SseLineBoundary::new();

        boundary.observe(b"event: message_delta\ndata: {\"delta\":{}}\n\n");

        assert!(boundary.is_at_boundary());
    }

    #[test]
    fn an_empty_chunk_does_not_change_the_boundary() {
        let mut boundary = SseLineBoundary::new();

        boundary.observe(b"data: {}\r");
        boundary.observe(b"");

        assert!(!boundary.is_at_boundary());
    }

    #[test]
    fn the_done_sentinel_is_detected_across_chunks() {
        let mut decoder = super::SseDataDecoder::new();

        decoder.push(b"data: [DO");
        assert!(!decoder.saw_done());

        decoder.push(b"NE]\n\n");
        assert!(decoder.saw_done());
    }
}
