//! Gateway authentication: admin session cookie first, then SRouter API keys.
//! Rejections reproduce the frozen Node envelope (status, type, code, message).

use std::time::{SystemTime, UNIX_EPOCH};

use axum::extract::{Request, State};
use axum::http::{HeaderMap, header};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};

use crate::error::APIError;
use crate::features::admin_auth::{ADMIN_SESSION_COOKIE, hash_session_token};
use crate::features::api_keys::{APIKeyRecord, APIPrincipal, AuthSource};
use crate::state::AppState;

use super::client_address::{client_address, is_loopback_address};

/// Authorizes a gateway request, attaching `APIPrincipal` to the extensions of
/// everything it lets through.
pub async fn api_key_auth(State(state): State<AppState>, request: Request, next: Next) -> Response {
    let (key, session_token) = {
        let headers = request.headers();
        (
            request_key(headers),
            cookie_value(headers, ADMIN_SESSION_COOKIE),
        )
    };
    let peer = client_address(request.extensions());
    let is_loopback = peer.as_deref().is_some_and(is_loopback_address);

    if let Some(token) = session_token {
        match state
            .security
            .admin_sessions
            .has_valid_session(&hash_session_token(&token), now_ms())
            .await
        {
            Ok(true) => {
                return authorize(request, next, AuthSource::AdminSession, None).await;
            }
            Ok(false) => {}
            Err(error) => return error.into_response(),
        }
    }

    let required = match state.security.api_keys.require_api_key().await {
        Ok(require_api_key) => auth_required(require_api_key, peer.as_deref()),
        Err(error) => return error.into_response(),
    };

    if let Some(key) = key {
        match state.security.api_keys.find_by_key(&key).await {
            Err(error) => return error.into_response(),
            Ok(Some(record)) => {
                if let Some(rejection) = record_rejection(&record) {
                    return rejection.into_response();
                }

                return authorize(request, next, AuthSource::APIKey, Some(record)).await;
            }
            Ok(None) => {
                if required {
                    return invalid_api_key().into_response();
                }
            }
        }
    }

    if required {
        return missing_api_key(is_loopback).into_response();
    }

    authorize(request, next, AuthSource::Anonymous, None).await
}

async fn authorize(
    mut request: Request,
    next: Next,
    source: AuthSource,
    api_key: Option<APIKeyRecord>,
) -> Response {
    request
        .extensions_mut()
        .insert(APIPrincipal { source, api_key });

    next.run(request).await
}

/// Rejection for a key that exists but may not serve requests, in Node's order:
/// disabled, then credit, then token quota.
fn record_rejection(record: &APIKeyRecord) -> Option<APIError> {
    if !record.enabled {
        return Some(
            APIError::new(401, "The provided SRouter API Key is disabled")
                .with_error_type("invalid_request_error")
                .with_code("api_key_disabled"),
        );
    }

    if record.credit_limit > 0.0 && record.usage_cost >= record.credit_limit {
        return Some(
            APIError::new(
                402,
                "Insufficient credit balance. Your credit limit has been reached.",
            )
            .with_error_type("insufficient_quota")
            .with_code("insufficient_credit"),
        );
    }

    if record.quota_limit > 0.0 && record.usage_tokens >= record.quota_limit {
        return Some(
            APIError::new(
                429,
                "Token quota exceeded. Your lifetime token limit has been reached.",
            )
            .with_error_type("insufficient_quota")
            .with_code("quota_exceeded"),
        );
    }

    None
}

fn invalid_api_key() -> APIError {
    APIError::new(401, "Invalid SRouter API Key")
        .with_error_type("invalid_request_error")
        .with_code("invalid_api_key")
}

fn missing_api_key(is_loopback: bool) -> APIError {
    let message = if is_loopback {
        "Missing SRouter API Key. Please provide a valid key via 'Authorization: Bearer ***' header or disable 'Require API Key' in Settings."
    } else {
        "Remote/public requests require a valid SRouter API Key. Please provide your key via 'Authorization: Bearer ***' or 'x-api-key'."
    };

    APIError::new(401, message)
        .with_error_type("invalid_request_error")
        .with_code("missing_api_key")
}

/// `x-api-key` wins over `Authorization`; a present-but-blank `x-api-key`
/// suppresses the fallback exactly like the Node middleware's truthiness check.
fn request_key(headers: &HeaderMap) -> Option<String> {
    if let Some(value) = headers
        .get("x-api-key")
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.is_empty())
    {
        let trimmed = value.trim();

        return (!trimmed.is_empty()).then(|| trimmed.to_owned());
    }

    let authorization = headers.get(header::AUTHORIZATION)?.to_str().ok()?.trim();
    let candidate = authorization
        .strip_prefix("Bearer ")
        .map(str::trim)
        .unwrap_or(authorization);

    (!candidate.is_empty()).then(|| candidate.to_owned())
}

/// Reads one cookie by name; the session token itself is base64url, so no
/// percent-decoding is required.
fn cookie_value(headers: &HeaderMap, name: &str) -> Option<String> {
    let cookies = headers.get(header::COOKIE)?.to_str().ok()?;

    cookies.split(';').find_map(|pair| {
        let (key, value) = pair.split_once('=')?;

        (key.trim() == name).then(|| value.trim().trim_matches('"').to_owned())
    })
}

/// API-key enforcement is on when the setting is true or the client is not
/// loopback, matching the frozen contract.
pub fn auth_required(require_api_key: bool, client_address: Option<&str>) -> bool {
    require_api_key || !client_address.is_some_and(is_loopback_address)
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as i64)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use axum::http::{HeaderMap, HeaderName, HeaderValue};

    use super::{auth_required, cookie_value, request_key};

    fn headers(pairs: &[(&str, &str)]) -> HeaderMap {
        let mut map = HeaderMap::new();
        for (name, value) in pairs {
            map.insert(
                HeaderName::from_bytes(name.as_bytes()).expect("header name"),
                HeaderValue::from_str(value).expect("header value"),
            );
        }

        map
    }

    #[test]
    fn x_api_key_is_preferred_and_trimmed() {
        let map = headers(&[("x-api-key", " key "), ("authorization", "Bearer other")]);

        assert_eq!(request_key(&map).as_deref(), Some("key"));
    }

    #[test]
    fn an_empty_x_api_key_falls_back_to_authorization() {
        let map = headers(&[("x-api-key", ""), ("authorization", "Bearer key")]);

        assert_eq!(request_key(&map).as_deref(), Some("key"));
    }

    #[test]
    fn a_blank_x_api_key_blocks_the_authorization_fallback() {
        let map = headers(&[("x-api-key", "   "), ("authorization", "Bearer key")]);

        assert_eq!(request_key(&map), None);
    }

    #[test]
    fn the_bearer_prefix_is_case_sensitive_and_optional() {
        let lowercased = headers(&[("authorization", "bearer key")]);
        let padded = headers(&[("authorization", "Bearer    key")]);

        assert_eq!(request_key(&lowercased).as_deref(), Some("bearer key"));
        assert_eq!(request_key(&padded).as_deref(), Some("key"));
    }

    #[test]
    fn a_whitespace_only_authorization_is_absent() {
        assert_eq!(request_key(&headers(&[("authorization", "   ")])), None);
    }

    #[test]
    fn the_admin_session_cookie_is_read_by_name() {
        let map = headers(&[("cookie", "a=1; srouter_admin_session=token; b=2")]);

        assert_eq!(
            cookie_value(&map, "srouter_admin_session").as_deref(),
            Some("token")
        );
    }

    #[test]
    fn a_missing_cookie_reads_as_none() {
        assert_eq!(
            cookie_value(&headers(&[("cookie", "a=1")]), "srouter_admin_session"),
            None
        );
        assert_eq!(cookie_value(&headers(&[]), "srouter_admin_session"), None);
    }

    #[test]
    fn auth_required_matches_the_frozen_rule() {
        assert!(auth_required(true, Some("127.0.0.1")));
        assert!(auth_required(false, None));
        assert!(auth_required(false, Some("203.0.113.7")));
        assert!(!auth_required(false, Some("127.0.0.1")));
        assert!(!auth_required(false, Some("::ffff:127.0.0.1")));
    }
}
