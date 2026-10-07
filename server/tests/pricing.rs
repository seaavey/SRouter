//! Integration tests for model pricing: `GET /v1/models/pricing` and cost estimation.
//!
//! Verifies:
//! - Pricing catalog endpoint returns 200 with standard caching headers.
//! - Non-loopback requests without an API key are rejected with 401 when configured.
//! - `Cache-Control: no-cache` / query refresh params work gracefully.
//! - Endpoint is NOT mounted under compat `/v1/v1/models/pricing` (returns 404).
//! - Unit tests for `estimate_cost` function covering prompt, cached discount, completion tokens.

mod support;

use std::sync::Arc;

use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode, header},
};
use srouter_server::app::create_router;
use srouter_server::features::catalog::estimate_cost;
use srouter_server::features::providers::ProviderRegistry;
use srouter_server::protocol::usage::UsageBreakdown;
use srouter_server::{AppState, SecurityState};
use support::{
    FixtureAPIKeyStore, api_key_record, test_config, with_loopback_client, with_remote_client,
};
use tower::ServiceExt;

fn test_app(security: SecurityState) -> Router {
    let providers = ProviderRegistry::with_defaults().expect("default providers");
    let state = AppState::with_security(test_config(), providers, security);

    create_router(state)
}

fn get_request(uri: &str) -> Request<Body> {
    with_loopback_client(
        Request::builder()
            .method("GET")
            .uri(uri)
            .body(Body::empty())
            .expect("request"),
    )
}

async fn json_body(response: axum::response::Response) -> serde_json::Value {
    let bytes = to_bytes(response.into_body(), 10 * 1024 * 1024)
        .await
        .expect("read body");
    serde_json::from_slice(&bytes).expect("valid JSON response")
}

#[tokio::test]
async fn pricing_endpoint_returns_catalog_with_caching_headers() {
    let app = test_app(SecurityState::unconfigured());

    let response = app
        .oneshot(get_request("/v1/models/pricing"))
        .await
        .expect("response");

    assert_eq!(response.status(), StatusCode::OK);

    let cache_control = response
        .headers()
        .get(header::CACHE_CONTROL)
        .and_then(|v| v.to_str().ok())
        .expect("cache-control header present");

    assert!(
        cache_control.contains("max-age=3600"),
        "expected max-age=3600 in {cache_control}"
    );
    assert!(
        cache_control.contains("stale-while-revalidate=86400"),
        "expected stale-while-revalidate=86400 in {cache_control}"
    );

    let body = json_body(response).await;
    assert_eq!(body["object"], "list");

    let total = body["total"].as_u64().expect("total is number") as usize;
    assert!(total > 2000, "total models should be > 2000, got {total}");

    let data = body["data"].as_array().expect("data is array");
    assert_eq!(data.len(), total);

    // Verify priced model format
    let priced = data
        .iter()
        .find(|m| m["cost"]["input"].is_number() && m["cost"]["output"].is_number())
        .expect("at least one model with input/output price");
    assert!(priced["id"].is_string());
    assert!(priced["provider"].is_string());

    // Verify unpriced model format (omits or has null for cost fields)
    let unpriced = data
        .iter()
        .find(|m| m["cost"].is_null() || m["cost"]["input"].is_null());
    assert!(
        unpriced.is_some(),
        "catalog should preserve unpriced models"
    );
}

#[tokio::test]
async fn pricing_endpoint_requires_api_key_auth() {
    let (key_id, raw_key) = ("pricing-test-key", "sk-pricing-test-12345");
    let record = api_key_record(key_id);
    let store = Arc::new(FixtureAPIKeyStore::new(
        true,
        vec![(raw_key.to_string(), record)],
    ));
    let security = SecurityState::new(
        store,
        Arc::new(srouter_server::features::admin_auth::EmptyAdminSessionStore),
    );
    let app = test_app(security);

    // 1. Remote request without API key -> 401
    let unauth_req = with_remote_client(
        Request::builder()
            .method("GET")
            .uri("/v1/models/pricing")
            .body(Body::empty())
            .expect("request"),
        "198.51.100.1",
    );
    let response = app.clone().oneshot(unauth_req).await.expect("response");
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);

    // 2. Remote request with valid API key -> 200
    let auth_req = with_remote_client(
        Request::builder()
            .method("GET")
            .uri("/v1/models/pricing")
            .header(header::AUTHORIZATION, format!("Bearer {raw_key}"))
            .body(Body::empty())
            .expect("request"),
        "198.51.100.1",
    );
    let response = app.oneshot(auth_req).await.expect("response");
    assert_eq!(response.status(), StatusCode::OK);
}

#[tokio::test]
async fn pricing_endpoint_honors_refresh_and_no_cache() {
    let app = test_app(SecurityState::unconfigured());

    // Request with ?refresh=true
    let req = with_loopback_client(
        Request::builder()
            .method("GET")
            .uri("/v1/models/pricing?refresh=true")
            .body(Body::empty())
            .expect("request"),
    );
    let response = app.clone().oneshot(req).await.expect("response");
    assert_eq!(response.status(), StatusCode::OK);

    // Request with ?force=1
    let req = with_loopback_client(
        Request::builder()
            .method("GET")
            .uri("/v1/models/pricing?force=1")
            .body(Body::empty())
            .expect("request"),
    );
    let response = app.clone().oneshot(req).await.expect("response");
    assert_eq!(response.status(), StatusCode::OK);

    // Request with Cache-Control: no-cache
    let req = with_loopback_client(
        Request::builder()
            .method("GET")
            .uri("/v1/models/pricing")
            .header(header::CACHE_CONTROL, "no-cache")
            .body(Body::empty())
            .expect("request"),
    );
    let response = app.oneshot(req).await.expect("response");
    assert_eq!(response.status(), StatusCode::OK);
}

#[tokio::test]
async fn pricing_endpoint_not_mounted_on_compat_v1_v1() {
    let app = test_app(SecurityState::unconfigured());

    // /v1/models/pricing -> 200
    let res_v1 = app
        .clone()
        .oneshot(get_request("/v1/models/pricing"))
        .await
        .expect("response");
    assert_eq!(res_v1.status(), StatusCode::OK);

    // /v1/v1/models/pricing -> 404 Not Found
    let res_compat = app
        .oneshot(get_request("/v1/v1/models/pricing"))
        .await
        .expect("response");
    assert_eq!(res_compat.status(), StatusCode::NOT_FOUND);
}

#[test]
fn test_estimate_cost_calculations() {
    let usage = UsageBreakdown {
        prompt_tokens: 10_000,
        completion_tokens: 2_000,
        total_tokens: 12_000,
        cached_tokens: 3_000,
        cache_creation_tokens: 1_000,
        reasoning_tokens: 0,
    };

    // Unknown model returns None
    assert_eq!(estimate_cost("non-existent-model-xyz", &usage), None);

    // Test a known model with prices in dataset, e.g., "openai/gpt-4o" or "gpt-4o"
    // In models-dev-pricing.json: gpt-4o from abacus or azure or openai:
    // input is 2.5 $/M, output is 10 $/M, cache_read is 1.25 $/M
    // non_cached_prompt = (10000 - 3000 - 1000) = 6000
    // prompt_cost = 6000 * 2.5 / 1_000_000 = 0.015
    // cache_read_cost = 3000 * 1.25 / 1_000_000 = 0.00375
    // cache_write_cost = 1000 * 2.5 / 1_000_000 = 0.0025
    // completion_cost = 2000 * 10.0 / 1_000_000 = 0.02
    // total = 0.015 + 0.00375 + 0.0025 + 0.02 = 0.04125
    let cost = estimate_cost("gpt-4o", &usage);
    assert!(cost.is_some());
    let cost_val = cost.unwrap();
    assert!(
        (cost_val - 0.04125).abs() < 1e-4,
        "expected ~0.04125, got {cost_val}"
    );

    // Stripping provider prefix test: "openai/gpt-4o"
    let cost_prefixed = estimate_cost("openai/gpt-4o", &usage);
    assert!(cost_prefixed.is_some());
}

#[test]
fn test_estimate_cost_zero_for_free_models() {
    let usage = UsageBreakdown {
        prompt_tokens: 5_000,
        completion_tokens: 1_000,
        total_tokens: 6_000,
        cached_tokens: 0,
        cache_creation_tokens: 0,
        reasoning_tokens: 0,
    };

    // "agnes-2.0-flash" has cost: { input: 0, output: 0 }
    let cost = estimate_cost("agnes-2.0-flash", &usage);
    assert_eq!(cost, Some(0.0));
}

#[tokio::test]
async fn live_network_request_smoke_test() {
    let app = test_app(SecurityState::unconfigured());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind ephemeral port");
    let port = listener.local_addr().expect("local addr").port();

    let server_task = tokio::spawn(async move {
        axum::serve(
            listener,
            app.into_make_service_with_connect_info::<std::net::SocketAddr>(),
        )
        .await
        .expect("serve app");
    });

    let client = reqwest::Client::new();

    // 1. Live GET /v1/models/pricing over real TCP socket
    let res = client
        .get(format!("http://127.0.0.1:{port}/v1/models/pricing"))
        .send()
        .await
        .expect("send request");

    assert_eq!(res.status(), reqwest::StatusCode::OK);

    let cache_control = res
        .headers()
        .get("cache-control")
        .expect("cache-control header")
        .to_str()
        .unwrap();
    assert!(cache_control.contains("max-age=3600"));
    assert!(cache_control.contains("stale-while-revalidate=86400"));

    let body: serde_json::Value = res.json().await.expect("json body");
    assert_eq!(body["object"], "list");
    let total = body["total"].as_u64().expect("total as number");
    assert!(total > 8000, "expected > 8000 models, got {total}");
    assert_eq!(body["data"].as_array().unwrap().len() as u64, total);

    // 2. Live GET /v1/v1/models/pricing -> 404 Not Found
    let res_compat = client
        .get(format!("http://127.0.0.1:{port}/v1/v1/models/pricing"))
        .send()
        .await
        .expect("send compat request");
    assert_eq!(res_compat.status(), reqwest::StatusCode::NOT_FOUND);

    server_task.abort();
}
