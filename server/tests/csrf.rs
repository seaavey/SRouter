//! Integration tests for CSRF origin guard mirroring `apps/api/tests/csrf-origin-guard.test.ts`.

mod support;

use std::collections::HashMap;

use axum::Router;
use axum::body::{Body, to_bytes};
use axum::http::{Request, StatusCode, header};
use srouter_server::app::create_router;
use srouter_server::features::admin_auth::{ADMIN_SESSION_COOKIE, hash_session_token};
use srouter_server::{APIConfig, AppState};
use support::security_state;
use tower::ServiceExt;

fn test_app(cors_origins: &[&str], valid_tokens: &[&str]) -> Router {
    let mut env = HashMap::from([("HOME".to_owned(), "/tmp/srouter-test-home".to_owned())]);
    if !cors_origins.is_empty() {
        env.insert("SROUTER_CORS_ORIGINS".to_owned(), cors_origins.join(","));
    }
    let config = APIConfig::from_env_map(&env).expect("valid config");

    let valid_hashes = valid_tokens.iter().map(|t| hash_session_token(t)).collect();
    let security = security_state(false, vec![], valid_hashes);

    let state = AppState::with_security(
        config,
        srouter_server::features::providers::ProviderRegistry::new(),
        security,
    );

    create_router(state)
}

#[tokio::test]
async fn cookie_mutation_from_a_foreign_origin_is_rejected_even_with_a_valid_session() {
    let app = test_app(&[], &["test-session-token"]);
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/keys")
                .header(header::CONTENT_TYPE, "application/json")
                .header(
                    header::COOKIE,
                    format!("{ADMIN_SESSION_COOKIE}=test-session-token"),
                )
                .header(header::ORIGIN, "https://evil.example.com")
                .body(Body::from(r#"{"name":"test key"}"#))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    assert_eq!(response.headers().get("x-powered-by").unwrap(), "Seaavey");

    let body = to_bytes(response.into_body(), 1024).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["error"]["code"], "csrf_origin_rejected");
    assert_eq!(json["error"]["type"], "permission_error");
    assert_eq!(
        json["error"]["message"],
        "Cross-origin admin mutation is not allowed"
    );
}

#[tokio::test]
async fn same_origin_cookie_mutation_passes() {
    let app = test_app(&[], &["test-session-token"]);
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/keys")
                .header(header::HOST, "gateway.local:3000")
                .header(header::CONTENT_TYPE, "application/json")
                .header(
                    header::COOKIE,
                    format!("{ADMIN_SESSION_COOKIE}=test-session-token"),
                )
                .header(header::ORIGIN, "http://gateway.local:3000")
                .body(Body::from(r#"{"name":"test key"}"#))
                .unwrap(),
        )
        .await
        .unwrap();

    // The request passed CSRF origin guard and reached the keys handler
    // (where in-memory mock store without repository returns 500 or created).
    // The key invariant is that it was NOT rejected by CSRF with 403 csrf_origin_rejected.
    assert_ne!(response.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn cross_origin_mutation_from_an_allowlisted_origin_passes() {
    let app = test_app(&["https://dash.example.com"], &["test-session-token"]);
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/keys")
                .header(header::HOST, "gateway.local:3000")
                .header(header::CONTENT_TYPE, "application/json")
                .header(
                    header::COOKIE,
                    format!("{ADMIN_SESSION_COOKIE}=test-session-token"),
                )
                .header(header::ORIGIN, "https://dash.example.com")
                .body(Body::from(r#"{"name":"test key"}"#))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_ne!(response.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn cross_origin_mutation_from_loopback_passes() {
    let app = test_app(&[], &["test-session-token"]);
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/keys")
                .header(header::HOST, "127.0.0.1:3000")
                .header(header::CONTENT_TYPE, "application/json")
                .header(
                    header::COOKIE,
                    format!("{ADMIN_SESSION_COOKIE}=test-session-token"),
                )
                .header(header::ORIGIN, "http://localhost:5173")
                .body(Body::from(r#"{"name":"test key"}"#))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_ne!(response.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn referer_fallback_is_validated_when_origin_is_absent() {
    let app = test_app(&["https://dash.example.com"], &["test-session-token"]);

    // Disallowed referer is rejected.
    let response_bad = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/keys")
                .header(header::CONTENT_TYPE, "application/json")
                .header(
                    header::COOKIE,
                    format!("{ADMIN_SESSION_COOKIE}=test-session-token"),
                )
                .header(header::REFERER, "https://evil.example.com/bad/page")
                .body(Body::from(r#"{"name":"test key"}"#))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response_bad.status(), StatusCode::FORBIDDEN);
    let body = to_bytes(response_bad.into_body(), 1024).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["error"]["code"], "csrf_origin_rejected");

    // Allowlisted referer passes.
    let response_good = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/keys")
                .header(header::HOST, "gateway.local:3000")
                .header(header::CONTENT_TYPE, "application/json")
                .header(
                    header::COOKIE,
                    format!("{ADMIN_SESSION_COOKIE}=test-session-token"),
                )
                .header(header::REFERER, "https://dash.example.com/admin/keys")
                .body(Body::from(r#"{"name":"test key"}"#))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_ne!(response_good.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn api_key_traffic_without_a_session_cookie_is_untouched() {
    let app = test_app(&[], &[]);
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/chat/completions")
                .header(header::AUTHORIZATION, "Bearer test-key")
                .header(header::ORIGIN, "https://evil.example.com")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    r#"{"model":"unknown","messages":[{"role":"user","content":"hi"}]}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    // Not blocked by CSRF guard (status is 404 or auth check, not 403 csrf_origin_rejected).
    let body = to_bytes(response.into_body(), 1024).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_ne!(json["error"]["code"], "csrf_origin_rejected");
}

#[tokio::test]
async fn get_requests_are_never_blocked() {
    let app = test_app(&[], &["test-session-token"]);
    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/v1/models")
                .header(
                    header::COOKIE,
                    format!("{ADMIN_SESSION_COOKIE}=test-session-token"),
                )
                .header(header::ORIGIN, "https://evil.example.com")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
}

#[tokio::test]
async fn non_browser_clients_without_origin_or_referer_pass() {
    let app = test_app(&[], &["test-session-token"]);
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/keys")
                .header(header::CONTENT_TYPE, "application/json")
                .header(
                    header::COOKIE,
                    format!("{ADMIN_SESSION_COOKIE}=test-session-token"),
                )
                .body(Body::from(r#"{"name":"test key"}"#))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_ne!(response.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn malformed_origin_returns_403_csrf_origin_rejected() {
    let app = test_app(&[], &["test-session-token"]);
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/keys")
                .header(header::CONTENT_TYPE, "application/json")
                .header(
                    header::COOKIE,
                    format!("{ADMIN_SESSION_COOKIE}=test-session-token"),
                )
                .header(header::ORIGIN, "not-a-valid-url")
                .body(Body::from(r#"{"name":"test key"}"#))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    let body = to_bytes(response.into_body(), 1024).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["error"]["code"], "csrf_origin_rejected");
}
