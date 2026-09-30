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

use crate::constants;
use crate::error::{APIError, invalid_json};
use crate::features::api_keys::{APIPrincipal, ensure_model_allowed_any};
use crate::features::gateway::interceptor::{
    execute_intercepted_search, should_intercept_tool_call,
};
use crate::features::gateway::model::{
    ChatCompletionRequest, ChatContent, ChatMessage, ChatRole, ToolCall, ToolCallFunction,
    ToolCallKind, parse_chat_completion_request,
};
use crate::features::gateway::sse;
use crate::features::gateway::usage::{UsageBreakdown, normalize_response_usage};
use crate::http::middleware::client_address::client_address;
use crate::infrastructure::database::request_logs::{
    RequestLogInput, generate_log_id, insert_request_log,
};
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
    let start_time = crate::clock::now_ms();
    let version = request.version();
    let request_id = generate_log_id()?;
    let method = request.method().as_str().to_owned();
    let path = request
        .extensions()
        .get::<axum::extract::OriginalUri>()
        .map(|axum::extract::OriginalUri(uri)| uri.path().to_owned())
        .unwrap_or_else(|| request.uri().path().to_owned());
    let client_ip = client_address(request.extensions());
    let user_agent = request
        .headers()
        .get(header::USER_AGENT)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.to_owned());
    let api_key_id = principal
        .as_ref()
        .and_then(|ext| ext.0.api_key.as_ref().map(|key| key.id.clone()));

    let body = read_json_body(request).await?;
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

    if chat_request.stream {
        return stream_completion(state, chat_request, version);
    }

    let resolved = state
        .providers
        .resolve(&chat_request.model)
        .ok_or_else(|| unregistered_model(&chat_request.model))?;

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
                    let latency_ms = crate::clock::now_ms() - start_time;
                    let _ = insert_request_log(
                        db,
                        RequestLogInput {
                            request_id: &request_id,
                            method: &method,
                            path: &path,
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
                            error_code: None,
                            error_message: Some(err.message()),
                            created_at: crate::clock::now_ms(),
                        },
                    )
                    .await;
                }
                return Err(err);
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
        let latency_ms = crate::clock::now_ms() - start_time;
        let _ = insert_request_log(
            db,
            RequestLogInput {
                request_id: &request_id,
                method: &method,
                path: &path,
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
                error_code: None,
                error_message: None,
                created_at: crate::clock::now_ms(),
            },
        )
        .await;
    }

    Ok(Json(final_response).into_response())
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
        && length > MAX_BODY_BYTES as u64
    {
        return Err(body_too_large());
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
    APIError::new(413, constants::json::TOO_LARGE).with_code(constants::code::REQUEST_TOO_LARGE)
}

fn invalid_json_empty() -> APIError {
    APIError::new(400, constants::json::EMPTY_BODY).with_code(constants::code::INVALID_JSON)
}

fn unregistered_model(model: &str) -> APIError {
    APIError::new(404, constants::gateway::model_not_registered(model))
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

/// Runs the streaming completion with server-side tool interception support.
/// If the model emits tool calls (such as search) that the client did not define,
/// the gateway buffers the stream, performs the search in parallel, and opens
/// a follow-up stream with the tool results. If no interceptable tool calls exist,
/// the buffered chunks are yielded directly to the client.
async fn run_streaming_interception_loop(
    state: AppState,
    mut chat_request: ChatCompletionRequest,
    tx: tokio::sync::mpsc::Sender<Result<Bytes, Infallible>>,
) {
    const MAX_INTERCEPT_DEPTH: usize = 3;
    let mut current_depth = 0;

    while current_depth <= MAX_INTERCEPT_DEPTH {
        let resolved = match state.providers.resolve(&chat_request.model) {
            Some(res) => res,
            None => {
                let err = unregistered_model(&chat_request.model);
                let _ = tx.send(Ok(sse::error_event_bytes(&err))).await;
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
                let _ = tx.send(Ok(sse::error_event_bytes(&err))).await;
                return;
            }
        };

        let mut buffered_bytes: Vec<Bytes> = Vec::new();
        let mut line_buffer = String::new();
        let mut is_tool_call_turn = false;
        let mut assembled_tool_calls: std::collections::BTreeMap<usize, AssembledToolCall> =
            std::collections::BTreeMap::new();
        let mut assistant_content = String::new();
        let mut streamed_directly = false;

        while let Some(bytes) = stream.next().await {
            if streamed_directly {
                if tx.send(Ok(bytes)).await.is_err() {
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

                    if let Some(data_str) = line.strip_prefix("data:") {
                        let data_str = data_str.trim();
                        if data_str.is_empty() || data_str == "[DONE]" {
                            continue;
                        }

                        if let Ok(json) = serde_json::from_str::<Value>(data_str)
                            && let Some(choice) = json.get("choices").and_then(|c| c.get(0))
                            && let Some(delta) = choice.get("delta")
                        {
                            if let Some(tc_array) =
                                delta.get("tool_calls").and_then(|t| t.as_array())
                                && !tc_array.is_empty()
                            {
                                is_tool_call_turn = true;
                                for item in tc_array {
                                    let idx =
                                        item.get("index").and_then(|v| v.as_u64()).unwrap_or(0)
                                            as usize;
                                    let entry = assembled_tool_calls.entry(idx).or_default();
                                    if let Some(id) = item.get("id").and_then(|v| v.as_str()) {
                                        entry.id = id.to_owned();
                                    }
                                    if let Some(fn_obj) = item.get("function") {
                                        if let Some(name) =
                                            fn_obj.get("name").and_then(|v| v.as_str())
                                        {
                                            entry.name = name.to_owned();
                                        }
                                        if let Some(args) =
                                            fn_obj.get("arguments").and_then(|v| v.as_str())
                                        {
                                            entry.arguments.push_str(args);
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
                                for b in buffered_bytes.drain(..) {
                                    if tx.send(Ok(b)).await.is_err() {
                                        return;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        if streamed_directly {
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

        for b in buffered_bytes {
            if tx.send(Ok(b)).await.is_err() {
                return;
            }
        }
        return;
    }
}

/// Opens the SSE response first and performs model resolution plus the
/// upstream call inside the stream, with server-side tool interception support.
fn stream_completion(
    state: AppState,
    chat_request: ChatCompletionRequest,
    version: Version,
) -> Result<Response, APIError> {
    let (tx, rx) = tokio::sync::mpsc::channel::<Result<Bytes, Infallible>>(64);

    tokio::spawn(async move {
        run_streaming_interception_loop(state, chat_request, tx).await;
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
