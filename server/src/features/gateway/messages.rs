//! Anthropic Messages API routes (`/v1/messages` and `/v1/messages/count_tokens`).
//!
//! Handles Anthropic-formatted chat completion and token counting requests,
//! translating them onto SRouter's internal provider network and streaming back
//! Anthropic SSE events or JSON responses.

use std::convert::Infallible;

use axum::{
    Json,
    body::{Body, Bytes},
    extract::{Extension, Request, State},
    http::{StatusCode, Version, header},
    response::{IntoResponse, Response},
};
use futures_util::StreamExt;
use serde_json::Value;

use crate::constants;
use crate::features::api_keys::{APIPrincipal, ensure_model_allowed_any};
use crate::features::gateway::anthropic::{
    AnthropicMessageRequest, AnthropicStreamTranslator, AnthropicThinking, anthropic_error,
    anthropic_error_event_bytes, anthropic_to_openai_request, estimate_tokens,
    openai_to_anthropic_response,
};
use crate::features::gateway::interception::{
    BodyError, MAX_INTERCEPT_DEPTH, StreamTurn, assembled_to_tool_call, assistant_tool_message,
    attach_search_results, log_request, log_stream_success, observe_usage, read_json_body,
    run_buffered_interception, stream_log_status, unresolved_provider_id,
};
use crate::features::gateway::interceptor::should_intercept_tool_call;
use crate::features::gateway::model::{ChatCompletionRequest, ToolCall};
use crate::features::gateway::token_saver::apply_to_request;
use crate::features::gateway::usage::UsageBreakdown;
use crate::features::gateway::{ReceiverStream, RequestLogContext};
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

    let body = match read_json_body(request).await {
        Ok(body) => body,
        Err(error) => return anthropic_body_error(error),
    };

    if body.get("model").is_none() {
        return anthropic_error(400, constants::gateway::MODEL_REQUIRED);
    }
    if body.get("messages").is_none() {
        return anthropic_error(400, constants::gateway::MESSAGES_REQUIRED);
    }

    let anthropic_req: AnthropicMessageRequest = match serde_json::from_value(body) {
        Ok(req) => req,
        Err(err) => return anthropic_error(400, constants::gateway::invalid_request_body(&err)),
    };

    if anthropic_req.messages.is_empty() {
        return anthropic_error(400, constants::gateway::MESSAGES_EMPTY);
    }

    // Enforce model allowlist for this API key, against every name the requested
    // model answers to.
    let api_key = principal.as_ref().and_then(|ext| ext.0.api_key.as_ref());
    if let Err(err) = ensure_model_allowed_any(
        api_key,
        &state.providers.model_id_variants(&anthropic_req.model),
    ) {
        return anthropic_error(403, err.message());
    }

    let is_thinking_enabled = match &anthropic_req.thinking {
        Some(AnthropicThinking::Disabled) => false,
        Some(AnthropicThinking::Enabled { .. }) => true,
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
    let body = match read_json_body(request).await {
        Ok(body) => body,
        Err(error) => return anthropic_body_error(error),
    };

    if body.get("model").is_none() {
        return anthropic_error(400, constants::gateway::MODEL_REQUIRED);
    }
    if body.get("messages").is_none() {
        return anthropic_error(400, constants::gateway::MESSAGES_REQUIRED);
    }

    let anthropic_req: AnthropicMessageRequest = match serde_json::from_value(body) {
        Ok(req) => req,
        Err(err) => return anthropic_error(400, constants::gateway::invalid_request_body(&err)),
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

/// Maps a body failure onto the Anthropic error envelope; the chat routes map
/// the same failure onto the OpenAI envelope instead.
fn anthropic_body_error(error: BodyError) -> Response {
    match error {
        BodyError::TooLarge => anthropic_error(413, constants::json::TOO_LARGE),
        BodyError::Empty => anthropic_error(400, constants::json::EMPTY_BODY),
        BodyError::Malformed => anthropic_error(400, constants::json::MALFORMED_VERIFY),
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
                    .send(Ok(anthropic_error_event_bytes("not_found_error", &message)))
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
                        "api_error",
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
        let mut line_buffer = String::new();
        let mut turn = StreamTurn::default();
        let mut streamed_directly = false;

        while let Some(bytes) = stream.next().await {
            let Ok(text) = std::str::from_utf8(&bytes) else {
                continue;
            };
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

    builder
        .body(Body::from_stream(events))
        .unwrap_or_else(|_| anthropic_error(500, constants::gateway::COULD_NOT_BUILD_STREAM))
}
