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

const COOKIE_MUTATION_ROUTES: &[(&str, &str, Option<&str>)] = &[
    // Admin routes
    (
        "POST",
        "/v1/admin/change-password",
        Some(r#"{"current_password":"old","new_password":"new","confirmation":"new"}"#),
    ),
    ("POST", "/v1/admin/logout", None),
    (
        "POST",
        "/v1/admin/setup",
        Some(r#"{"password":"secret","confirmation":"secret"}"#),
    ),
    ("POST", "/v1/admin/login", Some(r#"{"password":"secret"}"#)),
    // API keys routes
    ("POST", "/v1/keys", Some(r#"{"name":"test key"}"#)),
    ("PUT", "/v1/keys/key_test123", Some(r#"{"name":"renamed"}"#)),
    ("DELETE", "/v1/keys/key_test123", None),
    (
        "POST",
        "/v1/keys/key_test123/credit",
        Some(r#"{"amount":100}"#),
    ),
    // Settings routes
    ("POST", "/v1/settings", Some(r#"{"require_api_key":true}"#)),
    ("PATCH", "/v1/settings", Some(r#"{"require_api_key":true}"#)),
    // Provider management routes
    (
        "PATCH",
        "/v1/providers/opencode_zen",
        Some(r#"{"action":"enable"}"#),
    ),
    // Provider auth / device connect & callback routes
    (
        "POST",
        "/v1/auth/grok-web/connect",
        Some(r#"{"sso":"fixture-valid"}"#),
    ),
    (
        "POST",
        "/v1/auth/openai/token",
        Some(r#"{"code":"test","state":"test"}"#),
    ),
    (
        "POST",
        "/v1/auth/openai/callback",
        Some(r#"{"code":"test","state":"test"}"#),
    ),
    (
        "POST",
        "/v1/auth/qoder/poll",
        Some(r#"{"device_code":"test"}"#),
    ),
    (
        "POST",
        "/v1/auth/qoder/callback",
        Some(r#"{"code":"test","state":"test"}"#),
    ),
    (
        "POST",
        "/v1/auth/cline/poll",
        Some(r#"{"device_code":"test"}"#),
    ),
    // Gateway mutation routes (when session cookie is present)
    (
        "POST",
        "/v1/chat/completions",
        Some(r#"{"model":"gpt-4","messages":[{"role":"user","content":"hi"}]}"#),
    ),
    (
        "POST",
        "/v1/chat/completion",
        Some(r#"{"model":"gpt-4","messages":[{"role":"user","content":"hi"}]}"#),
    ),
    (
        "POST",
        "/v1/chat",
        Some(r#"{"model":"gpt-4","messages":[{"role":"user","content":"hi"}]}"#),
    ),
    (
        "POST",
        "/v1/messages",
        Some(
            r#"{"model":"claude-3-opus","max_tokens":10,"messages":[{"role":"user","content":"hi"}]}"#,
        ),
    ),
    (
        "POST",
        "/v1/messages/count_tokens",
        Some(r#"{"model":"claude-3-opus","messages":[{"role":"user","content":"hi"}]}"#),
    ),
    // Gateway /v1/v1 compat routes
    (
        "POST",
        "/v1/v1/chat/completions",
        Some(r#"{"model":"gpt-4","messages":[{"role":"user","content":"hi"}]}"#),
    ),
    (
        "POST",
        "/v1/v1/chat/completion",
        Some(r#"{"model":"gpt-4","messages":[{"role":"user","content":"hi"}]}"#),
    ),
    (
        "POST",
        "/v1/v1/chat",
        Some(r#"{"model":"gpt-4","messages":[{"role":"user","content":"hi"}]}"#),
    ),
    (
        "POST",
        "/v1/v1/messages",
        Some(
            r#"{"model":"claude-3-opus","max_tokens":10,"messages":[{"role":"user","content":"hi"}]}"#,
        ),
    ),
    (
        "POST",
        "/v1/v1/messages/count_tokens",
        Some(r#"{"model":"claude-3-opus","messages":[{"role":"user","content":"hi"}]}"#),
    ),
];

const BODY_LIMIT_ROUTES: &[(&str, &str)] = &[
    ("POST", "/v1/admin/change-password"),
    ("POST", "/v1/admin/setup"),
    ("POST", "/v1/admin/login"),
    ("POST", "/v1/admin/logout"),
    ("POST", "/v1/settings"),
    ("PATCH", "/v1/settings"),
    ("PATCH", "/v1/providers/opencode_zen"),
    ("POST", "/v1/auth/grok-web/connect"),
    ("POST", "/v1/auth/openai/token"),
    ("POST", "/v1/auth/openai/callback"),
    ("POST", "/v1/auth/qoder/poll"),
    ("POST", "/v1/auth/qoder/callback"),
    ("POST", "/v1/auth/cline/poll"),
    ("POST", "/v1/keys"),
    ("PUT", "/v1/keys/key_test123"),
    ("POST", "/v1/keys/key_test123/credit"),
    ("POST", "/v1/chat/completions"),
    ("POST", "/v1/v1/chat/completions"),
];

#[tokio::test]
async fn every_cookie_authenticated_mutation_route_rejects_foreign_origin() {
    let app = test_app(&[], &["test-session-token"]);

    for &(method, uri, body_payload) in COOKIE_MUTATION_ROUTES {
        let body = match body_payload {
            Some(b) => Body::from(b),
            None => Body::empty(),
        };

        let mut builder = Request::builder()
            .method(method)
            .uri(uri)
            .header(
                header::COOKIE,
                format!("{ADMIN_SESSION_COOKIE}=test-session-token"),
            )
            .header(header::ORIGIN, "https://evil.example.com");

        if body_payload.is_some() {
            builder = builder.header(header::CONTENT_TYPE, "application/json");
        }

        let response = app
            .clone()
            .oneshot(builder.body(body).unwrap())
            .await
            .unwrap();

        assert_eq!(
            response.status(),
            StatusCode::FORBIDDEN,
            "failed rejection for {method} {uri}"
        );
        assert_eq!(
            response.headers().get("x-powered-by").unwrap(),
            "Seaavey",
            "missing x-powered-by on {method} {uri}"
        );

        let resp_body = to_bytes(response.into_body(), 1024).await.unwrap();
        let json: serde_json::Value = serde_json::from_slice(&resp_body).unwrap();
        assert_eq!(
            json["error"]["code"], "csrf_origin_rejected",
            "wrong code for {method} {uri}"
        );
        assert_eq!(
            json["error"]["type"], "permission_error",
            "wrong type for {method} {uri}"
        );
        assert_eq!(
            json["error"]["message"], "Cross-origin admin mutation is not allowed",
            "wrong message for {method} {uri}"
        );
    }
}

#[tokio::test]
async fn every_cookie_authenticated_mutation_route_passes_same_origin() {
    let app = test_app(&[], &["test-session-token"]);

    for &(method, uri, body_payload) in COOKIE_MUTATION_ROUTES {
        let body = match body_payload {
            Some(b) => Body::from(b),
            None => Body::empty(),
        };

        let mut builder = Request::builder()
            .method(method)
            .uri(uri)
            .header(header::HOST, "gateway.local:3000")
            .header(
                header::COOKIE,
                format!("{ADMIN_SESSION_COOKIE}=test-session-token"),
            )
            .header(header::ORIGIN, "http://gateway.local:3000");

        if body_payload.is_some() {
            builder = builder.header(header::CONTENT_TYPE, "application/json");
        }

        let response = app
            .clone()
            .oneshot(builder.body(body).unwrap())
            .await
            .unwrap();

        if response.status() == StatusCode::FORBIDDEN {
            let resp_body = to_bytes(response.into_body(), 1024).await.unwrap();
            let json: serde_json::Value = serde_json::from_slice(&resp_body).unwrap();
            assert_ne!(
                json["error"]["code"], "csrf_origin_rejected",
                "{method} {uri} was unexpectedly blocked by CSRF guard on same-origin request"
            );
        }
    }
}

#[tokio::test]
async fn every_cookie_authenticated_mutation_route_passes_allowlisted_origin() {
    let app = test_app(&["https://dash.example.com"], &["test-session-token"]);

    for &(method, uri, body_payload) in COOKIE_MUTATION_ROUTES {
        let body = match body_payload {
            Some(b) => Body::from(b),
            None => Body::empty(),
        };

        let mut builder = Request::builder()
            .method(method)
            .uri(uri)
            .header(header::HOST, "gateway.local:3000")
            .header(
                header::COOKIE,
                format!("{ADMIN_SESSION_COOKIE}=test-session-token"),
            )
            .header(header::ORIGIN, "https://dash.example.com");

        if body_payload.is_some() {
            builder = builder.header(header::CONTENT_TYPE, "application/json");
        }

        let response = app
            .clone()
            .oneshot(builder.body(body).unwrap())
            .await
            .unwrap();

        if response.status() == StatusCode::FORBIDDEN {
            let resp_body = to_bytes(response.into_body(), 1024).await.unwrap();
            let json: serde_json::Value = serde_json::from_slice(&resp_body).unwrap();
            assert_ne!(
                json["error"]["code"], "csrf_origin_rejected",
                "{method} {uri} was unexpectedly blocked by CSRF guard on allowlisted origin"
            );
        }
    }
}

#[tokio::test]
async fn every_cookie_authenticated_mutation_route_passes_non_browser_client() {
    let app = test_app(&[], &["test-session-token"]);

    for &(method, uri, body_payload) in COOKIE_MUTATION_ROUTES {
        let body = match body_payload {
            Some(b) => Body::from(b),
            None => Body::empty(),
        };

        let mut builder = Request::builder().method(method).uri(uri).header(
            header::COOKIE,
            format!("{ADMIN_SESSION_COOKIE}=test-session-token"),
        );

        if body_payload.is_some() {
            builder = builder.header(header::CONTENT_TYPE, "application/json");
        }

        let response = app
            .clone()
            .oneshot(builder.body(body).unwrap())
            .await
            .unwrap();

        if response.status() == StatusCode::FORBIDDEN {
            let resp_body = to_bytes(response.into_body(), 1024).await.unwrap();
            let json: serde_json::Value = serde_json::from_slice(&resp_body).unwrap();
            assert_ne!(
                json["error"]["code"], "csrf_origin_rejected",
                "{method} {uri} was unexpectedly blocked by CSRF guard without origin header"
            );
        }
    }
}

#[tokio::test]
async fn foreign_referer_is_rejected_across_all_cookie_authenticated_routes() {
    let app = test_app(&[], &["test-session-token"]);

    for &(method, uri, body_payload) in COOKIE_MUTATION_ROUTES {
        let body = match body_payload {
            Some(b) => Body::from(b),
            None => Body::empty(),
        };

        let mut builder = Request::builder()
            .method(method)
            .uri(uri)
            .header(
                header::COOKIE,
                format!("{ADMIN_SESSION_COOKIE}=test-session-token"),
            )
            .header(header::REFERER, "https://evil.example.com/exploit");

        if body_payload.is_some() {
            builder = builder.header(header::CONTENT_TYPE, "application/json");
        }

        let response = app
            .clone()
            .oneshot(builder.body(body).unwrap())
            .await
            .unwrap();

        assert_eq!(
            response.status(),
            StatusCode::FORBIDDEN,
            "failed referer rejection for {method} {uri}"
        );
        let resp_body = to_bytes(response.into_body(), 1024).await.unwrap();
        let json: serde_json::Value = serde_json::from_slice(&resp_body).unwrap();
        assert_eq!(
            json["error"]["code"], "csrf_origin_rejected",
            "wrong code for referer on {method} {uri}"
        );
    }
}

#[tokio::test]
async fn same_origin_ipv6_cookie_mutation_passes() {
    let app = test_app(&[], &["test-session-token"]);

    for &(method, uri, body_payload) in &[
        ("POST", "/v1/keys", Some(r#"{"name":"test key"}"#)),
        (
            "POST",
            "/v1/admin/change-password",
            Some(r#"{"current_password":"old","new_password":"new","confirmation":"new"}"#),
        ),
    ] {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(method)
                    .uri(uri)
                    .header(header::HOST, "[::1]:3000")
                    .header(header::CONTENT_TYPE, "application/json")
                    .header(
                        header::COOKIE,
                        format!("{ADMIN_SESSION_COOKIE}=test-session-token"),
                    )
                    .header(header::ORIGIN, "http://[::1]:3000")
                    .body(Body::from(body_payload.unwrap()))
                    .unwrap(),
            )
            .await
            .unwrap();

        if response.status() == StatusCode::FORBIDDEN {
            let resp_body = to_bytes(response.into_body(), 1024).await.unwrap();
            let json: serde_json::Value = serde_json::from_slice(&resp_body).unwrap();
            assert_ne!(json["error"]["code"], "csrf_origin_rejected");
        }
    }
}

#[tokio::test]
async fn body_limit_rejects_oversized_content_length_on_admin_database_and_mutation_routes() {
    let app = test_app(&[], &["test-session-token"]);

    for &(method, uri) in BODY_LIMIT_ROUTES {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(method)
                    .uri(uri)
                    .header(header::CONTENT_TYPE, "application/json")
                    .header(header::CONTENT_LENGTH, (25 * 1024 * 1024 + 1).to_string())
                    .body(Body::from("{}"))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(
            response.status(),
            StatusCode::PAYLOAD_TOO_LARGE,
            "body limit did not reject oversized Content-Length on {method} {uri}"
        );
        assert_eq!(
            response.headers().get("x-powered-by").unwrap(),
            "Seaavey",
            "missing x-powered-by on 413 for {method} {uri}"
        );

        let resp_body = to_bytes(response.into_body(), 1024).await.unwrap();
        let json: serde_json::Value = serde_json::from_slice(&resp_body).unwrap();
        assert_eq!(
            json["error"]["code"], "request_too_large",
            "wrong code on {method} {uri}"
        );
        assert_eq!(
            json["error"]["type"], "invalid_request_error",
            "wrong type on {method} {uri}"
        );
        assert_eq!(
            json["error"]["message"], "Request body too large",
            "wrong message on {method} {uri}"
        );
    }
}

#[tokio::test]
async fn body_limit_allows_normal_sized_payloads_on_admin_database_and_mutation_routes() {
    let app = test_app(&[], &["test-session-token"]);

    for &(method, uri) in BODY_LIMIT_ROUTES {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(method)
                    .uri(uri)
                    .header(header::CONTENT_TYPE, "application/json")
                    .header(header::CONTENT_LENGTH, "2")
                    .body(Body::from("{}"))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_ne!(
            response.status(),
            StatusCode::PAYLOAD_TOO_LARGE,
            "{method} {uri} was unexpectedly rejected by body limit with normal payload"
        );
    }
}
