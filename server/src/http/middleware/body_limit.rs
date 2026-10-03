use axum::body::Body;
use axum::extract::Request;
use axum::http::header;
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};

use crate::constants;
use crate::error::APIError;

/// Max accepted request body in bytes (25 MB). Matches Node MAX_BODY_BYTES.
pub const MAX_BODY_BYTES: u64 = 25 * 1024 * 1024;

/// Rejects oversized bodies from the Content-Length header before the body is buffered.
/// Mirrors `apps/api/src/middleware/BodyLimit.ts`.
pub async fn body_limit(request: Request<Body>, next: Next) -> Response {
    if let Some(length) = request
        .headers()
        .get(header::CONTENT_LENGTH)
        .and_then(|val| val.to_str().ok())
        .and_then(|val| val.trim().parse::<u64>().ok())
        && length > MAX_BODY_BYTES
    {
        return body_too_large().into_response();
    }

    next.run(request).await
}

fn body_too_large() -> APIError {
    APIError::new(413, constants::json::TOO_LARGE)
        .with_error_type(constants::error_type::INVALID_REQUEST)
        .with_code(constants::code::REQUEST_TOO_LARGE)
}
