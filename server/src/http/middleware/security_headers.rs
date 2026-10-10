use axum::extract::Request;
use axum::http::HeaderValue;
use axum::middleware::Next;
use axum::response::Response;

use crate::constants::headers;

/// Stamps the header set frozen in `docs/api-v1-contract.md` onto every response.
pub async fn security_headers(request: Request, next: Next) -> Response {
    let mut response = next.run(request).await;
    let response_headers = response.headers_mut();

    response_headers.insert(
        headers::name::X_POWERED_BY,
        HeaderValue::from_static(headers::value::POWERED_BY),
    );
    response_headers.insert(
        headers::name::X_VERSION,
        HeaderValue::from_static(env!("CARGO_PKG_VERSION")),
    );
    response_headers.insert(
        headers::name::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static(headers::value::CONTENT_TYPE_OPTIONS),
    );
    response_headers.insert(
        headers::name::X_FRAME_OPTIONS,
        HeaderValue::from_static(headers::value::FRAME_OPTIONS),
    );
    response_headers.insert(
        headers::name::X_XSS_PROTECTION,
        HeaderValue::from_static(headers::value::XSS_PROTECTION),
    );
    response_headers.insert(
        headers::name::REFERRER_POLICY,
        HeaderValue::from_static(headers::value::REFERRER_POLICY),
    );

    response
}
