//! CORS middleware mirroring `apps/api/src/middleware/Cors.ts`.
//!
//! Loopback origins (`localhost`, `127.0.0.1`, `[::1]`) are always allowed.
//! Public origins require explicit configuration via `SROUTER_CORS_ORIGINS`.

use axum::extract::{Request, State};
use axum::http::{HeaderValue, Method, StatusCode, header};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};

use crate::constants;
use crate::state::AppState;

/// Checks if a parsed URL points to a loopback host (localhost, 127.0.0.1, [::1]).
pub fn is_loopback_origin(url: &reqwest::Url) -> bool {
    let scheme = url.scheme();
    if scheme != "http" && scheme != "https" {
        return false;
    }

    match url.host_str() {
        Some(host) => {
            host.eq_ignore_ascii_case("localhost")
                || host == "127.0.0.1"
                || host == "[::1]"
                || host == "::1"
        }
        None => false,
    }
}

/// Returns the origin to echo back, or `None` if the origin is not allowed.
pub fn get_allowed_origin<'a>(origin: Option<&'a str>, allowlist: &[String]) -> Option<&'a str> {
    let origin = origin?.trim().trim_end_matches('/');
    if origin.is_empty() {
        return None;
    }

    let url = reqwest::Url::parse(origin).ok()?;
    if is_loopback_origin(&url) {
        return Some(origin);
    }

    if allowlist
        .iter()
        .any(|allowed| allowed.trim_end_matches('/').eq_ignore_ascii_case(origin))
    {
        return Some(origin);
    }

    None
}

/// Enforces the CORS contract on incoming HTTP requests.
pub async fn cors(State(state): State<AppState>, request: Request, next: Next) -> Response {
    let origin_header = request
        .headers()
        .get(header::ORIGIN)
        .and_then(|v| v.to_str().ok())
        .map(str::trim);

    // Preflight OPTIONS requests with an Origin header are handled directly.
    if request.method() == Method::OPTIONS && origin_header.is_some() {
        let allowed = get_allowed_origin(origin_header, &state.config.cors_origins);
        let mut response = StatusCode::NO_CONTENT.into_response();
        let headers = response.headers_mut();

        headers.insert(
            header::VARY,
            HeaderValue::from_static(constants::headers::value::VARY_PREFLIGHT),
        );

        if let Some(allowed_origin) = allowed {
            if let Ok(val) = HeaderValue::from_str(allowed_origin) {
                headers.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, val);
            }
            headers.insert(
                header::ACCESS_CONTROL_ALLOW_CREDENTIALS,
                HeaderValue::from_static(constants::headers::value::ALLOW_CREDENTIALS),
            );
            headers.insert(
                header::ACCESS_CONTROL_ALLOW_METHODS,
                HeaderValue::from_static(constants::headers::value::ALLOWED_METHODS),
            );
            headers.insert(
                header::ACCESS_CONTROL_ALLOW_HEADERS,
                HeaderValue::from_static(constants::headers::value::ALLOWED_HEADERS),
            );
            headers.insert(
                header::ACCESS_CONTROL_MAX_AGE,
                HeaderValue::from_static(constants::headers::value::MAX_AGE_SECONDS),
            );
        }

        return response;
    }

    // Normal request path.
    let allowed_origin =
        get_allowed_origin(origin_header, &state.config.cors_origins).map(str::to_owned);
    let mut response = next.run(request).await;

    if let Some(allowed) = allowed_origin {
        let headers = response.headers_mut();
        if let Ok(val) = HeaderValue::from_str(&allowed) {
            headers.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, val);
        }
        headers.insert(
            header::ACCESS_CONTROL_ALLOW_CREDENTIALS,
            HeaderValue::from_static("true"),
        );
        headers.insert(
            header::ACCESS_CONTROL_EXPOSE_HEADERS,
            HeaderValue::from_static(constants::headers::value::EXPOSE_HEADERS),
        );
        headers.append(
            header::VARY,
            HeaderValue::from_static(constants::headers::value::VARY_ORIGIN),
        );
    }

    response
}

#[cfg(test)]
mod tests {
    use super::{get_allowed_origin, is_loopback_origin};

    #[test]
    fn loopback_origins_are_detected() {
        for url in [
            "http://localhost",
            "http://localhost:5173",
            "https://localhost:8443",
            "http://127.0.0.1",
            "http://127.0.0.1:3000",
            "https://127.0.0.1:3000",
            "http://[::1]",
            "http://[::1]:1455",
        ] {
            let parsed = reqwest::Url::parse(url).unwrap();
            assert!(is_loopback_origin(&parsed), "expected loopback: {url}");
        }

        for url in [
            "http://evil.com",
            "https://evil.example.com",
            "http://localhost.evil.com",
            "https://evil-localhost",
            "ftp://localhost",
        ] {
            let parsed = reqwest::Url::parse(url).unwrap();
            assert!(!is_loopback_origin(&parsed), "expected not loopback: {url}");
        }
    }

    #[test]
    fn get_allowed_origin_evaluates_loopback_and_allowlist() {
        let allowlist = vec!["https://dash.example.com".to_owned()];

        assert_eq!(
            get_allowed_origin(Some("http://localhost:5173"), &allowlist),
            Some("http://localhost:5173")
        );
        assert_eq!(
            get_allowed_origin(Some("https://127.0.0.1:3000"), &allowlist),
            Some("https://127.0.0.1:3000")
        );
        assert_eq!(
            get_allowed_origin(Some("https://dash.example.com"), &allowlist),
            Some("https://dash.example.com")
        );
        assert_eq!(
            get_allowed_origin(Some("https://dash.example.com/"), &allowlist),
            Some("https://dash.example.com")
        );
        assert_eq!(
            get_allowed_origin(Some("https://evil.example.com"), &allowlist),
            None
        );
        assert_eq!(get_allowed_origin(None, &allowlist), None);
        assert_eq!(get_allowed_origin(Some(""), &allowlist), None);
    }
}
