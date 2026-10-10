//! The streaming tool-interception machine. SSE deltas accumulate into a
//! [`StreamTurn`]; `try_intercept` decides when the turn carries an
//! interceptable call and the depth budget remains, then runs the search and
//! reports that the caller should re-ask upstream with the results.

use std::collections::BTreeMap;

use serde_json::Value;

use crate::clock;
use crate::constants;
use crate::features::gateway::AssembledToolCall;
use crate::features::gateway::interceptor::{
    execute_intercepted_search, should_intercept_tool_call,
};
use crate::protocol::model::{
    ChatCompletionRequest, ChatContent, ChatMessage, ChatRole, ToolCall, ToolCallFunction,
    ToolCallKind,
};
use crate::protocol::usage::UsageBreakdown;
use crate::state::AppState;

/// Folds one usage breakdown into the running total.
pub(super) fn add_usage(total: &mut UsageBreakdown, usage: &UsageBreakdown) {
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

/// Recognises an in-stream failure payload. `encode_stream` turns upstream
/// read errors and stalls into `data: {"error": {...}}` (a standard envelope),
/// and an upstream body can carry its own `error` key. Returns the status the
/// gateway should log and the message to record: the mapped status for known
/// error types, `500` otherwise — the same default Node's stream handlers use.
pub(crate) fn stream_error_payload(json: &Value) -> Option<(u16, String)> {
    let error = json.get("error")?;
    let (error_type, message) = match error {
        Value::String(message) => (None, message.clone()),
        Value::Object(object) => (
            object.get("type").and_then(Value::as_str),
            object
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or(constants::common::INTERNAL_SERVER_ERROR)
                .to_owned(),
        ),
        _ => (None, constants::common::INTERNAL_SERVER_ERROR.to_owned()),
    };
    let status = match error_type {
        Some("invalid_request_error") => 400,
        Some("authentication_error") => 401,
        Some("permission_error") => 403,
        Some("rate_limit_error") => 429,
        _ => 500,
    };
    Some((status, message))
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

/// Assembles the turn's tool calls and, when any are interceptable and the
/// depth budget remains, appends the assistant tool message, runs the searches,
/// and reports that the caller should re-ask upstream with the results. Shared
/// by the chat and messages streaming loops, which otherwise differ only in
/// their wire envelope.
pub(crate) async fn try_intercept(
    state: &AppState,
    request: &mut ChatCompletionRequest,
    turn: &StreamTurn,
    current_depth: &mut usize,
) -> bool {
    let calls: Vec<ToolCall> = turn
        .assembled()
        .iter()
        .map(assembled_to_tool_call)
        .collect();
    let interceptable: Vec<ToolCall> = calls
        .iter()
        .filter(|call| should_intercept_tool_call(&call.function.name, request.tools.as_deref()))
        .cloned()
        .collect();

    if interceptable.is_empty() || *current_depth >= MAX_INTERCEPT_DEPTH {
        return false;
    }

    request
        .messages
        .push(assistant_tool_message(turn.content(), calls));
    attach_search_results(state, request, interceptable).await;
    *current_depth += 1;
    true
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use crate::features::gateway::AssembledToolCall;
    use crate::protocol::model::{ChatContent, ChatRole, ToolCallKind};
    use crate::protocol::usage::UsageBreakdown;

    use super::{
        StreamTurn, assembled_to_tool_call, assistant_tool_message, delta_has_text, observe_usage,
    };

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
