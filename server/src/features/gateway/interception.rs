//! Shared gateway plumbing for the OpenAI chat and Anthropic messages routes.
//!
//! Both routes read and classify the request body, log their request rows, and
//! drive the same server-side tool-interception machine: a buffered path
//! (`run_buffered_interception`) and a streaming path whose SSE deltas are
//! accumulated by [`StreamTurn`]. The route handlers supply only their own wire
//! shape (error envelope, response rendering).

use std::collections::BTreeMap;

use axum::body::to_bytes;
use axum::extract::Request;
use axum::http::header;
use serde_json::Value;

use crate::clock;
use crate::constants;
use crate::error::{APIError, invalid_json};
use crate::features::gateway::interceptor::{
    execute_intercepted_search, should_intercept_tool_call,
};
use crate::features::gateway::model::{
    ChatCompletionRequest, ChatContent, ChatMessage, ChatRole, ToolCall, ToolCallFunction,
    ToolCallKind,
};
use crate::features::gateway::usage::{UsageBreakdown, normalize_response_usage};
use crate::features::gateway::{AssembledToolCall, RequestLogContext};
use crate::features::providers::ResolvedModel;
use crate::http::middleware::body_limit::MAX_BODY_BYTES;
use crate::infrastructure::database::request_logs::{RequestLogInput, insert_request_log};
use crate::state::AppState;

/// How the request body failed before any handler logic ran. Each route maps
/// this onto its own error envelope.
#[derive(Debug)]
pub(crate) enum BodyError {
    TooLarge,
    Empty,
    Malformed,
}

/// Reads a JSON request body, classifying the three failures the contract
/// distinguishes. The size cap also covers a chunked body that lies about its
/// length; `MAX_BODY_BYTES` is shared with the global body-limit middleware.
pub(crate) async fn read_json_body(request: Request) -> Result<Value, BodyError> {
    if let Some(length) = request
        .headers()
        .get(header::CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.trim().parse::<u64>().ok())
        && length > MAX_BODY_BYTES
    {
        return Err(BodyError::TooLarge);
    }

    let bytes = to_bytes(request.into_body(), MAX_BODY_BYTES as usize)
        .await
        .map_err(|_| BodyError::TooLarge)?;

    let text = std::str::from_utf8(&bytes).map_err(|_| BodyError::Malformed)?;
    if text.trim().is_empty() {
        return Err(BodyError::Empty);
    }

    serde_json::from_str(text).map_err(|_| BodyError::Malformed)
}

/// Maps a body failure onto the OpenAI envelope used by the chat routes.
pub(crate) fn body_error_to_api_error(error: BodyError) -> APIError {
    match error {
        BodyError::TooLarge => APIError::new(413, constants::json::TOO_LARGE)
            .with_code(constants::code::REQUEST_TOO_LARGE),
        BodyError::Empty => {
            APIError::new(400, constants::json::EMPTY_BODY).with_code(constants::code::INVALID_JSON)
        }
        BodyError::Malformed => invalid_json(),
    }
}

/// Writes one request-log row from a [`RequestLogContext`]. A process without a
/// database logs nothing.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn log_request(
    state: &AppState,
    context: &RequestLogContext,
    provider_id: &str,
    model: &str,
    resolved_model: Option<&str>,
    status_code: u16,
    usage: &UsageBreakdown,
    error_message: Option<&str>,
) {
    if let Some(db) = &state.database {
        let _ = insert_request_log(
            db,
            RequestLogInput {
                request_id: &context.request_id,
                method: &context.method,
                path: &context.path,
                api_key_id: context.api_key_id.as_deref(),
                ip_address: context.client_ip.as_deref(),
                user_agent: context.user_agent.as_deref(),
                provider_id,
                model,
                status_code,
                latency_ms: clock::now_ms() - context.start_time,
                usage,
                estimated_cost: 0.0,
                fallback_occurred: false,
                fallback_path: None,
                fallback_reason: error_message,
                resolved_model,
                error_code: None,
                error_message,
                created_at: clock::now_ms(),
            },
        )
        .await;
    }

    apply_usage_accounting(state, context, status_code, usage).await;
}

/// Settles or releases the API-key token budget reserved at chat admission
/// (Node's `settleAPIKeyQuotaDB` / `releaseAPIKeyQuotaDB`). A completed request
/// settles to the real token count and records the cost separately; every other
/// outcome releases the reservation in full. Best-effort like the request log:
/// an accounting failure never changes the response.
///
/// Node skips a successful response with `total_tokens == 0`, which leaves the
/// whole reservation charged; here that case settles to zero so the budget is
/// returned (recorded deviation).
async fn apply_usage_accounting(
    state: &AppState,
    context: &RequestLogContext,
    status_code: u16,
    usage: &UsageBreakdown,
) {
    let (Some(api_key_id), Some(reserved)) =
        (context.api_key_id.as_deref(), context.reserved_tokens)
    else {
        return;
    };
    let repository = &state.security.key_repository;

    if status_code == 200 {
        let _ = repository
            .settle_quota(api_key_id, reserved, usage.total_tokens)
            .await;
        // Pricing is not ported yet, so the recorded cost is always zero; the
        // call keeps the column accounting path in place for when it lands.
        let _ = repository.increment_usage(api_key_id, 0, 0.0).await;
    } else {
        let _ = repository.settle_quota(api_key_id, reserved, 0).await;
    }
}

/// Logs a successful streamed request with the running usage total.
pub(crate) async fn log_stream_success(
    state: &AppState,
    context: &RequestLogContext,
    resolved: &ResolvedModel,
    model: &str,
    usage: &UsageBreakdown,
) {
    log_request(
        state,
        context,
        resolved.adapter.id(),
        model,
        Some(&resolved.model),
        200,
        usage,
        None,
    )
    .await;
}

/// The provider id to blame when a model cannot be resolved: its prefix, or
/// `default` for a bare id.
pub(crate) fn unresolved_provider_id(model: &str) -> &str {
    model
        .split_once('/')
        .map_or("default", |(provider, _)| provider)
}

/// Recovers the HTTP status from an upstream error message
/// (`... Error (503) ...`) so a streamed failure logs its real status.
pub(crate) fn stream_log_status(message: &str, fallback: u16) -> u16 {
    message
        .split_once(" Error (")
        .and_then(|(_, status)| status.split_once(')'))
        .and_then(|(status, _)| status.parse().ok())
        .unwrap_or(fallback)
}

fn add_usage(total: &mut UsageBreakdown, usage: &UsageBreakdown) {
    total.prompt_tokens += usage.prompt_tokens;
    total.completion_tokens += usage.completion_tokens;
    total.total_tokens += usage.total_tokens;
    total.cached_tokens += usage.cached_tokens;
    total.cache_creation_tokens += usage.cache_creation_tokens;
    total.reasoning_tokens += usage.reasoning_tokens;
}

/// Folds one SSE chunk's `usage` object into the running stream total.
pub(crate) fn observe_usage(json: &Value, total: &mut UsageBreakdown) {
    if let Some(usage) = json.get("usage").filter(|usage| usage.is_object()) {
        add_usage(total, &UsageBreakdown::from_value(usage));
    }
}

/// True when the delta carries non-empty text or reasoning content. Reasoning
/// arrives under one of several provider-specific keys.
fn delta_has_text(delta: &Value) -> bool {
    ["content", "reasoning_content", "reasoning", "thought"]
        .iter()
        .any(|key| {
            delta
                .get(*key)
                .and_then(|value| value.as_str())
                .is_some_and(|text| !text.is_empty())
        })
}

/// Builds the assistant turn that carries tool calls. `content` is `Null` for a
/// turn that only emitted calls.
pub(crate) fn assistant_tool_message(
    content: ChatContent,
    tool_calls: Vec<ToolCall>,
) -> ChatMessage {
    ChatMessage {
        role: ChatRole::Assistant,
        content,
        name: None,
        tool_calls: Some(tool_calls),
        tool_call_id: None,
        cache_control: None,
    }
}

/// Converts an accumulated stream delta into a tool call, minting an id when the
/// upstream never supplied one.
pub(crate) fn assembled_to_tool_call(call: &AssembledToolCall) -> ToolCall {
    ToolCall {
        id: if call.id.is_empty() {
            format!("call_search_{}", clock::now_ms())
        } else {
            call.id.clone()
        },
        kind: ToolCallKind::Function,
        function: ToolCallFunction {
            name: call.name.clone(),
            arguments: call.arguments.clone(),
        },
    }
}

/// Runs the intercepted searches in parallel and appends one `tool` message per
/// result to the request, ready for the follow-up turn.
pub(crate) async fn attach_search_results(
    state: &AppState,
    request: &mut ChatCompletionRequest,
    tool_calls: Vec<ToolCall>,
) {
    let searches = tool_calls.into_iter().map(|tc| {
        let search = state.search.clone();
        async move {
            let (id, result) =
                execute_intercepted_search(&search, &tc.id, &tc.function.arguments).await;
            (id, tc.function.name, result)
        }
    });

    for (tool_call_id, tool_name, search_result) in futures_util::future::join_all(searches).await {
        request.messages.push(ChatMessage {
            role: ChatRole::Tool,
            content: ChatContent::Text(serde_json::to_string(&search_result).unwrap_or_default()),
            name: Some(tool_name),
            tool_calls: None,
            tool_call_id: Some(tool_call_id),
            cache_control: None,
        });
    }
}

/// Accumulates tool calls and text across streamed deltas for one upstream turn.
#[derive(Default)]
pub(crate) struct StreamTurn {
    tool_calls: BTreeMap<usize, AssembledToolCall>,
    assistant_content: String,
    is_tool_call_turn: bool,
}

impl StreamTurn {
    /// Folds one parsed chunk into the turn. Returns `true` when a non-empty text
    /// or reasoning delta arrived and no tool call has been seen, which is the
    /// signal to stop buffering and stream straight through.
    pub(crate) fn observe_delta(&mut self, json: &Value) -> bool {
        let Some(delta) = json
            .get("choices")
            .and_then(|choices| choices.get(0))
            .and_then(|choice| choice.get("delta"))
        else {
            return false;
        };

        if let Some(tool_calls) = delta.get("tool_calls").and_then(|value| value.as_array())
            && !tool_calls.is_empty()
        {
            self.is_tool_call_turn = true;
            for item in tool_calls {
                let index = item
                    .get("index")
                    .and_then(|value| value.as_u64())
                    .unwrap_or(0) as usize;
                let entry = self.tool_calls.entry(index).or_default();
                if let Some(id) = item.get("id").and_then(|value| value.as_str()) {
                    entry.id = id.to_owned();
                }
                if let Some(function) = item.get("function") {
                    if let Some(name) = function.get("name").and_then(|value| value.as_str()) {
                        entry.name = name.to_owned();
                    }
                    if let Some(arguments) =
                        function.get("arguments").and_then(|value| value.as_str())
                    {
                        entry.arguments.push_str(arguments);
                    }
                }
            }
        }

        let has_text = delta_has_text(delta);
        if let Some(content) = delta.get("content").and_then(|value| value.as_str()) {
            self.assistant_content.push_str(content);
        }

        !self.is_tool_call_turn && has_text
    }

    /// The assistant content accumulated so far, or `Null` when the turn only
    /// emitted tool calls.
    pub(crate) fn content(&self) -> ChatContent {
        if self.assistant_content.is_empty() {
            ChatContent::Null
        } else {
            ChatContent::Text(self.assistant_content.clone())
        }
    }

    /// The accumulated tool calls in upstream order.
    pub(crate) fn assembled(&self) -> Vec<AssembledToolCall> {
        self.tool_calls.values().cloned().collect()
    }
}

pub(crate) const MAX_INTERCEPT_DEPTH: usize = 3;

/// Runs the buffered (non-streaming) completion, intercepting server-side tool
/// calls up to [`MAX_INTERCEPT_DEPTH`] times and re-asking with the results
/// appended. Every upstream call and the final response are logged. Returns the
/// final OpenAI-shaped response body unchanged from the last successful turn.
pub(crate) async fn run_buffered_interception(
    state: &AppState,
    resolved: &ResolvedModel,
    request: ChatCompletionRequest,
    context: &RequestLogContext,
) -> Result<Value, APIError> {
    let mut current_request = request;
    let mut current_depth = 0;
    let mut accumulated_usage = UsageBreakdown::default();
    let mut final_response;

    loop {
        let response = match resolved
            .adapter
            .chat_completion(&resolved.model, &current_request)
            .await
        {
            Ok(response) => response,
            Err(error) => {
                log_request(
                    state,
                    context,
                    resolved.adapter.id(),
                    &current_request.model,
                    Some(&resolved.model),
                    error.status(),
                    &accumulated_usage,
                    Some(error.message()),
                )
                .await;
                return Err(error);
            }
        };

        let turn_usage = response
            .get("usage")
            .map(UsageBreakdown::from_value)
            .unwrap_or_default();
        add_usage(&mut accumulated_usage, &turn_usage);

        let choice = response.get("choices").and_then(|choices| choices.get(0));
        let tool_calls: Vec<ToolCall> = choice
            .and_then(|choice| choice.get("message"))
            .and_then(|message| message.get("tool_calls"))
            .and_then(|value| serde_json::from_value(value.clone()).ok())
            .unwrap_or_default();

        let interceptable: Vec<ToolCall> = tool_calls
            .iter()
            .filter(|call| {
                should_intercept_tool_call(&call.function.name, current_request.tools.as_deref())
            })
            .cloned()
            .collect();

        if current_depth < MAX_INTERCEPT_DEPTH && !interceptable.is_empty() {
            let content = match choice
                .and_then(|choice| choice.get("message"))
                .and_then(|message| message.get("content"))
                .and_then(|value| value.as_str())
            {
                Some(text) => ChatContent::Text(text.to_owned()),
                None => ChatContent::Null,
            };

            current_request
                .messages
                .push(assistant_tool_message(content, tool_calls));

            attach_search_results(state, &mut current_request, interceptable).await;

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

    log_request(
        state,
        context,
        resolved.adapter.id(),
        &current_request.model,
        Some(&resolved.model),
        200,
        &breakdown,
        None,
    )
    .await;

    Ok(final_response)
}

#[cfg(test)]
mod tests {
    use axum::body::Body;
    use serde_json::json;

    use super::*;

    fn body_request(body: Body) -> Request {
        Request::builder()
            .method("POST")
            .uri("/v1/chat/completions")
            .body(body)
            .expect("request builds")
    }

    #[tokio::test]
    async fn a_content_length_over_the_cap_is_rejected_before_reading_the_body() {
        let request = Request::builder()
            .method("POST")
            .uri("/v1/chat/completions")
            .header(header::CONTENT_LENGTH, (MAX_BODY_BYTES + 1).to_string())
            .body(Body::from("{}"))
            .expect("request builds");

        let error = read_json_body(request)
            .await
            .expect_err("header exceeds the cap");
        assert!(matches!(error, BodyError::TooLarge));
    }

    #[tokio::test]
    async fn a_body_over_the_cap_is_rejected_even_without_a_content_length() {
        let oversize = Body::from(vec![b' '; MAX_BODY_BYTES as usize + 1]);

        let error = read_json_body(body_request(oversize))
            .await
            .expect_err("body exceeds the cap");
        assert!(matches!(error, BodyError::TooLarge));
    }

    #[tokio::test]
    async fn blank_bodies_are_rejected_as_empty() {
        for raw in ["", "  \n\t"] {
            let error = read_json_body(body_request(Body::from(raw)))
                .await
                .expect_err("blank body");
            assert!(matches!(error, BodyError::Empty), "for {raw:?}");
        }
    }

    #[tokio::test]
    async fn invalid_utf8_and_invalid_json_are_rejected_as_malformed() {
        let error = read_json_body(body_request(Body::from(vec![0xff, 0xfe])))
            .await
            .expect_err("invalid utf8");
        assert!(matches!(error, BodyError::Malformed));

        let error = read_json_body(body_request(Body::from("{not json")))
            .await
            .expect_err("invalid json");
        assert!(matches!(error, BodyError::Malformed));
    }

    #[tokio::test]
    async fn a_valid_json_body_parses_to_its_value() {
        let value = read_json_body(body_request(Body::from(r#"{"model":"mimo"}"#)))
            .await
            .expect("valid json parses");

        assert_eq!(value["model"], "mimo");
    }

    #[test]
    fn body_failures_map_to_their_frozen_envelopes() {
        let too_large = body_error_to_api_error(BodyError::TooLarge);
        assert_eq!(too_large.status(), 413);
        assert_eq!(too_large.message(), constants::json::TOO_LARGE);
        assert_eq!(
            too_large.to_envelope().error.code.as_deref(),
            Some(constants::code::REQUEST_TOO_LARGE)
        );

        let empty = body_error_to_api_error(BodyError::Empty);
        assert_eq!(empty.status(), 400);
        assert_eq!(empty.message(), constants::json::EMPTY_BODY);
        assert_eq!(
            empty.to_envelope().error.code.as_deref(),
            Some(constants::code::INVALID_JSON)
        );

        assert_eq!(
            body_error_to_api_error(BodyError::Malformed),
            invalid_json()
        );
    }

    #[test]
    fn stream_status_is_recovered_from_the_upstream_error_message() {
        assert_eq!(
            stream_log_status("OpenAI Provider Error (503): upstream down", 200),
            503
        );
        assert_eq!(
            stream_log_status("OpenAI Provider Stream Error (429): slow down", 200),
            429
        );
        assert_eq!(stream_log_status("connection reset by peer", 200), 200);
    }

    #[test]
    fn unresolved_provider_id_uses_the_prefix_or_defaults() {
        assert_eq!(unresolved_provider_id("qd/qfmodel"), "qd");
        assert_eq!(unresolved_provider_id("mimo-v2-flash"), "default");
    }

    #[test]
    fn text_deltas_cover_content_and_every_reasoning_alias() {
        assert!(delta_has_text(&json!({"content": "hi"})));
        assert!(delta_has_text(&json!({"reasoning_content": "hi"})));
        assert!(delta_has_text(&json!({"reasoning": "hi"})));
        assert!(delta_has_text(&json!({"thought": "hi"})));
        assert!(!delta_has_text(&json!({"content": ""})));
        assert!(!delta_has_text(&json!({"role": "assistant"})));
    }

    #[test]
    fn a_tool_call_turn_suppresses_direct_streaming() {
        let mut turn = StreamTurn::default();
        let tool_delta = json!({"choices":[{"delta":{"tool_calls":[
            {"index":0,"id":"call_1","function":{"name":"web_search","arguments":"{\"q\":"}}
        ]}}]});
        assert!(!turn.observe_delta(&tool_delta));

        // Text after a tool call stays buffered for the interception path.
        let text_delta = json!({"choices":[{"delta":{"content":"searching"}}]});
        assert!(!turn.observe_delta(&text_delta));
        assert_eq!(turn.content(), ChatContent::Text("searching".to_owned()));
    }

    #[test]
    fn a_text_delta_before_any_tool_call_signals_direct_streaming() {
        let mut turn = StreamTurn::default();
        let delta = json!({"choices":[{"delta":{"content":"Hi"}}]});

        assert!(turn.observe_delta(&delta));
        assert_eq!(turn.content(), ChatContent::Text("Hi".to_owned()));
    }

    #[test]
    fn tool_calls_accumulate_by_index_in_upstream_order() {
        let mut turn = StreamTurn::default();

        // Index 1 arrives before index 0: assembly must still emit index order.
        let second_call = json!({"choices":[{"delta":{"tool_calls":[
            {"index":1,"id":"call_2","function":{"name":"fetch","arguments":"{}"}}
        ]}}]});
        assert!(!turn.observe_delta(&second_call));

        let first_call = json!({"choices":[{"delta":{"tool_calls":[
            {"index":0,"id":"call_1","function":{"name":"web_search","arguments":"{\"q\":"}}
        ]}}]});
        assert!(!turn.observe_delta(&first_call));

        // Arguments split across deltas append instead of overwrite.
        let continued = json!({"choices":[{"delta":{"tool_calls":[
            {"index":0,"function":{"arguments":"\"rust\"}"}}
        ]}}]});
        assert!(!turn.observe_delta(&continued));

        let calls = turn.assembled();
        assert_eq!(calls.len(), 2);
        assert_eq!(calls[0].id, "call_1");
        assert_eq!(calls[0].name, "web_search");
        assert_eq!(calls[0].arguments, "{\"q\":\"rust\"}");
        assert_eq!(calls[1].id, "call_2");
        assert_eq!(calls[1].name, "fetch");

        // A turn that only emitted calls carries null content.
        assert_eq!(turn.content(), ChatContent::Null);
    }

    #[test]
    fn a_missing_tool_call_id_is_minted_for_the_interception_round_trip() {
        let minted = assembled_to_tool_call(&AssembledToolCall::default());
        assert!(minted.id.starts_with("call_search_"));
        assert_eq!(minted.kind, ToolCallKind::Function);

        let named = AssembledToolCall {
            id: "call_7".to_owned(),
            name: "web_search".to_owned(),
            arguments: "{\"q\":\"rust\"}".to_owned(),
        };
        let call = assembled_to_tool_call(&named);
        assert_eq!(call.id, "call_7");
        assert_eq!(call.function.name, "web_search");
        assert_eq!(call.function.arguments, "{\"q\":\"rust\"}");
    }

    #[test]
    fn the_assistant_turn_carries_content_and_tool_calls() {
        let message = assistant_tool_message(ChatContent::Null, Vec::new());

        assert_eq!(message.role, ChatRole::Assistant);
        assert_eq!(message.content, ChatContent::Null);
        assert_eq!(message.tool_calls, Some(Vec::new()));
    }

    #[test]
    fn usage_objects_fold_into_the_running_total() {
        let mut total = UsageBreakdown::default();

        observe_usage(
            &json!({"usage":{"prompt_tokens":3,"completion_tokens":5}}),
            &mut total,
        );
        assert_eq!(
            (
                total.prompt_tokens,
                total.completion_tokens,
                total.total_tokens
            ),
            (3, 5, 8)
        );

        // A later frame adds to the running total.
        observe_usage(
            &json!({"usage":{"prompt_tokens":2,"completion_tokens":1,"total_tokens":3}}),
            &mut total,
        );
        assert_eq!(
            (
                total.prompt_tokens,
                total.completion_tokens,
                total.total_tokens
            ),
            (5, 6, 11)
        );

        // Non-object usage and absent usage are ignored.
        observe_usage(&json!({"usage":"not an object"}), &mut total);
        observe_usage(&json!({}), &mut total);
        assert_eq!(
            (
                total.prompt_tokens,
                total.completion_tokens,
                total.total_tokens
            ),
            (5, 6, 11)
        );
    }
}
