//! Integration tests for provider OAuth quota: `GET /v1/quota` and `GET /v1/qouta`.
//!
//! Verifies:
//! - API-key auth requirement and loopback/key handling.
//! - Exact parity between `/v1/quota` and the retained compatibility alias `/v1/qouta`.
//! - Filtering out non-OAuth providers (mirroring `apps/api/tests/quota-oauth-filter.test.ts`).
//! - Live rate limit window extraction, status, and naming.
//! - 60-second caching and bypass via `?force=true` or `?refresh=true`.
//! - Graceful degradation when upstream errors or tokens are invalid.

mod support;

use std::sync::Arc;

use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode, header},
};
use srouter_server::app::create_router;
use srouter_server::{AppState, QuotaCache, SecurityState};
use support::codex_fake::{FakeCodexUpstream, codex_registry, connect_codex};
use support::{FixtureAPIKeyStore, TestDatabase, test_config, with_loopback_client};
use tower::ServiceExt;

async fn app(database: &TestDatabase, fake: &FakeCodexUpstream) -> Router {
    let database = database.connect().await.expect("temporary database");
    let state = AppState::with_security(
        test_config(),
        codex_registry(Some(database.clone()), fake),
        SecurityState::unconfigured(),
    )
    .with_database(database)
    .with_quota_cache(Arc::new(QuotaCache::with_usage_url(fake.usage_url())));

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
    let bytes = to_bytes(response.into_body(), 1024 * 1024)
        .await
        .expect("read body");
    serde_json::from_slice(&bytes).expect("valid JSON response")
}

#[tokio::test]
async fn quota_requires_api_key_when_configured() {
    let database = TestDatabase::new().expect("temporary database");
    let fake = FakeCodexUpstream::start().await;
    let app_db = database.connect().await.expect("connect database");

    // Configure security state with a key requirement
    let security = SecurityState::new(
        Arc::new(FixtureAPIKeyStore::new(true, Vec::new())),
        Arc::new(srouter_server::features::admin_auth::EmptyAdminSessionStore),
    );

    let state = AppState::with_security(
        test_config(),
        codex_registry(Some(app_db.clone()), &fake),
        security,
    )
    .with_database(app_db)
    .with_quota_cache(Arc::new(QuotaCache::with_usage_url(fake.usage_url())));

    let router = create_router(state);

    // Missing key -> 401
    let req = Request::builder()
        .method("GET")
        .uri("/v1/quota")
        .header(header::HOST, "example.com")
        .body(Body::empty())
        .expect("request");

    let res = router.oneshot(req).await.expect("execute request");
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn quota_and_qouta_return_identical_response() {
    let database = TestDatabase::new().expect("temporary database");
    let fake = FakeCodexUpstream::start().await;
    connect_codex(&database, None).await;

    let app = app(&database, &fake).await;

    let res1 = app
        .clone()
        .oneshot(get_request("/v1/quota"))
        .await
        .expect("res1");
    assert_eq!(res1.status(), StatusCode::OK);
    let json1 = json_body(res1).await;

    let res2 = app.oneshot(get_request("/v1/qouta")).await.expect("res2");
    assert_eq!(res2.status(), StatusCode::OK);
    let json2 = json_body(res2).await;

    assert_eq!(json1, json2);
    assert_eq!(json1["object"], "quota");
    assert_eq!(json1["total_accounts"], 1);
    assert!(json1.get("totalAccounts").is_none());
}

#[tokio::test]
async fn quota_filters_out_non_oauth_providers() {
    let database = TestDatabase::new().expect("temporary database");
    let fake = FakeCodexUpstream::start().await;
    let app_db = database.connect().await.expect("connect database");

    // 1. Insert non-OAuth provider (standard API key)
    let pool = app_db.sqlite_pool().expect("sqlite pool");
    sqlx::query(
        "INSERT INTO providers (id, provider_id, name, category, protocol, enabled, credentials, meta, created_at)
         VALUES ('openai-apikey-1', 'openai', 'OpenAI API Key Account', 'standard', 'openai', 1, '{\"apiKey\":\"sk-test\"}', '{}', 1000)",
    )
    .execute(pool)
    .await
    .expect("insert standard provider");

    // 2. Connect OAuth provider (Codex)
    connect_codex(&database, None).await;

    let app = app(&database, &fake).await;
    let res = app
        .oneshot(get_request("/v1/quota"))
        .await
        .expect("request");
    assert_eq!(res.status(), StatusCode::OK);

    let json = json_body(res).await;
    assert_eq!(json["object"], "quota");
    assert_eq!(json["total_accounts"], 1);
    assert!(json.get("totalAccounts").is_none());

    let providers = json["providers"].as_array().expect("providers array");
    assert_eq!(providers.len(), 1);
    assert_eq!(providers[0]["id"], "codex-account");

    // Standard API key provider must NEVER be included
    assert!(
        !providers.iter().any(|p| p["id"] == "openai-apikey-1"),
        "Standard API key provider must not be included in /quota response"
    );
}

#[tokio::test]
async fn quota_maps_rate_limit_windows_and_status() {
    let database = TestDatabase::new().expect("temporary database");
    let fake = FakeCodexUpstream::start().await;
    connect_codex(&database, None).await;

    fake.with(|state| {
        state.usage_payload = Some(serde_json::json!({
            "plan_type": "go",
            "rate_limit": {
                "allowed": true,
                "limit_reached": false,
                "primary_window": {
                    "used_percent": 10.0,
                    "reset_at": 1759508316,
                    "limit_window_seconds": 18000
                },
                "secondary_window": {
                    "used_percent": 96.0,
                    "reset_at": 1759881804,
                    "limit_window_seconds": 604800
                }
            },
            "rate_limits_by_limit_id": {}
        }));
    });

    let app = app(&database, &fake).await;
    let res = app
        .oneshot(get_request("/v1/quota"))
        .await
        .expect("request");
    assert_eq!(res.status(), StatusCode::OK);

    let json = json_body(res).await;
    let account = &json["providers"][0];
    assert_eq!(account["provider"], "OpenAI Codex (go)");
    assert_eq!(account["quota_type"], "live_provider_quota");
    assert_eq!(account["total_quotas"], 2);
    assert!(account.get("quotaType").is_none());
    assert!(account.get("totalQuotas").is_none());

    let quotas = account["quotas"].as_array().expect("quotas array");
    assert_eq!(quotas[0]["name"], "Codex 5-hour");
    assert_eq!(quotas[0]["used"], 10);
    assert_eq!(quotas[0]["percentage"], "90%");
    assert_eq!(quotas[0]["percentage_value"], 90);
    assert_eq!(quotas[0]["status"], "ok");
    assert!(quotas[0].get("percentageValue").is_none());
    assert!(quotas[0].get("reset_in").is_some());
    assert!(quotas[0].get("resetIn").is_none());
    assert!(quotas[0].get("reset_time").is_some());
    assert!(quotas[0].get("resetTime").is_none());

    // 96% used -> 4% remaining -> status: exhausted
    assert_eq!(quotas[1]["name"], "Codex Weekly");
    assert_eq!(quotas[1]["used"], 96);
    assert_eq!(quotas[1]["percentage"], "4%");
    assert_eq!(quotas[1]["percentage_value"], 4);
    assert_eq!(quotas[1]["status"], "exhausted");
}

#[tokio::test]
async fn quota_uses_in_memory_cache_and_force_refresh_bypasses_it() {
    let database = TestDatabase::new().expect("temporary database");
    let fake = FakeCodexUpstream::start().await;
    connect_codex(&database, None).await;

    let app = app(&database, &fake).await;

    // 1st request -> fetches from fake upstream
    let res1 = app
        .clone()
        .oneshot(get_request("/v1/quota"))
        .await
        .expect("req1");
    assert_eq!(res1.status(), StatusCode::OK);
    assert_eq!(fake.usage_requests(), 1);

    // 2nd request -> served from cache, no new upstream call
    let res2 = app
        .clone()
        .oneshot(get_request("/v1/quota"))
        .await
        .expect("req2");
    assert_eq!(res2.status(), StatusCode::OK);
    assert_eq!(fake.usage_requests(), 1);

    // 3rd request with ?force=true -> bypasses cache
    let res3 = app
        .clone()
        .oneshot(get_request("/v1/quota?force=true"))
        .await
        .expect("req3");
    assert_eq!(res3.status(), StatusCode::OK);
    assert_eq!(fake.usage_requests(), 2);

    // 4th request with ?refresh=true -> also bypasses cache
    let res4 = app
        .oneshot(get_request("/v1/qouta?refresh=true"))
        .await
        .expect("req4");
    assert_eq!(res4.status(), StatusCode::OK);
    assert_eq!(fake.usage_requests(), 3);
}

#[tokio::test]
async fn quota_handles_upstream_failure_gracefully() {
    let database = TestDatabase::new().expect("temporary database");
    let fake = FakeCodexUpstream::start().await;
    connect_codex(&database, None).await;

    fake.with(|state| {
        state.usage_failure = true;
    });

    let app = app(&database, &fake).await;
    let res = app
        .oneshot(get_request("/v1/quota"))
        .await
        .expect("request");

    // Must still return 200 OK with empty providers (caught gracefully)
    assert_eq!(res.status(), StatusCode::OK);
    let json = json_body(res).await;
    assert_eq!(json["object"], "quota");
    assert_eq!(json["total_accounts"], 0);
    assert!(json.get("totalAccounts").is_none());
    assert_eq!(json["providers"], serde_json::json!([]));
}
