//! Request-log rows and API-key quota accounting shared by the gateway routes.

use crate::clock;
use crate::error::APIError;
use crate::features::gateway::RequestLogContext;
use crate::features::providers::ResolvedModel;
use crate::infrastructure::database::request_logs::{RequestLogInput, insert_request_log};
use crate::protocol::usage::UsageBreakdown;
use crate::state::AppState;

/// Writes one request-log row from a [`RequestLogContext`]. A process without a
/// database logs nothing.
///
/// `error` carries the failure the row describes: the gateway passes the same
/// [`APIError`] the client received, so the log records its code and message
/// instead of a bare status. A streamed failure the upstream raised inside an
/// otherwise successful response has no `APIError`, so the caller passes the
/// code and message it recovered from the error event.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn log_request(
    state: &AppState,
    context: &RequestLogContext,
    provider_id: &str,
    model: &str,
    resolved_model: Option<&str>,
    status_code: u16,
    usage: &UsageBreakdown,
    error: Option<&LogError<'_>>,
) {
    let estimated_cost = if status_code == 200 {
        crate::features::catalog::estimate_cost(resolved_model.unwrap_or(model), usage)
            .unwrap_or(0.0)
    } else {
        0.0
    };
    // `APIError` renders its code through serde, so the pair is built once here
    // rather than borrowed out of the error for the insert.
    let (error_code, error_message) = match error {
        Some(LogError::Gateway(error)) => (error.code_str(), Some(error.message().to_owned())),
        Some(LogError::Stream { message, code }) => {
            (code.map(str::to_owned), Some((*message).to_owned()))
        }
        None => (None, None),
    };

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
                estimated_cost,
                resolved_model,
                error_code: error_code.as_deref(),
                error_message: error_message.as_deref(),
                created_at: clock::now_ms(),
            },
        )
        .await;
    }

    apply_usage_accounting(state, context, status_code, usage, estimated_cost).await;
}

/// The failure a request-log row records.
pub(crate) enum LogError<'a> {
    /// A rejection the gateway produced; its code is the one the client saw.
    Gateway(&'a APIError),
    /// A failure the upstream reported inside its stream, which carries its own
    /// code only when the provider named one.
    Stream {
        message: &'a str,
        code: Option<&'a str>,
    },
}

/// Settles the API-key budget reserved at chat admission: the real token count
/// replaces the reservation and the estimated cost is added to the key. A failed
/// request releases the reservation in full instead.
///
/// A route that reserves nothing bills the tokens it observed: images never
/// reserve, and Node's `LogCompletion` increments the same way for a request
/// whose `reservedTokens` is undefined.
///
/// This is the only writer of `api_keys.usage_tokens`/`usage_cost`. It runs after
/// the request-log insert, which deliberately leaves those columns alone so one
/// request is billed once. Best-effort like the request log: an accounting
/// failure never changes the response.
async fn apply_usage_accounting(
    state: &AppState,
    context: &RequestLogContext,
    status_code: u16,
    usage: &UsageBreakdown,
    estimated_cost: f64,
) {
    let Some(api_key_id) = context.api_key_id.as_deref() else {
        return;
    };
    let repository = &state.security.key_repository;

    if status_code != 200 {
        if let Some(reserved) = context.reserved_tokens {
            let _ = repository.settle_quota(api_key_id, reserved, 0).await;
        }

        return;
    }

    if let Some(reserved) = context.reserved_tokens {
        let _ = repository
            .settle_quota(api_key_id, reserved, usage.total_tokens)
            .await;
        let _ = repository
            .increment_usage(api_key_id, 0, estimated_cost)
            .await;
    } else if usage.total_tokens > 0 || estimated_cost > 0.0 {
        let _ = repository
            .increment_usage(api_key_id, usage.total_tokens, estimated_cost)
            .await;
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
