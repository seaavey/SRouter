use std::collections::HashMap;

use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode, header},
    response::Response,
};
use srouter_server::{APIConfig, AppState, app::create_router};
use tower::ServiceExt;

/// Values frozen in `docs/api-v1-contract.md`. `X-Version` follows the Rust crate version,
/// which is deliberately ahead of the 0.1.8 still served by the Node runtime.
const FROZEN_HEADERS: [(&str, &str); 6] = [
    ("x-powered-by", "Seaavey"),
    ("x-version", env!("CARGO_PKG_VERSION")),
    ("x-content-type-options", "nosniff"),
    ("x-frame-options", "DENY"),
    ("x-xss-protection", "1; mode=block"),
    ("referrer-policy", "strict-origin-when-cross-origin"),
];

fn test_app() -> Router {
    let environment = HashMap::from([("HOME".to_owned(), "/tmp/srouter-test-home".to_owned())]);
    let config = APIConfig::from_env_map(&environment).unwrap();

    create_router(AppState::new(config).expect("application state"))
}

fn assert_frozen_headers(response: &Response) {
    for (name, expected) in FROZEN_HEADERS {
        assert_eq!(response.headers()[name], expected, "header {name}");
    }
}

#[tokio::test]
async fn get_root_returns_api_info_json() {
    let response = test_app()
        .oneshot(Request::builder().uri("/").body(Body::empty()).unwrap())
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()[header::CONTENT_TYPE], "application/json");
    assert_frozen_headers(&response);

    let body = to_bytes(response.into_body(), 1024).await.unwrap();
    let json = serde_json::from_slice::<serde_json::Value>(&body).unwrap();
    assert_eq!(json["name"], "SRouter API");
    assert_eq!(json["status"], "ok");
    assert_eq!(json["version"], env!("CARGO_PKG_VERSION"));
}

#[tokio::test]
async fn get_health_returns_ok_json() {
    let response = test_app()
        .oneshot(
            Request::builder()
                .uri("/health")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()[header::CONTENT_TYPE], "application/json");
    assert_frozen_headers(&response);

    let body = to_bytes(response.into_body(), 1024).await.unwrap();
    let json = serde_json::from_slice::<serde_json::Value>(&body).unwrap();
    assert_eq!(json, serde_json::json!({"status": "ok"}));
}

#[tokio::test]
async fn unmatched_path_still_receives_the_frozen_headers() {
    let response = test_app()
        .oneshot(
            Request::builder()
                .uri("/v1/not-migrated-yet")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    assert_frozen_headers(&response);
}
