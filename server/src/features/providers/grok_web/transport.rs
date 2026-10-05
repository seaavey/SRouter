//! WebSocket transport types and the NDJSON-frame classifier for the grok.com
//! WebSocket protocol.

use serde_json::Value;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream};

use crate::constants;
use crate::error::APIError;

/// The concrete WebSocket this executor speaks over: TLS from `wss://`, plain
/// TCP from the fake upstream's `ws://`.
pub(super) type GrokSocket = WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>;

/// The WS text channel the assistant response arrives on, captured from the
/// live client. Text on any other channel is treated as reasoning.
pub(super) const ASSISTANT_CHANNEL: &str = "CHANNEL_ASSISTANT_RESPONSE";

/// The three outcomes of one upstream frame that matter to translation.
pub(super) enum WsFrame {
    Text(String),
    Reasoning(String),
    Completed,
    Failed(String),
    Errored(String),
    Ignored,
}

pub(super) fn classify_message(message: Message) -> Result<WsFrame, APIError> {
    match message {
        Message::Text(text) => {
            let raw = text.to_string();
            // A malformed frame is skipped rather than failing the request,
            // mirroring the reference NDJSON reader.
            match serde_json::from_str::<Value>(&raw) {
                Ok(value) => Ok(classify_value(&value)),
                Err(_) => Ok(WsFrame::Ignored),
            }
        }
        Message::Close(_) => Err(APIError::new(
            500,
            constants::providers::grok_web::STREAM_ENDED,
        )),
        _ => Ok(WsFrame::Ignored),
    }
}

pub(super) fn classify_value(value: &Value) -> WsFrame {
    if let Some(message) = event_error_message(value) {
        return WsFrame::Errored(message);
    }

    let event = &value["event"];
    match event["type"].as_str() {
        Some("response.chunk") => {
            let Some(text) = event["chunk"]["text"].as_object() else {
                return WsFrame::Ignored;
            };
            let Some(body) = text.get("text").and_then(Value::as_str) else {
                return WsFrame::Ignored;
            };
            if body.is_empty() {
                return WsFrame::Ignored;
            }
            // Only the assistant channel carries the answer; text observed on
            // any other channel is routed to reasoning so response text is
            // never polluted by phase markers. The assistant channel is the
            // only one the live free-tier probes produced, so other channels
            // remain an assumption flagged in the implementation report.
            let reasoning = text
                .get("channel")
                .and_then(Value::as_str)
                .is_some_and(|channel| channel != ASSISTANT_CHANNEL);
            if reasoning {
                WsFrame::Reasoning(body.to_owned())
            } else {
                WsFrame::Text(body.to_owned())
            }
        }
        Some("response.done") => {
            let response = &event["response"];
            let status = response["status"].as_str().unwrap_or_default();
            if status == "completed" {
                return WsFrame::Completed;
            }
            let reason = response["status_details"]["reason"]
                .as_str()
                .unwrap_or(status)
                .to_owned();
            WsFrame::Failed(reason)
        }
        Some(event_type) if event_type.contains("error") => WsFrame::Errored(
            event["message"]
                .as_str()
                .unwrap_or("Grok Web reported an upstream error")
                .to_owned(),
        ),
        _ => WsFrame::Ignored,
    }
}

/// Extracts a user-facing message from the two error shapes the reference
/// reader handled: a top-level `error` object and an error event.
pub(super) fn event_error_message(value: &Value) -> Option<String> {
    if let Some(error) = value.get("error") {
        if let Some(message) = error.get("message").and_then(Value::as_str) {
            return Some(message.to_owned());
        }
        if let Some(message) = error.as_str() {
            return Some(message.to_owned());
        }
    }
    None
}
