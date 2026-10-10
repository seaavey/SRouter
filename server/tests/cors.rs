//! Integration tests for CORS middleware mirroring `apps/api/tests/cors-allowlist.test.ts`.

mod support;

use std::collections::HashMap;

use axum::Router;
use axum::body::Body;
use axum::http::{Request, StatusCode, header};
use srouter_server::app::create_router;
use srouter_server::{APIConfig, AppState};
use tower::ServiceExt;

fn app_with_cors_origins(origins: &[&str]) -> Router {
    let mut env = HashMap::from([("HOME".to_owned(), "/tmp/srouter-test-home".to_owned())]);
    if !origins.is_empty() {
        env.insert("SROUTER_CORS_ORIGINS".to_owned(), origins.join(","));
    }
    let config = APIConfig::from_env_map(&env).expect("valid config");
    create_router(AppState::new(config).expect("application state"))
}

#[tokio::test]
async fn arbitrary_public_origin_gets_no_cors_headers() {
    let app = app_with_cors_origins(&[]);
    let response = app
        .oneshot(
            Request::builder()
                .uri("/health")
                .header(header::ORIGIN, "https://evil.example.com")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response.headers().get(header::ACCESS_CONTROL_ALLOW_ORIGIN),
        None
    );
}

#[tokio::test]
async fn preflight_from_arbitrary_origin_is_not_approved() {
    let app = app_with_cors_origins(&[]);
    let response = app
        .oneshot(
            Request::builder()
                .method("OPTIONS")
                .uri("/v1/chat/completions")
                .header(header::ORIGIN, "https://evil.example.com")
                .header("access-control-request-method", "POST")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    assert_eq!(
        response.headers().get(header::ACCESS_CONTROL_ALLOW_ORIGIN),
        None
    );
}

#[tokio::test]
async fn allowlisted_origin_receives_reflected_origin_with_credentials() {
    let app = app_with_cors_origins(&["https://dash.example.com"]);
    let response = app
        .oneshot(
            Request::builder()
                .uri("/health")
                .header(header::ORIGIN, "https://dash.example.com")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response
            .headers()
            .get(header::ACCESS_CONTROL_ALLOW_ORIGIN)
            .unwrap(),
        "https://dash.example.com"
    );
    assert_eq!(
        response
            .headers()
            .get(header::ACCESS_CONTROL_ALLOW_CREDENTIALS)
            .unwrap(),
        "true"
    );
    assert_eq!(
        response
            .headers()
            .get(header::ACCESS_CONTROL_EXPOSE_HEADERS)
            .unwrap(),
        "Content-Length, X-Request-Id, X-Version"
    );
}

#[tokio::test]
async fn loopback_dev_origins_keep_working() {
    let app = app_with_cors_origins(&[]);

    for loopback in [
        "http://localhost:5173",
        "http://127.0.0.1:3000",
        "http://[::1]:1455",
    ] {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/health")
                    .header(header::ORIGIN, loopback)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response
                .headers()
                .get(header::ACCESS_CONTROL_ALLOW_ORIGIN)
                .unwrap(),
            loopback
        );
        assert_eq!(
            response
                .headers()
                .get(header::ACCESS_CONTROL_ALLOW_CREDENTIALS)
                .unwrap(),
            "true"
        );
    }
}

#[tokio::test]
async fn preflight_from_allowlisted_origin_receives_all_preflight_headers() {
    let app = app_with_cors_origins(&["https://dash.example.com"]);
    let response = app
        .oneshot(
            Request::builder()
                .method("OPTIONS")
                .uri("/v1/chat/completions")
                .header(header::ORIGIN, "https://dash.example.com")
                .header("access-control-request-method", "POST")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    assert_eq!(
        response
            .headers()
            .get(header::ACCESS_CONTROL_ALLOW_ORIGIN)
            .unwrap(),
        "https://dash.example.com"
    );
    assert_eq!(
        response
            .headers()
            .get(header::ACCESS_CONTROL_ALLOW_CREDENTIALS)
            .unwrap(),
        "true"
    );
    assert_eq!(
        response
            .headers()
            .get(header::ACCESS_CONTROL_ALLOW_METHODS)
            .unwrap(),
        "GET, POST, PUT, PATCH, DELETE, OPTIONS"
    );
    assert_eq!(
        response
            .headers()
            .get(header::ACCESS_CONTROL_ALLOW_HEADERS)
            .unwrap(),
        "Content-Type, Authorization, x-api-key, anthropic-version"
    );
    assert_eq!(
        response
            .headers()
            .get(header::ACCESS_CONTROL_MAX_AGE)
            .unwrap(),
        "86400"
    );

    // Preflight responses must also carry the frozen security headers stamped by the outer layer.
    assert_eq!(response.headers().get("x-powered-by").unwrap(), "Seaavey");
    assert_eq!(
        response.headers().get("x-version").unwrap(),
        env!("CARGO_PKG_VERSION")
    );
    assert_eq!(
        response.headers().get("x-content-type-options").unwrap(),
        "nosniff"
    );
}

#[tokio::test]
async fn plain_options_without_origin_passes_through() {
    let app = app_with_cors_origins(&[]);
    let response = app
        .oneshot(
            Request::builder()
                .method("OPTIONS")
                .uri("/health")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(
        response.headers().get(header::ACCESS_CONTROL_ALLOW_ORIGIN),
        None
    );
}
