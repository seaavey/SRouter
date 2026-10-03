use std::convert::Infallible;

use axum::{
    Json,
    body::{Body, Bytes},
    extract::{Extension, Request, State},
    http::{StatusCode, Version, header},
    response::{IntoResponse, Response},
};
use futures_util::{Stream, StreamExt};
use serde_json::Value;

use crate::constants;
use crate::error::APIError;
use crate::features::api_keys::{APIPrincipal, ensure_model_allowed_any};
use crate::features::gateway::interception::{
    MAX_INTERCEPT_DEPTH, StreamTurn, assembled_to_tool_call, assistant_tool_message,
    attach_search_results, body_error_to_api_error, log_request, observe_usage, read_json_body,
    run_buffered_interception, stream_log_status, unresolved_provider_id,
};
use crate::features::gateway::interceptor::should_intercept_tool_call;
use crate::features::gateway::model::{
    ChatCompletionRequest, ChatRole, ToolCall, parse_chat_completion_request,
};
use crate::features::gateway::sse;
use crate::features::gateway::token_saver::apply_to_request;
use crate::features::gateway::usage::UsageBreakdown;
use crate::features::gateway::{ReceiverStream, RequestLogContext};
use crate::state::AppState;

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
    let log_context = RequestLogContext::from_request(&request, principal.as_ref())?;

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
        return stream_completion(state, chat_request, version, log_context);
    }

    let resolved = state
        .providers
        .resolve(&chat_request.model)
        .ok_or_else(|| unregistered_model(&chat_request.model))?;

    let final_response =
        run_buffered_interception(&state, &resolved, chat_request, &log_context).await?;

    Ok(Json(final_response).into_response())
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
        let mut line_buffer = String::new();
        let mut turn = StreamTurn::default();
        let mut streamed_directly = false;

        while let Some(bytes) = stream.next().await {
            if streamed_directly {
                if let Ok(text) = std::str::from_utf8(&bytes) {
                    line_buffer.push_str(text);
                    while let Some(pos) = line_buffer.find('\n') {
                        let line = line_buffer[..pos].trim_end_matches('\r').to_owned();
                        line_buffer.drain(..=pos);
                        if let Some(data) = line.strip_prefix("data:")
                            && let Ok(json) = serde_json::from_str::<Value>(data.trim())
                        {
                            observe_usage(&json, &mut stream_usage);
                        }
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
                continue;
            }

            buffered_bytes.push(bytes.clone());

            if let Ok(text) = std::str::from_utf8(&bytes) {
                line_buffer.push_str(text);

                while let Some(pos) = line_buffer.find('\n') {
                    let line = line_buffer[..pos].trim_end_matches('\r').to_owned();
                    line_buffer.drain(..=pos);

                    let Some(data) = line.strip_prefix("data:") else {
                        continue;
                    };
                    let data = data.trim();
                    if data.is_empty() || data == "[DONE]" {
                        continue;
                    }

                    let Ok(json) = serde_json::from_str::<Value>(data) else {
                        continue;
                    };
                    observe_usage(&json, &mut stream_usage);

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

        let calls: Vec<ToolCall> = turn
            .assembled()
            .iter()
            .map(assembled_to_tool_call)
            .collect();
        let interceptable: Vec<ToolCall> = calls
            .iter()
            .filter(|call| {
                should_intercept_tool_call(&call.function.name, chat_request.tools.as_deref())
            })
            .cloned()
            .collect();

        if !interceptable.is_empty() && current_depth < MAX_INTERCEPT_DEPTH {
            chat_request
                .messages
                .push(assistant_tool_message(turn.content(), calls));
            attach_search_results(&state, &mut chat_request, interceptable).await;

            current_depth += 1;
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

    // `Connection` is a HTTP/1.x hop-by-hop header; HTTP/2 forbids it.
    if version == Version::HTTP_10 || version == Version::HTTP_11 {
        builder = builder.header(header::CONNECTION, constants::headers::value::KEEP_ALIVE);
    }

    builder
        .body(Body::from_stream(events))
        .map_err(|error| APIError::new(500, constants::gateway::could_not_build_stream(&error)))
}
