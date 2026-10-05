use axum::body::Bytes;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde::{Deserialize, Serialize};

// ============================================================================
// Error & Envelope Helpers
// ============================================================================

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AnthropicErrorBody {
    #[serde(rename = "type")]
    pub error_type: String,
    pub message: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AnthropicErrorEnvelope {
    #[serde(rename = "type")]
    pub envelope_type: &'static str,
    pub error: AnthropicErrorBody,
}

/// Node's `GetErrorTypeFromStatus` for the Anthropic envelope. It has no
/// `413`/`529` special cases, so neither does this map.
pub fn anthropic_error_type(status: u16) -> &'static str {
    match status {
        400 | 404 | 409 | 422 => "invalid_request_error",
        401 => "authentication_error",
        403 => "permission_error",
        429 => "rate_limit_error",
        _ => "api_error",
    }
}

pub fn anthropic_error(status: u16, message: impl Into<String>) -> Response {
    anthropic_error_typed(status, anthropic_error_type(status), message)
}

/// Renders an envelope with an explicit error type. The route's own body
/// limit pins `invalid_request_error` for `413`, the one case Node passes
/// by hand (`MessagesController`), while an upstream `413` would still map
/// to `api_error` through [`anthropic_error_type`].
pub fn anthropic_error_typed(
    status: u16,
    error_type: &'static str,
    message: impl Into<String>,
) -> Response {
    let envelope = AnthropicErrorEnvelope {
        envelope_type: "error",
        error: AnthropicErrorBody {
            error_type: error_type.to_owned(),
            message: message.into(),
        },
    };

    let status_code = StatusCode::from_u16(status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
    (status_code, axum::Json(envelope)).into_response()
}

pub fn anthropic_error_event_bytes(error_type: &str, message: &str) -> Bytes {
    let payload = serde_json::json!({
        "type": "error",
        "error": {
            "type": error_type,
            "message": message
        }
    });
    Bytes::from(format!("event: error\ndata: {payload}\n\n"))
}
