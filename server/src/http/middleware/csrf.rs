//! CSRF protection for cookie-authenticated admin mutations mirroring `apps/api/src/middleware/CsrfOrigin.ts`.
//!
//! SameSite=Lax blocks cross-site POSTs in modern browsers; this middleware adds
//! an explicit Origin/Referer check for same-site cross-subdomain requests.
//! Requests without an admin session cookie (API keys) and non-browser clients (no Origin/Referer)
//! pass through untouched.

use axum::extract::{Request, State};
use axum::http::{Method, header};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};

use crate::error::APIError;
use crate::features::admin_auth::ADMIN_SESSION_COOKIE;
use crate::http::middleware::cookies::cookie_value;
use crate::http::middleware::cors::get_allowed_origin;
use crate::state::AppState;

fn is_unsafe_method(method: &Method) -> bool {
    method == Method::POST
        || method == Method::PUT
        || method == Method::PATCH
        || method == Method::DELETE
}

fn hosts_match(origin_url: &reqwest::Url, request_host: &str) -> bool {
    let (req_host_only, req_port) = match request_host.split_once(':') {
        Some((h, p)) => (h, p.parse::<u16>().ok()),
        None => (request_host, None),
    };

    let origin_host = origin_url.host_str().unwrap_or("");
    if !origin_host.eq_ignore_ascii_case(req_host_only) {
        return false;
    }

    let default_port = match origin_url.scheme() {
        "http" => Some(80),
        "https" => Some(443),
        _ => None,
    };

    let effective_origin_port = origin_url.port().or(default_port);
    let effective_req_port = req_port.or(default_port);

    effective_origin_port == effective_req_port
}

/// Enforces the CSRF origin guard on state-changing requests using cookie authentication.
pub async fn csrf_origin_guard(
    State(state): State<AppState>,
    request: Request,
    next: Next,
) -> Response {
    if !is_unsafe_method(request.method()) {
        return next.run(request).await;
    }

    // Only cookie-authenticated sessions need CSRF protection.
    // Plain API-key requests and unauthenticated requests pass untouched.
    if cookie_value(request.headers(), ADMIN_SESSION_COOKIE).is_none() {
        return next.run(request).await;
    }

    // Non-browser clients (curl, backend scripts) typically send no Origin or Referer.
    let origin_or_referer = request
        .headers()
        .get(header::ORIGIN)
        .or_else(|| request.headers().get(header::REFERER))
        .and_then(|v| v.to_str().ok())
        .map(str::trim);

    let Some(source) = origin_or_referer else {
        return next.run(request).await;
    };

    let Ok(origin_url) = reqwest::Url::parse(source) else {
        return APIError::new(403, "Cross-origin admin mutation is not allowed")
            .with_code("csrf_origin_rejected")
            .into_response();
    };

    // Same-origin mutations are inherently CSRF-safe.
    let request_host = request
        .headers()
        .get(header::HOST)
        .and_then(|h| h.to_str().ok())
        .map(str::trim)
        .or_else(|| request.uri().authority().map(|a| a.as_str()));

    if let Some(req_host) = request_host {
        if hosts_match(&origin_url, req_host) {
            return next.run(request).await;
        }
    }

    // Check if the origin is in the CORS allowlist (or loopback).
    let origin_ascii = origin_url.origin().ascii_serialization();
    if get_allowed_origin(Some(&origin_ascii), &state.config.cors_origins).is_some() {
        return next.run(request).await;
    }

    APIError::new(403, "Cross-origin admin mutation is not allowed")
        .with_code("csrf_origin_rejected")
        .into_response()
}

#[cfg(test)]
mod tests {
    use axum::http::Method;

    use super::{hosts_match, is_unsafe_method};

    #[test]
    fn unsafe_methods_are_identified() {
        for method in [Method::POST, Method::PUT, Method::PATCH, Method::DELETE] {
            assert!(is_unsafe_method(&method));
        }

        for method in [Method::GET, Method::HEAD, Method::OPTIONS] {
            assert!(!is_unsafe_method(&method));
        }
    }

    #[test]
    fn hosts_matching_handles_ports_and_defaults() {
        let u1 = reqwest::Url::parse("http://gateway.local:3000/v1/keys").unwrap();
        assert!(hosts_match(&u1, "gateway.local:3000"));
        assert!(!hosts_match(&u1, "gateway.local:8080"));
        assert!(!hosts_match(&u1, "evil.com:3000"));

        let u2 = reqwest::Url::parse("http://gateway.local/v1/keys").unwrap();
        assert!(hosts_match(&u2, "gateway.local"));
        assert!(hosts_match(&u2, "gateway.local:80"));

        let u3 = reqwest::Url::parse("https://gateway.local/v1/keys").unwrap();
        assert!(hosts_match(&u3, "gateway.local"));
        assert!(hosts_match(&u3, "gateway.local:443"));

        // Case insensitivity
        assert!(hosts_match(&u1, "GATEWAY.LOCAL:3000"));
    }
}
