//! Anthropic Messages API routes (`/v1/messages` and `/v1/messages/count_tokens`).
//!
//! Handles Anthropic-formatted chat completion and token counting requests,
//! translating them onto SRouter's internal provider network and streaming back
//! Anthropic SSE events or JSON responses.

use std::convert::Infallible;

use axum::{
    Json,
    body::Bytes,
    extract::{Extension, Request, State},
    http::{StatusCode, Version},
    response::{IntoResponse, Response},
};
use futures_util::StreamExt;
use serde_json::Value;

use crate::constants;
use crate::features::api_keys::{APIPrincipal, ensure_model_allowed_any};
use crate::features::gateway::interception::{
    BodyError, MAX_INTERCEPT_DEPTH, StreamTurn, log_request, log_stream_success, observe_usage,
    read_json_body, run_buffered_interception, stream_error_payload, stream_log_status,
    try_intercept, unresolved_provider_id,
};
use crate::features::gateway::token_saver::apply_to_request;
use crate::features::gateway::translation::{
    AnthropicMessageRequest, AnthropicStreamTranslator, AnthropicThinking, anthropic_error,
    anthropic_error_event_bytes, anthropic_error_type, anthropic_error_typed,
    anthropic_to_openai_request, estimate_tokens, openai_to_anthropic_response,
    validate_anthropic_request,
};
use crate::features::gateway::{ReceiverStream, RequestLogContext};
use crate::protocol::model::ChatCompletionRequest;
use crate::protocol::sse;
use crate::protocol::usage::UsageBreakdown;
use crate::state::AppState;

/// Handles `POST /v1/messages`.
pub async fn create_message(
    State(state): State<AppState>,
    principal: Option<Extension<APIPrincipal>>,
    request: Request,
) -> Response {
    let version = request.version();
    let log_context = match RequestLogContext::from_request(&request, principal.as_ref()) {
        Ok(context) => context,
        Err(error) => return error.into_response(),
    };

    let anthropic_req = match read_anthropic_request(request).await {
        Ok(request) => request,
        Err(response) => return *response,
    };

    // Enforce model allowlist for this API key, against every name the requested
    // model answers to.
    let api_key = principal.as_ref().and_then(|ext| ext.0.api_key.as_ref());
    if let Err(err) = ensure_model_allowed_any(
        api_key,
        &state.providers.model_id_variants(&anthropic_req.model),
    ) {
        return anthropic_error(403, err.message());
    }

    // Node counts anything that is not `disabled` as enabled, so `adaptive`
    // opens the thinking stream too.
    let is_thinking_enabled = match &anthropic_req.thinking {
        Some(AnthropicThinking::Disabled) => false,
        Some(AnthropicThinking::Enabled { .. } | AnthropicThinking::Adaptive { .. }) => true,
        None => false,
    };

    let original_model = anthropic_req.model.clone();
    let stream = anthropic_req.stream;
    let mut chat_request = anthropic_to_openai_request(anthropic_req);
    apply_to_request(&mut chat_request);

    if stream {
        return stream_anthropic_message(
            state,
            original_model,
            chat_request,
            version,
            is_thinking_enabled,
            log_context,
        );
    }

    let resolved = match state.providers.resolve(&chat_request.model) {
        Some(resolved) => resolved,
        None => {
            return anthropic_error(
                404,
                constants::gateway::model_not_registered(&original_model),
            );
        }
    };

    let final_response =
        match run_buffered_interception(&state, &resolved, chat_request, &log_context).await {
            Ok(response) => response,
            Err(error) => return anthropic_error(error.status(), error.message()),
        };

    let anthropic_res =
        openai_to_anthropic_response(&final_response, &original_model, is_thinking_enabled);
    (StatusCode::OK, Json(anthropic_res)).into_response()
}

/// Handles `POST /v1/messages/count_tokens`.
pub async fn count_tokens(
    State(state): State<AppState>,
    principal: Option<Extension<APIPrincipal>>,
    request: Request,
) -> Response {
    let anthropic_req = match read_anthropic_request(request).await {
        Ok(request) => request,
        Err(response) => return *response,
    };

    let api_key = principal.as_ref().and_then(|ext| ext.0.api_key.as_ref());
    if let Err(err) = ensure_model_allowed_any(
        api_key,
        &state.providers.model_id_variants(&anthropic_req.model),
    ) {
        return anthropic_error(403, err.message());
    }

    let input_tokens = estimate_tokens(&anthropic_req);

    (
        StatusCode::OK,
        Json(serde_json::json!({
            "input_tokens": input_tokens
        })),
    )
        .into_response()
}

/// Reads and validates a messages-route body, mapping every failure onto the
/// Anthropic envelope: Node's `MessagesController` parse step (any parse
/// failure, `null`, or a scalar becomes `Invalid JSON request body`), then
/// its schema step, then deserialization. The error is boxed because
/// `axum::response::Response` is 128 bytes (clippy `result_large_err`).
async fn read_anthropic_request(
    request: Request,
) -> Result<AnthropicMessageRequest, Box<Response>> {
    let body = read_json_body(request)
        .await
        .map_err(|error| Box::new(anthropic_body_error(error)))?;
    match &body {
        Value::Object(_) => {}
        Value::Array(_) => {
            return Err(Box::new(anthropic_error(
                400,
                constants::gateway::anthropic::expected("object", "array"),
            )));
        }
        _ => {
            return Err(Box::new(anthropic_error(
                400,
                constants::gateway::anthropic::INVALID_JSON_BODY,
            )));
        }
    }
    validate_anthropic_request(&body).map_err(|message| Box::new(anthropic_error(400, message)))?;
    serde_json::from_value(body).map_err(|error| {
        Box::new(anthropic_error(
            400,
            constants::gateway::invalid_request_body(&error),
        ))
    })
}

/// Maps a body failure onto the Anthropic error envelope; the chat routes map
/// the same failure onto the OpenAI envelope instead. Empty and malformed
/// bodies share Node's text, and the `413` pins `invalid_request_error` the
/// way `MessagesController` passes it by hand.
fn anthropic_body_error(error: BodyError) -> Response {
    match error {
        BodyError::TooLarge => {
            anthropic_error_typed(413, "invalid_request_error", constants::json::TOO_LARGE)
        }
        BodyError::Empty | BodyError::Malformed => {
            anthropic_error(400, constants::gateway::anthropic::INVALID_JSON_BODY)
        }
    }
}

async fn run_anthropic_streaming_interception_loop(
    state: AppState,
    original_model: String,
    mut chat_request: ChatCompletionRequest,
    is_thinking_enabled: bool,
    context: RequestLogContext,
    tx: tokio::sync::mpsc::Sender<Result<Bytes, Infallible>>,
) {
    let mut current_depth = 0;
    let mut stream_usage = UsageBreakdown::default();

    while current_depth <= MAX_INTERCEPT_DEPTH {
        let resolved = match state.providers.resolve(&chat_request.model) {
            Some(resolved) => resolved,
            None => {
                let message = constants::gateway::model_not_registered(&original_model);
                let _ = tx
                    .send(Ok(anthropic_error_event_bytes(
                        anthropic_error_type(404),
                        &message,
                    )))
                    .await;
                let provider_id = unresolved_provider_id(&chat_request.model).to_owned();
                log_request(
                    &state,
                    &context,
                    &provider_id,
                    &chat_request.model,
                    None,
                    404,
                    &UsageBreakdown::default(),
                    Some(&message),
                )
                .await;
                return;
            }
        };

        let mut stream = match resolved
            .adapter
            .chat_completion_stream(&resolved.model, &chat_request)
            .await
        {
            Ok(stream) => stream,
            Err(error) => {
                let _ = tx
                    .send(Ok(anthropic_error_event_bytes(
                        anthropic_error_type(error.status()),
                        error.message(),
                    )))
                    .await;
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

        let mut translator = AnthropicStreamTranslator::new(&original_model, is_thinking_enabled);
        let mut buffered_chunks: Vec<Value> = Vec::new();
        let mut decoder = sse::SseDataDecoder::new();
        let mut turn = StreamTurn::default();
        let mut streamed_directly = false;
        let mut stream_failure: Option<(u16, String)> = None;

        // The client disconnect races the upstream read: once the response
        // body is dropped, `tx.closed()` wins the select, this function
        // returns, and dropping `stream` cancels the in-flight upstream
        // request instead of draining it the way Node does. Billing records
        // only the usage observed before the disconnect (partial output).
        'read: loop {
            let bytes = tokio::select! {
                biased;
                _ = tx.closed() => {
                    log_stream_success(
                        &state,
                        &context,
                        &resolved,
                        &chat_request.model,
                        &stream_usage,
                    )
                    .await;
                    return;
                }
                next = stream.next() => match next {
                    Some(bytes) => bytes,
                    None => break 'read,
                },
            };

            for json in decoder.push(&bytes) {
                observe_usage(&json, &mut stream_usage);

                // An in-stream failure becomes an Anthropic `error` event,
                // after whatever partial output was already streamed (Node's
                // controller writes the error event and closes the stream);
                // the frame itself never reaches the translator.
                if let Some((status, message)) = stream_error_payload(&json) {
                    let _ = tx
                        .send(Ok(anthropic_error_event_bytes(
                            anthropic_error_type(status),
                            &message,
                        )))
                        .await;
                    stream_failure = Some((status, message));
                    break 'read;
                }

                if streamed_directly {
                    for event in translator.feed_chunk(&json) {
                        if tx.send(Ok(event)).await.is_err() {
                            log_stream_success(
                                &state,
                                &context,
                                &resolved,
                                &chat_request.model,
                                &stream_usage,
                            )
                            .await;
                            return;
                        }
                    }
                    continue;
                }

                buffered_chunks.push(json.clone());

                if turn.observe_delta(&json) {
                    streamed_directly = true;
                    for chunk in buffered_chunks.drain(..) {
                        for event in translator.feed_chunk(&chunk) {
                            if tx.send(Ok(event)).await.is_err() {
                                log_stream_success(
                                    &state,
                                    &context,
                                    &resolved,
                                    &chat_request.model,
                                    &stream_usage,
                                )
                                .await;
                                return;
                            }
                        }
                    }
                }
            }
        }

        // A stream that fails after partial output bills nothing (Node's
        // `does not bill a stream that errors after partial output`): the log
        // row carries the failure status with zero usage, and `log_request`
        // releases any reservation instead of settling it. No `message_stop`
        // follows the error event — Node closes right after it.
        if let Some((status, message)) = stream_failure.take() {
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
            for event in translator.finish() {
                if tx.send(Ok(event)).await.is_err() {
                    log_stream_success(
                        &state,
                        &context,
                        &resolved,
                        &chat_request.model,
                        &stream_usage,
                    )
                    .await;
                    return;
                }
            }
            log_stream_success(
                &state,
                &context,
                &resolved,
                &chat_request.model,
                &stream_usage,
            )
            .await;
            return;
        }

        if try_intercept(&state, &mut chat_request, &turn, &mut current_depth).await {
            continue;
        }

        // Emit all buffered chunks through translator to client
        for chunk in buffered_chunks {
            for event in translator.feed_chunk(&chunk) {
                if tx.send(Ok(event)).await.is_err() {
                    log_stream_success(
                        &state,
                        &context,
                        &resolved,
                        &chat_request.model,
                        &stream_usage,
                    )
                    .await;
                    return;
                }
            }
        }
        for event in translator.finish() {
            if tx.send(Ok(event)).await.is_err() {
                log_stream_success(
                    &state,
                    &context,
                    &resolved,
                    &chat_request.model,
                    &stream_usage,
                )
                .await;
                return;
            }
        }
        log_stream_success(
            &state,
            &context,
            &resolved,
            &chat_request.model,
            &stream_usage,
        )
        .await;
        return;
    }
}

fn stream_anthropic_message(
    state: AppState,
    original_model: String,
    chat_request: ChatCompletionRequest,
    version: Version,
    is_thinking_enabled: bool,
    context: RequestLogContext,
) -> Response {
    let (tx, rx) = tokio::sync::mpsc::channel::<Result<Bytes, Infallible>>(64);

    tokio::spawn(async move {
        run_anthropic_streaming_interception_loop(
            state,
            original_model,
            chat_request,
            is_thinking_enabled,
            context,
            tx,
        )
        .await;
    });

    let events = ReceiverStream(rx);

    sse::sse_response(events, version)
        .unwrap_or_else(|_| anthropic_error(500, constants::gateway::COULD_NOT_BUILD_STREAM))
}
