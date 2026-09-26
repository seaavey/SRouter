use std::convert::Infallible;
use std::pin::Pin;

use axum::{
    Json,
    body::{Body, Bytes, to_bytes},
    extract::{Extension, Request, State},
    http::{StatusCode, Version, header},
    response::{IntoResponse, Response},
};
use futures_util::{Stream, StreamExt};
use serde_json::Value;

use crate::error::APIError;
use crate::features::api_keys::{APIPrincipal, ensure_model_allowed};
use crate::features::gateway::model::{
    ChatCompletionRequest, ChatRole, parse_chat_completion_request,
};
use crate::features::gateway::sse;
use crate::state::AppState;

/// Mirrors the Node gateway's global body cap: oversized bodies are rejected
/// with `413` and `code=request_too_large` before parsing.
const MAX_BODY_BYTES: usize = 25 * 1024 * 1024;

/// Handles `POST /v1/chat/completions`. The body is parsed and validated the
/// way the frozen contract requires (`400` + error envelope for empty,
/// malformed, or schema-invalid JSON), then the requested model is resolved
/// against the provider registry and the matching adapter performs the call.
pub async fn create_completion(
    State(state): State<AppState>,
    principal: Option<Extension<APIPrincipal>>,
    request: Request,
) -> Result<Response, APIError> {
    let version = request.version();
    let body = read_json_body(request).await?;
    let mut chat_request = parse_chat_completion_request(body)?;

    // Node checks the allowlist after validation and before the controller, so
    // this runs before provider resolution and before the stream opens.
    ensure_model_allowed(
        principal.as_ref().and_then(|ext| ext.0.api_key.as_ref()),
        &chat_request.model,
    )?;

    // Normalize `developer` messages to `system` to match the frozen API v1 contract.
    for message in &mut chat_request.messages {
        if message.role == ChatRole::Developer {
            message.role = ChatRole::System;
        }
    }

    if chat_request.stream {
        return stream_completion(state, chat_request, version);
    }

    let resolved = state
        .providers
        .resolve(&chat_request.model)
        .ok_or_else(|| unregistered_model(&chat_request.model))?;
    let response = resolved
        .adapter
        .chat_completion(&resolved.model, &chat_request)
        .await?;

    Ok(Json(response).into_response())
}

/// Reads the raw request body without the `Json` extractor so empty,
/// malformed, and schema-invalid bodies all return the contract's `400`
/// envelope instead of an extractor-specific rejection.
async fn read_json_body(request: Request) -> Result<Value, APIError> {
    if let Some(length) = request
        .headers()
        .get(header::CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.trim().parse::<u64>().ok())
    {
        if length > MAX_BODY_BYTES as u64 {
            return Err(body_too_large());
        }
    }

    // The limit also covers chunked bodies that lie about their length.
    let bytes = to_bytes(request.into_body(), MAX_BODY_BYTES)
        .await
        .map_err(|_| body_too_large())?;

    let text = std::str::from_utf8(&bytes).map_err(|_| invalid_json())?;
    if text.trim().is_empty() {
        return Err(invalid_json_empty());
    }

    serde_json::from_str(text).map_err(|_| invalid_json())
}

fn body_too_large() -> APIError {
    APIError::new(413, "Request body too large").with_code("request_too_large")
}

fn invalid_json() -> APIError {
    APIError::new(
        400,
        "Malformed JSON in request body. Please verify JSON syntax.",
    )
    .with_code("invalid_json")
}

fn invalid_json_empty() -> APIError {
    APIError::new(400, "Request body cannot be empty. Valid JSON is required.")
        .with_code("invalid_json")
}

fn unregistered_model(model: &str) -> APIError {
    APIError::new(
        404,
        format!("No provider is registered for model '{model}'"),
    )
}

/// Opens the SSE response first and performs model resolution plus the
/// upstream call inside the stream, so a failure surfaces as an in-stream
/// error event exactly like the Node gateway.
fn stream_completion(
    state: AppState,
    chat_request: ChatCompletionRequest,
    version: Version,
) -> Result<Response, APIError> {
    let providers = state.providers.clone();
    let upstream = async move {
        match providers.resolve(&chat_request.model) {
            None => Err(unregistered_model(&chat_request.model)),
            Some(resolved) => {
                resolved
                    .adapter
                    .chat_completion_stream(&resolved.model, &chat_request)
                    .await
            }
        }
    };

    let events = futures_util::stream::once(upstream)
        .map(|result| match result {
            Ok(stream) => stream,
            Err(error) => {
                let events = futures_util::stream::iter([sse::error_event_bytes(&error)]);
                Box::pin(events) as Pin<Box<dyn Stream<Item = Bytes> + Send>>
            }
        })
        .flatten()
        .map(|bytes| Ok::<Bytes, Infallible>(bytes));

    stream_response(events, version)
}

fn stream_response<S>(events: S, version: Version) -> Result<Response, APIError>
where
    S: Stream<Item = Result<Bytes, Infallible>> + Send + 'static,
{
    let mut builder = Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "text/event-stream")
        .header(header::CACHE_CONTROL, "no-cache, no-transform")
        .header("x-accel-buffering", "no");

    // `Connection` is a HTTP/1.x hop-by-hop header; HTTP/2 forbids it.
    if version == Version::HTTP_10 || version == Version::HTTP_11 {
        builder = builder.header(header::CONNECTION, "keep-alive");
    }

    builder.body(Body::from_stream(events)).map_err(|error| {
        APIError::new(500, format!("could not build the stream response: {error}"))
    })
}
