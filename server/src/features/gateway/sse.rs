use axum::body::Bytes;
use axum::response::sse::Event;
use serde::{Deserialize, Serialize};

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

        if let Some(delta) = reasoning_delta {
            if !delta.is_empty() {
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
        }

        if has_other_content {
            if let Some(active) = self.active_id.take() {
                events.push(ReasoningEvent::ReasoningEnd { id: active });
            }
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
        "{\"error\":{\"message\":\"Internal server error\",\"type\":\"api_error\"}}".to_owned()
    });

    Bytes::from(format!("data: {payload}\n\n"))
}
