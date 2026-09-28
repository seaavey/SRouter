//! Anthropic Messages API routes (`/v1/messages` and `/v1/messages/count_tokens`).
//!
//! Handles Anthropic-formatted chat completion and token counting requests,
//! translating them onto SRouter's internal provider network and streaming back
//! Anthropic SSE events or JSON responses.

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

use crate::features::api_keys::{APIPrincipal, ensure_model_allowed};
use crate::features::gateway::anthropic::{
    AnthropicMessageRequest, AnthropicStreamTranslator, AnthropicThinking, anthropic_error,
    anthropic_error_event_bytes, anthropic_to_openai_request, estimate_tokens,
    openai_to_anthropic_response,
};
use crate::features::gateway::interceptor::{
    execute_intercepted_search, should_intercept_tool_call,
};
use crate::features::gateway::model::{
    ChatCompletionRequest, ChatContent, ChatMessage, ChatRole, ToolCall, ToolCallFunction,
    ToolCallKind,
};
use crate::features::gateway::usage::{UsageBreakdown, normalize_response_usage};
use crate::http::middleware::client_address::client_address;
use crate::infrastructure::database::request_logs::{RequestLogInput, insert_request_log};
use crate::state::AppState;

const MAX_BODY_BYTES: usize = 25 * 1024 * 1024;

/// Handles `POST /v1/messages`.
pub async fn create_message(
    State(state): State<AppState>,
    principal: Option<Extension<APIPrincipal>>,
    request: Request,
) -> Response {
    let start_time = crate::clock::now_ms();
    let version = request.version();
    let client_ip = client_address(request.extensions());
    let user_agent = request
        .headers()
        .get(header::USER_AGENT)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.to_owned());
    let api_key_id = principal
        .as_ref()
        .and_then(|ext| ext.0.api_key.as_ref().map(|key| key.id.clone()));

    let body = match read_json_body(request).await {
        Ok(b) => b,
        Err(err_response) => return err_response,
    };

    if body.get("model").is_none() {
        return anthropic_error(400, "Missing required parameter 'model'");
    }
    if body.get("messages").is_none() {
        return anthropic_error(400, "Missing required parameter 'messages'");
    }

    let anthropic_req: AnthropicMessageRequest = match serde_json::from_value(body) {
        Ok(req) => req,
        Err(err) => return anthropic_error(400, format!("Invalid request body: {err}")),
    };

    if anthropic_req.messages.is_empty() {
        return anthropic_error(400, "messages: at least 1 message is required");
    }

    // Enforce model allowlist for this API key.
    let api_key = principal.as_ref().and_then(|ext| ext.0.api_key.as_ref());
    if let Err(err) = ensure_model_allowed(api_key, &anthropic_req.model) {
        return anthropic_error(403, err.message());
    }

    let is_thinking_enabled = match &anthropic_req.thinking {
        Some(AnthropicThinking::Disabled) => false,
        Some(AnthropicThinking::Enabled { .. }) => true,
        None => false,
    };

    let original_model = anthropic_req.model.clone();
    let stream = anthropic_req.stream;
    let chat_request = anthropic_to_openai_request(anthropic_req);

    if stream {
        return stream_anthropic_message(
            state,
            original_model,
            chat_request,
            version,
            is_thinking_enabled,
        );
    }

    let resolved = match state.providers.resolve(&chat_request.model) {
        Some(r) => r,
        None => {
            return anthropic_error(
                404,
                format!("No provider is registered for model '{original_model}'"),
            );
        }
    };

    const MAX_INTERCEPT_DEPTH: usize = 3;
    let mut current_request = chat_request;
    let mut current_depth = 0;
    let mut accumulated_usage = UsageBreakdown::default();
    let mut final_response;

    loop {
        let response = match resolved
            .adapter
            .chat_completion(&resolved.model, &current_request)
            .await
        {
            Ok(res) => res,
            Err(err) => {
                if let Some(db) = &state.database {
                    let latency_ms = (crate::clock::now_ms() - start_time) as i64;
                    let _ = insert_request_log(
                        db,
                        RequestLogInput {
                            api_key_id: api_key_id.as_deref(),
                            ip_address: client_ip.as_deref(),
                            user_agent: user_agent.as_deref(),
                            provider_id: resolved.adapter.id(),
                            model: &current_request.model,
                            status_code: err.status(),
                            latency_ms,
                            usage: &accumulated_usage,
                            estimated_cost: 0.0,
                            fallback_occurred: false,
                            fallback_path: None,
                            fallback_reason: Some(err.message()),
                            resolved_model: Some(&resolved.model),
                            created_at: crate::clock::now_ms(),
                        },
                    )
                    .await;
                }
                return anthropic_error(err.status(), err.message());
            }
        };

        let turn_usage = match response.get("usage") {
            Some(u) => UsageBreakdown::from_value(u),
            None => UsageBreakdown::default(),
        };
        accumulated_usage.prompt_tokens += turn_usage.prompt_tokens;
        accumulated_usage.completion_tokens += turn_usage.completion_tokens;
        accumulated_usage.total_tokens += turn_usage.total_tokens;
        accumulated_usage.cached_tokens += turn_usage.cached_tokens;
        accumulated_usage.cache_creation_tokens += turn_usage.cache_creation_tokens;
        accumulated_usage.reasoning_tokens += turn_usage.reasoning_tokens;

        let choice = response.get("choices").and_then(|c| c.get(0));
        let tool_calls_val = choice
            .and_then(|c| c.get("message"))
            .and_then(|m| m.get("tool_calls"));

        let tool_calls: Vec<ToolCall> = tool_calls_val
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default();

        let has_interceptable_tool = current_depth < MAX_INTERCEPT_DEPTH
            && tool_calls.iter().any(|tc| {
                should_intercept_tool_call(&tc.function.name, current_request.tools.as_deref())
            });

        if has_interceptable_tool {
            let assistant_content = match choice
                .and_then(|c| c.get("message"))
                .and_then(|m| m.get("content"))
                .and_then(|v| v.as_str())
            {
                Some(text) => ChatContent::Text(text.to_owned()),
                None => ChatContent::Null,
            };

            let assistant_msg = ChatMessage {
                role: ChatRole::Assistant,
                content: assistant_content,
                name: None,
                tool_calls: Some(tool_calls.clone()),
                tool_call_id: None,
                cache_control: None,
            };

            current_request.messages.push(assistant_msg);

            let interceptable_calls: Vec<_> = tool_calls
                .into_iter()
                .filter(|tc| {
                    should_intercept_tool_call(&tc.function.name, current_request.tools.as_deref())
                })
                .collect();

            let search_futures = interceptable_calls.iter().map(|tc| {
                let search = state.search.clone();
                let tool_call_id = tc.id.clone();
                let tool_name = tc.function.name.clone();
                let arguments = tc.function.arguments.clone();
                async move {
                    let (id, result) =
                        execute_intercepted_search(&search, &tool_call_id, &arguments).await;
                    (id, tool_name, result)
                }
            });

            let search_results = futures_util::future::join_all(search_futures).await;

            for (tool_call_id, tool_name, search_result) in search_results {
                current_request.messages.push(ChatMessage {
                    role: ChatRole::Tool,
                    content: ChatContent::Text(
                        serde_json::to_string(&search_result).unwrap_or_default(),
                    ),
                    name: Some(tool_name),
                    tool_calls: None,
                    tool_call_id: Some(tool_call_id),
                    cache_control: None,
                });
            }

            current_depth += 1;
            continue;
        }

        final_response = response;
        break;
    }

    if accumulated_usage.total_tokens > 0 {
        final_response["usage"] = accumulated_usage.to_openai_json();
    }
    let breakdown = normalize_response_usage(&mut final_response);

    if let Some(db) = &state.database {
        let latency_ms = (crate::clock::now_ms() - start_time) as i64;
        let _ = insert_request_log(
            db,
            RequestLogInput {
                api_key_id: api_key_id.as_deref(),
                ip_address: client_ip.as_deref(),
                user_agent: user_agent.as_deref(),
                provider_id: resolved.adapter.id(),
                model: &current_request.model,
                status_code: 200,
                latency_ms,
                usage: &breakdown,
                estimated_cost: 0.0,
                fallback_occurred: false,
                fallback_path: None,
                fallback_reason: None,
                resolved_model: Some(&resolved.model),
                created_at: crate::clock::now_ms(),
            },
        )
        .await;
    }

    let anthropic_res =
        openai_to_anthropic_response(&final_response, &original_model, is_thinking_enabled);
    (StatusCode::OK, Json(anthropic_res)).into_response()
}

/// Handles `POST /v1/messages/count_tokens`.
pub async fn count_tokens(
    State(_state): State<AppState>,
    principal: Option<Extension<APIPrincipal>>,
    request: Request,
) -> Response {
    let body = match read_json_body(request).await {
        Ok(b) => b,
        Err(err_response) => return err_response,
    };

    if body.get("model").is_none() {
        return anthropic_error(400, "Missing required parameter 'model'");
    }
    if body.get("messages").is_none() {
        return anthropic_error(400, "Missing required parameter 'messages'");
    }

    let anthropic_req: AnthropicMessageRequest = match serde_json::from_value(body) {
        Ok(req) => req,
        Err(err) => return anthropic_error(400, format!("Invalid request body: {err}")),
    };

    let api_key = principal.as_ref().and_then(|ext| ext.0.api_key.as_ref());
    if let Err(err) = ensure_model_allowed(api_key, &anthropic_req.model) {
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

async fn read_json_body(request: Request) -> Result<Value, Response> {
    if let Some(length) = request
        .headers()
        .get(header::CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.trim().parse::<u64>().ok())
    {
        if length > MAX_BODY_BYTES as u64 {
            return Err(anthropic_error(413, "Request body too large"));
        }
    }

    let bytes = to_bytes(request.into_body(), MAX_BODY_BYTES)
        .await
        .map_err(|_| anthropic_error(413, "Request body too large"))?;

    let text = std::str::from_utf8(&bytes).map_err(|_| {
        anthropic_error(
            400,
            "Malformed JSON in request body. Please verify JSON syntax.",
        )
    })?;

    if text.trim().is_empty() {
        return Err(anthropic_error(
            400,
            "Request body cannot be empty. Valid JSON is required.",
        ));
    }

    serde_json::from_str(text).map_err(|_| {
        anthropic_error(
            400,
            "Malformed JSON in request body. Please verify JSON syntax.",
        )
    })
}

struct ReceiverStream<T>(tokio::sync::mpsc::Receiver<T>);

impl<T> Stream for ReceiverStream<T> {
    type Item = T;

    fn poll_next(
        mut self: Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<Option<Self::Item>> {
        self.0.poll_recv(cx)
    }
}

#[derive(Clone, Debug, Default)]
struct AssembledToolCall {
    id: String,
    name: String,
    arguments: String,
}

async fn run_anthropic_streaming_interception_loop(
    state: AppState,
    original_model: String,
    mut chat_request: ChatCompletionRequest,
    is_thinking_enabled: bool,
    tx: tokio::sync::mpsc::Sender<Result<Bytes, Infallible>>,
) {
    const MAX_INTERCEPT_DEPTH: usize = 3;
    let mut current_depth = 0;

    while current_depth <= MAX_INTERCEPT_DEPTH {
        let resolved = match state.providers.resolve(&chat_request.model) {
            Some(res) => res,
            None => {
                let err_msg = format!("No provider is registered for model '{original_model}'");
                let _ = tx
                    .send(Ok(anthropic_error_event_bytes("not_found_error", &err_msg)))
                    .await;
                return;
            }
        };

        let mut stream = match resolved
            .adapter
            .chat_completion_stream(&resolved.model, &chat_request)
            .await
        {
            Ok(s) => s,
            Err(err) => {
                let _ = tx
                    .send(Ok(anthropic_error_event_bytes("api_error", err.message())))
                    .await;
                return;
            }
        };

        let mut translator = AnthropicStreamTranslator::new(&original_model, is_thinking_enabled);
        let mut buffered_chunks: Vec<Value> = Vec::new();
        let mut line_buffer = String::new();
        let mut is_tool_call_turn = false;
        let mut assembled_tool_calls: std::collections::BTreeMap<usize, AssembledToolCall> =
            std::collections::BTreeMap::new();
        let mut assistant_content = String::new();
        let mut streamed_directly = false;

        while let Some(bytes) = stream.next().await {
            if let Ok(text) = std::str::from_utf8(&bytes) {
                line_buffer.push_str(text);

                while let Some(pos) = line_buffer.find('\n') {
                    let line = line_buffer[..pos].trim_end_matches('\r').to_owned();
                    line_buffer.drain(..=pos);

                    if let Some(data_str) = line.strip_prefix("data:") {
                        let data_str = data_str.trim();
                        if data_str.is_empty() || data_str == "[DONE]" {
                            continue;
                        }

                        if let Ok(json) = serde_json::from_str::<Value>(data_str) {
                            if streamed_directly {
                                let events = translator.feed_chunk(&json);
                                for ev in events {
                                    if tx.send(Ok(ev)).await.is_err() {
                                        return;
                                    }
                                }
                                continue;
                            }

                            buffered_chunks.push(json.clone());

                            if let Some(choice) = json.get("choices").and_then(|c| c.get(0)) {
                                if let Some(delta) = choice.get("delta") {
                                    if let Some(tc_array) =
                                        delta.get("tool_calls").and_then(|t| t.as_array())
                                    {
                                        if !tc_array.is_empty() {
                                            is_tool_call_turn = true;
                                            for item in tc_array {
                                                let idx = item
                                                    .get("index")
                                                    .and_then(|v| v.as_u64())
                                                    .unwrap_or(0)
                                                    as usize;
                                                let entry =
                                                    assembled_tool_calls.entry(idx).or_default();
                                                if let Some(id) =
                                                    item.get("id").and_then(|v| v.as_str())
                                                {
                                                    entry.id = id.to_owned();
                                                }
                                                if let Some(fn_obj) = item.get("function") {
                                                    if let Some(name) =
                                                        fn_obj.get("name").and_then(|v| v.as_str())
                                                    {
                                                        entry.name = name.to_owned();
                                                    }
                                                    if let Some(args) = fn_obj
                                                        .get("arguments")
                                                        .and_then(|v| v.as_str())
                                                    {
                                                        entry.arguments.push_str(args);
                                                    }
                                                }
                                            }
                                        }
                                    }

                                    let has_text_delta = delta
                                        .get("content")
                                        .and_then(|v| v.as_str())
                                        .is_some_and(|s| !s.is_empty())
                                        || delta
                                            .get("reasoning_content")
                                            .and_then(|v| v.as_str())
                                            .is_some_and(|s| !s.is_empty())
                                        || delta
                                            .get("reasoning")
                                            .and_then(|v| v.as_str())
                                            .is_some_and(|s| !s.is_empty())
                                        || delta
                                            .get("thought")
                                            .and_then(|v| v.as_str())
                                            .is_some_and(|s| !s.is_empty());

                                    if let Some(content_chunk) =
                                        delta.get("content").and_then(|v| v.as_str())
                                    {
                                        assistant_content.push_str(content_chunk);
                                    }

                                    if !is_tool_call_turn && has_text_delta {
                                        streamed_directly = true;
                                        for chunk in buffered_chunks.drain(..) {
                                            let events = translator.feed_chunk(&chunk);
                                            for ev in events {
                                                if tx.send(Ok(ev)).await.is_err() {
                                                    return;
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        if streamed_directly {
            let finish_events = translator.finish();
            for ev in finish_events {
                let _ = tx.send(Ok(ev)).await;
            }
            return;
        }

        let tool_calls_list: Vec<_> = assembled_tool_calls.into_values().collect();
        let interceptable: Vec<_> = tool_calls_list
            .iter()
            .filter(|tc| should_intercept_tool_call(&tc.name, chat_request.tools.as_deref()))
            .cloned()
            .collect();

        if !interceptable.is_empty() && current_depth < MAX_INTERCEPT_DEPTH {
            let assistant_msg = ChatMessage {
                role: ChatRole::Assistant,
                content: if assistant_content.is_empty() {
                    ChatContent::Null
                } else {
                    ChatContent::Text(assistant_content)
                },
                name: None,
                tool_calls: Some(
                    tool_calls_list
                        .iter()
                        .map(|tc| ToolCall {
                            id: if tc.id.is_empty() {
                                format!("call_search_{}", crate::clock::now_ms())
                            } else {
                                tc.id.clone()
                            },
                            kind: ToolCallKind::Function,
                            function: ToolCallFunction {
                                name: tc.name.clone(),
                                arguments: tc.arguments.clone(),
                            },
                        })
                        .collect(),
                ),
                tool_call_id: None,
                cache_control: None,
            };
            chat_request.messages.push(assistant_msg);

            let search_futures = interceptable.into_iter().map(|tc| {
                let search = state.search.clone();
                async move {
                    let id = if tc.id.is_empty() {
                        format!("call_search_{}", crate::clock::now_ms())
                    } else {
                        tc.id
                    };
                    let (tool_call_id, search_result) =
                        execute_intercepted_search(&search, &id, &tc.arguments).await;
                    (tool_call_id, tc.name, search_result)
                }
            });

            let search_results = futures_util::future::join_all(search_futures).await;

            for (tool_call_id, tool_name, search_result) in search_results {
                chat_request.messages.push(ChatMessage {
                    role: ChatRole::Tool,
                    content: ChatContent::Text(
                        serde_json::to_string(&search_result).unwrap_or_default(),
                    ),
                    name: Some(tool_name),
                    tool_calls: None,
                    tool_call_id: Some(tool_call_id),
                    cache_control: None,
                });
            }

            current_depth += 1;
            continue;
        }

        // Emit all buffered chunks through translator to client
        for chunk in buffered_chunks {
            let events = translator.feed_chunk(&chunk);
            for ev in events {
                if tx.send(Ok(ev)).await.is_err() {
                    return;
                }
            }
        }
        let finish_events = translator.finish();
        for ev in finish_events {
            let _ = tx.send(Ok(ev)).await;
        }
        return;
    }
}

fn stream_anthropic_message(
    state: AppState,
    original_model: String,
    chat_request: ChatCompletionRequest,
    version: Version,
    is_thinking_enabled: bool,
) -> Response {
    let (tx, rx) = tokio::sync::mpsc::channel::<Result<Bytes, Infallible>>(64);

    tokio::spawn(async move {
        run_anthropic_streaming_interception_loop(
            state,
            original_model,
            chat_request,
            is_thinking_enabled,
            tx,
        )
        .await;
    });

    let events = ReceiverStream(rx);

    let mut builder = Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "text/event-stream")
        .header(header::CACHE_CONTROL, "no-cache, no-transform")
        .header("x-accel-buffering", "no");

    if version == Version::HTTP_10 || version == Version::HTTP_11 {
        builder = builder.header(header::CONNECTION, "keep-alive");
    }

    builder
        .body(Body::from_stream(events))
        .unwrap_or_else(|_| anthropic_error(500, "Could not build the stream response"))
}
