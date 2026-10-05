//! The buffered (non-streaming) interception path: run the completion,
//! intercept server-side tool calls, and re-ask until none remain.

use serde_json::Value;

use crate::error::APIError;
use crate::features::gateway::RequestLogContext;
use crate::features::gateway::interceptor::should_intercept_tool_call;
use crate::features::providers::ResolvedModel;
use crate::protocol::model::{ChatCompletionRequest, ChatContent, ToolCall};
use crate::protocol::usage::{UsageBreakdown, normalize_response_usage};
use crate::state::AppState;

use super::logging::log_request;
use super::turn::{MAX_INTERCEPT_DEPTH, add_usage, assistant_tool_message, attach_search_results};

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
