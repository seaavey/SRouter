use std::convert::Infallible;

use axum::{
    Json,
    body::Bytes,
    extract::{Extension, Request, State},
    http::Version,
    response::{IntoResponse, Response},
};
use futures_util::{Stream, StreamExt};
use serde_json::Value;

use crate::constants;
use crate::error::APIError;
use crate::features::api_keys::{APIPrincipal, ensure_model_allowed_any};
use crate::features::gateway::interception::{
    MAX_INTERCEPT_DEPTH, StreamTurn, body_error_to_api_error, log_request, observe_usage,
    read_json_body, run_buffered_interception, stream_error_payload, stream_log_status,
    try_intercept, unresolved_provider_id,
};
use crate::features::gateway::token_saver::apply_to_request;
use crate::features::gateway::{ReceiverStream, RequestLogContext};
use crate::protocol::model::{ChatCompletionRequest, ChatRole, parse_chat_completion_request};
use crate::protocol::sse;
use crate::protocol::usage::UsageBreakdown;
use crate::state::AppState;

/// Default per-request token budget reserved on an API key when the request
/// carries no `max_tokens` (`apps/api/src/controllers/chat.controller.ts`).
const DEFAULT_RESERVED_TOKENS: u32 = 4096;

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
    let mut log_context = RequestLogContext::from_request(&request, principal.as_ref())?;

    let body = read_json_body(request)
        .await
        .map_err(body_error_to_api_error)?;
    let mut chat_request = parse_chat_completion_request(body)?;

    // Node checks the allowlist after validation and before the controller, so
    // this runs before provider resolution and before the stream opens. The
    // check spans every name of the requested model, which a live catalog may
    // advertise under both a raw key and a friendly name.
    ensure_model_allowed_any(
        principal.as_ref().and_then(|ext| ext.0.api_key.as_ref()),
        &state.providers.model_id_variants(&chat_request.model),
    )?;

    // Normalize `developer` messages to `system` to match the frozen API v1 contract.
    for message in &mut chat_request.messages {
        if message.role == ChatRole::Developer {
            message.role = ChatRole::System;
        }
    }

    // Strip noisy tool output and apply the terse directive once per top-level request.
    apply_to_request(&mut chat_request);

    if chat_request.stream {
        // Streamed requests log every outcome inside the spawned loop, so the
        // reservation is always settled or released there.
        log_context.reserved_tokens =
            reserve_api_key_quota(&state, principal.as_ref(), &chat_request).await?;

        return stream_completion(state, chat_request, version, log_context);
    }

    // Resolve before reserving: an unregistered model returns without logging,
    // and a reservation that is never settled would stay charged.
    let resolved = match state.providers.resolve(&chat_request.model) {
        Some(resolved) => resolved,
        None => {
            state.providers.maybe_refresh_catalogs(false).await;
            state
                .providers
                .resolve(&chat_request.model)
                .ok_or_else(|| unregistered_model(&chat_request.model))?
        }
    };

    log_context.reserved_tokens =
        reserve_api_key_quota(&state, principal.as_ref(), &chat_request).await?;

    let final_response =
        run_buffered_interception(&state, &resolved, chat_request, &log_context).await?;

    Ok(Json(final_response).into_response())
}

/// Reserves the request's token budget on the API key, mirroring the Node chat
/// controller: `max_tokens`, defaulting to [`DEFAULT_RESERVED_TOKENS`], must fit
/// the key's quota or the request is rejected with `429 quota_exceeded` before
/// any upstream call. Returns the reserved budget so the completion can settle
/// it. Anonymous requests reserve nothing.
async fn reserve_api_key_quota(
    state: &AppState,
    principal: Option<&Extension<APIPrincipal>>,
    chat_request: &ChatCompletionRequest,
) -> Result<Option<i64>, APIError> {
    let Some(api_key) = principal.and_then(|extension| extension.0.api_key.as_ref()) else {
        return Ok(None);
    };

    let reserved = i64::from(chat_request.max_tokens.unwrap_or(DEFAULT_RESERVED_TOKENS));
    if !state
        .security
        .key_repository
        .reserve_quota(&api_key.id, reserved)
        .await?
    {
        return Err(
            APIError::new(429, constants::api_key::RESERVATION_UNAVAILABLE)
                .with_code(constants::ErrorCode::QuotaExceeded),
        );
    }

    Ok(Some(reserved))
}

fn unregistered_model(model: &str) -> APIError {
    APIError::new(404, constants::gateway::model_not_registered(model))
}

/// Runs the streaming completion with server-side tool interception support.
/// If the model emits tool calls (such as search) that the client did not define,
/// the gateway buffers the stream, performs the search in parallel, and opens
/// a follow-up stream with the tool results. If no interceptable tool calls exist,
/// the buffered chunks are yielded directly to the client.
async fn run_streaming_interception_loop(
    state: AppState,
    mut chat_request: ChatCompletionRequest,
    context: RequestLogContext,
    tx: tokio::sync::mpsc::Sender<Result<Bytes, Infallible>>,
) {
    let mut current_depth = 0;
    let mut stream_usage = UsageBreakdown::default();

    while current_depth <= MAX_INTERCEPT_DEPTH {
        let resolved = match state.providers.resolve(&chat_request.model) {
            Some(resolved) => resolved,
            None => {
                state.providers.maybe_refresh_catalogs(false).await;
                match state.providers.resolve(&chat_request.model) {
                    Some(resolved) => resolved,
                    None => {
                        let error = unregistered_model(&chat_request.model);
                        let _ = tx.send(Ok(sse::error_event_bytes(&error))).await;
                        let provider_id = unresolved_provider_id(&chat_request.model).to_owned();
                        log_request(
                            &state,
                            &context,
                            &provider_id,
                            &chat_request.model,
                            None,
                            404,
                            &UsageBreakdown::default(),
                            Some(error.message()),
                        )
                        .await;
                        return;
                    }
                }
            }
        };

        let mut stream = match resolved
            .adapter
            .chat_completion_stream(&resolved.model, &chat_request)
            .await
        {
            Ok(stream) => stream,
            Err(error) => {
                let _ = tx.send(Ok(sse::error_event_bytes(&error))).await;
                log_request(
                    &state,
                    &context,
                    resolved.adapter.id(),
                    &chat_request.model,
                    Some(&resolved.model),
                    stream_log_status(error.message(), error.status()),
                    &UsageBreakdown::default(),
                    Some(error.message()),
                )
                .await;
                return;
            }
        };

        let mut buffered_bytes: Vec<Bytes> = Vec::new();
        let mut decoder = sse::SseDataDecoder::new();
        let mut turn = StreamTurn::default();
        let mut streamed_directly = false;
        let mut stream_failure: Option<(u16, String)> = None;
        let mut failure_payload: Option<Value> = None;

        // The client disconnect races the upstream read: once the response
        // body is dropped, `tx.closed()` wins the select, this function
        // returns, and dropping `stream` cancels the in-flight upstream
        // request instead of draining it the way Node does. Billing records
        // only the usage observed before the disconnect (partial output).
        'read: loop {
            let bytes = tokio::select! {
                biased;
                _ = tx.closed() => {
                    log_request(
                        &state,
                        &context,
                        resolved.adapter.id(),
                        &chat_request.model,
                        Some(&resolved.model),
                        200,
                        &stream_usage,
                        None,
                    )
                    .await;
                    return;
                }
                next = stream.next() => match next {
                    Some(bytes) => bytes,
                    None => break 'read,
                },
            };

            if streamed_directly {
                for json in decoder.push(&bytes) {
                    observe_usage(&json, &mut stream_usage);
                    if let Some(failure) = stream_error_payload(&json) {
                        stream_failure = Some(failure);
                    }
                }
                if tx.send(Ok(bytes)).await.is_err() {
                    log_request(
                        &state,
                        &context,
                        resolved.adapter.id(),
                        &chat_request.model,
                        Some(&resolved.model),
                        200,
                        &stream_usage,
                        None,
                    )
                    .await;
                    return;
                }
                // The failure payload itself is forwarded verbatim above; stop
                // reading so nothing after the failure reaches the client.
                if stream_failure.is_some() {
                    break 'read;
                }
                continue;
            }

            buffered_bytes.push(bytes.clone());

            for json in decoder.push(&bytes) {
                observe_usage(&json, &mut stream_usage);

                if let Some(failure) = stream_error_payload(&json) {
                    stream_failure = Some(failure);
                    failure_payload = Some(json);
                    break 'read;
                }

                if turn.observe_delta(&json) {
                    streamed_directly = true;
                    for buffered in buffered_bytes.drain(..) {
                        if tx.send(Ok(buffered)).await.is_err() {
                            log_request(
                                &state,
                                &context,
                                resolved.adapter.id(),
                                &chat_request.model,
                                Some(&resolved.model),
                                200,
                                &stream_usage,
                                None,
                            )
                            .await;
                            return;
                        }
                    }
                }
            }
        }

        // A stream that fails after partial output bills nothing (Node's
        // `does not bill a stream that errors after partial output`): the log
        // row carries the failure status with zero usage, and `log_request`
        // releases any reservation instead of settling it.
        if let Some((status, message)) = stream_failure.take() {
            if !streamed_directly
                && let Some(json) = failure_payload.take()
                && let Ok(payload) = serde_json::to_string(&json)
            {
                // Nothing was client-visible yet, so — like Node, where the
                // generator never yielded — only the failure payload is sent
                // and the buffered output is discarded.
                let _ = tx
                    .send(Ok(Bytes::from(format!("data: {payload}\n\n"))))
                    .await;
            }
            log_request(
                &state,
                &context,
                resolved.adapter.id(),
                &chat_request.model,
                Some(&resolved.model),
                status,
                &UsageBreakdown::default(),
                Some(&message),
            )
            .await;
            return;
        }

        if streamed_directly {
            log_request(
                &state,
                &context,
                resolved.adapter.id(),
                &chat_request.model,
                Some(&resolved.model),
                200,
                &stream_usage,
                None,
            )
            .await;
            return;
        }

        if try_intercept(&state, &mut chat_request, &turn, &mut current_depth).await {
            continue;
        }

        for buffered in buffered_bytes {
            if tx.send(Ok(buffered)).await.is_err() {
                log_request(
                    &state,
                    &context,
                    resolved.adapter.id(),
                    &chat_request.model,
                    Some(&resolved.model),
                    200,
                    &stream_usage,
                    None,
                )
                .await;
                return;
            }
        }
        log_request(
            &state,
            &context,
            resolved.adapter.id(),
            &chat_request.model,
            Some(&resolved.model),
            200,
            &stream_usage,
            None,
        )
        .await;
        return;
    }
}

/// Opens the SSE response first and performs model resolution plus the
/// upstream call inside the stream, with server-side tool interception support.
fn stream_completion(
    state: AppState,
    chat_request: ChatCompletionRequest,
    version: Version,
    context: RequestLogContext,
) -> Result<Response, APIError> {
    let (tx, rx) = tokio::sync::mpsc::channel::<Result<Bytes, Infallible>>(64);

    tokio::spawn(async move {
        run_streaming_interception_loop(state, chat_request, context, tx).await;
    });

    let events = ReceiverStream(rx);
    stream_response(events, version)
}

fn stream_response<S>(events: S, version: Version) -> Result<Response, APIError>
where
    S: Stream<Item = Result<Bytes, Infallible>> + Send + 'static,
{
    sse::sse_response(events, version)
        .map_err(|error| APIError::new(500, constants::gateway::could_not_build_stream(&error)))
}
