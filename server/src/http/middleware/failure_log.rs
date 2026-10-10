use axum::extract::Request;
use axum::middleware::Next;
use axum::response::Response;

/// Logs failed responses so the log folder shows what a client was rejected for: `error` for
/// 5xx, `warn` for 4xx. The query string is dropped because OAuth callbacks carry `code` and
/// `state` there.
pub async fn log_failed_requests(request: Request, next: Next) -> Response {
    let method = request.method().clone();
    let path = request.uri().path().to_owned();
    let response = next.run(request).await;
    let status = response.status().as_u16();

    match status {
        500.. => tracing::error!(%method, %path, status, "request failed"),
        400..=499 => tracing::warn!(%method, %path, status, "request rejected"),
        _ => {}
    }

    response
}
