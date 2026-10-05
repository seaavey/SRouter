//! Request-log rows and API-key quota accounting shared by the gateway routes.

use crate::clock;
use crate::features::gateway::RequestLogContext;
use crate::features::providers::ResolvedModel;
use crate::infrastructure::database::request_logs::{RequestLogInput, insert_request_log};
use crate::protocol::usage::UsageBreakdown;
use crate::state::AppState;

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

#[cfg(test)]
mod tests {
    use super::{stream_log_status, unresolved_provider_id};

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
}
