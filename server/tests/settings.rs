//! End-to-end integration tests for `/v1/settings` against a temporary SQLite database.

mod support;

use axum::Router;
use axum::body::{Body, to_bytes};
use axum::http::{Request, StatusCode};
use axum::response::Response;
use sha2::{Digest, Sha256};
use srouter_server::app::create_router;
use srouter_server::features::admin_auth::hash_session_token;
use support::{
    TestDatabase, empty_registry_state, json_request, json_request_with_headers,
    sqlx_security_state, with_loopback_client, with_remote_client,
};
use tower::ServiceExt;

const SESSION_TOKEN: &str = "test-session-token";
const SETTINGS_URI: &str = "/v1/settings";
const REMOTE_IP: &str = "203.0.113.7";
const TEST_API_KEY: &str = "sr-live-settings-test-key-12345";

async fn setup_app(database: &TestDatabase) -> (Router, sqlx::SqlitePool) {
    let pool = database
        .connect()
        .await
        .unwrap()
        .sqlite_pool()
        .unwrap()
        .clone();
    let security = sqlx_security_state(database, vec![hash_session_token(SESSION_TOKEN)]).await;
    let state = empty_registry_state(security)
        .with_database(database.connect().await.expect("connect database"));

    (create_router(state), pool)
}

async fn insert_test_api_key(pool: &sqlx::SqlitePool) {
    let key_hash = hex::encode(Sha256::digest(TEST_API_KEY.as_bytes()));
    sqlx::query(
        "INSERT INTO api_keys (id, key_hash, key_prefix, name, enabled, rate_limit, quota_limit, \
         usage_tokens, credit_limit, usage_cost, allowed_models, created_at) \
         VALUES ('test-key-id', ?, 'sr-live-', 'Test Key', 1, 0, 0, 0, 0.0, 0.0, NULL, 1000)",
    )
    .bind(key_hash)
    .execute(pool)
    .await
    .unwrap();
}

fn admin_request(method: &str, uri: &str, body: serde_json::Value) -> Request<Body> {
    let cookie = format!("srouter_admin_session={SESSION_TOKEN}");
    with_loopback_client(json_request_with_headers(
        method,
        uri,
        body,
        &[("cookie", cookie.as_str())],
    ))
}

fn get_request(uri: &str) -> Request<Body> {
    with_loopback_client(json_request("GET", uri, serde_json::Value::Null))
}

fn remote_get_request(uri: &str) -> Request<Body> {
    with_remote_client(json_request("GET", uri, serde_json::Value::Null), REMOTE_IP)
}

fn api_key_get_request(uri: &str, key: &str) -> Request<Body> {
    with_remote_client(
        json_request_with_headers(
            "GET",
            uri,
            serde_json::Value::Null,
            &[("authorization", format!("Bearer {key}").as_str())],
        ),
        REMOTE_IP,
    )
}

async fn json_body(response: Response) -> serde_json::Value {
    let bytes = to_bytes(response.into_body(), 65_536).await.unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

#[tokio::test]
async fn get_settings_returns_defaults_on_anonymous_loopback() {
    let database = TestDatabase::new().unwrap();
    let (app, _) = setup_app(&database).await;

    let response = app.oneshot(get_request(SETTINGS_URI)).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    let body = json_body(response).await;
    assert_eq!(body, serde_json::json!({ "require_api_key": false }));
}

#[tokio::test]
async fn get_settings_rejects_unauthenticated_remote_requests() {
    let database = TestDatabase::new().unwrap();
    let (app, _) = setup_app(&database).await;

    let response = app.oneshot(remote_get_request(SETTINGS_URI)).await.unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);

    let body = json_body(response).await;
    assert_eq!(body["error"]["code"], "missing_api_key");
}

#[tokio::test]
async fn get_settings_allows_authenticated_remote_requests() {
    let database = TestDatabase::new().unwrap();
    let (app, pool) = setup_app(&database).await;
    insert_test_api_key(&pool).await;

    let response = app
        .oneshot(api_key_get_request(SETTINGS_URI, TEST_API_KEY))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    let body = json_body(response).await;
    assert_eq!(body, serde_json::json!({ "require_api_key": false }));
}

#[tokio::test]
async fn get_settings_allows_requests_with_admin_session() {
    let database = TestDatabase::new().unwrap();
    let (app, _) = setup_app(&database).await;

    let request = admin_request("GET", SETTINGS_URI, serde_json::Value::Null);
    let response = app.oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    let body = json_body(response).await;
    assert_eq!(body, serde_json::json!({ "require_api_key": false }));
}

#[tokio::test]
async fn update_settings_requires_admin_session() {
    let database = TestDatabase::new().unwrap();
    let (app, pool) = setup_app(&database).await;
    insert_test_api_key(&pool).await;

    // Anonymous loopback
    let req = with_loopback_client(json_request(
        "POST",
        SETTINGS_URI,
        serde_json::json!({ "require_api_key": true }),
    ));
    let response = app.clone().oneshot(req).await.unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);

    // API key only
    let req = with_loopback_client(json_request_with_headers(
        "PATCH",
        SETTINGS_URI,
        serde_json::json!({ "require_api_key": true }),
        &[("authorization", format!("Bearer {TEST_API_KEY}").as_str())],
    ));
    let response = app.oneshot(req).await.unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn update_settings_toggles_require_api_key_and_persists_settings() {
    let database = TestDatabase::new().unwrap();
    let (app, pool) = setup_app(&database).await;
    insert_test_api_key(&pool).await;

    // 1. POST /v1/settings with require_api_key: true
    let post_req = admin_request(
        "POST",
        SETTINGS_URI,
        serde_json::json!({ "require_api_key": true }),
    );
    let response = app.clone().oneshot(post_req).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    let body = json_body(response).await;
    assert_eq!(body, serde_json::json!({ "require_api_key": true }));

    // 2. Verify that unauthenticated loopback request is now rejected with 401
    let unauth_res = app
        .clone()
        .oneshot(get_request(SETTINGS_URI))
        .await
        .unwrap();
    assert_eq!(unauth_res.status(), StatusCode::UNAUTHORIZED);
    let unauth_body = json_body(unauth_res).await;
    assert_eq!(unauth_body["error"]["code"], "missing_api_key");

    // 3. Verify that authenticated request with API key still succeeds
    let auth_res = app
        .clone()
        .oneshot(api_key_get_request(SETTINGS_URI, TEST_API_KEY))
        .await
        .unwrap();
    assert_eq!(auth_res.status(), StatusCode::OK);

    // 4. GET /v1/settings with admin session verifies persistence
    let get_res = app
        .clone()
        .oneshot(admin_request("GET", SETTINGS_URI, serde_json::Value::Null))
        .await
        .unwrap();
    assert_eq!(get_res.status(), StatusCode::OK);
    let get_body = json_body(get_res).await;
    assert_eq!(get_body, serde_json::json!({ "require_api_key": true }));

    // 5. PATCH /v1/settings turns require_api_key back off
    let turn_off_req = admin_request(
        "PATCH",
        SETTINGS_URI,
        serde_json::json!({ "require_api_key": false }),
    );
    let response = app.clone().oneshot(turn_off_req).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = json_body(response).await;
    assert_eq!(body, serde_json::json!({ "require_api_key": false }));

    // 6. Verify anonymous loopback works again
    let loopback_res = app.oneshot(get_request(SETTINGS_URI)).await.unwrap();
    assert_eq!(loopback_res.status(), StatusCode::OK);
    let loopback_body = json_body(loopback_res).await;
    assert_eq!(
        loopback_body,
        serde_json::json!({ "require_api_key": false })
    );
}

#[tokio::test]
async fn update_settings_rejects_invalid_payloads() {
    let database = TestDatabase::new().unwrap();
    let (app, _) = setup_app(&database).await;

    let invalid_payloads = [
        serde_json::json!("not-an-object"),
        serde_json::json!([1, 2, 3]),
        serde_json::json!({ "require_api_key": "not-a-bool" }),
        serde_json::json!({ "require_api_key": 1 }),
        serde_json::json!({ "require_api_key": null }),
    ];

    for payload in invalid_payloads {
        let post_req = admin_request("POST", SETTINGS_URI, payload.clone());
        let response = app.clone().oneshot(post_req).await.unwrap();
        assert_eq!(
            response.status(),
            StatusCode::BAD_REQUEST,
            "expected 400 for payload: {payload}"
        );
        let body = json_body(response).await;
        assert_eq!(body["error"]["message"], "Invalid settings payload");

        let patch_req = admin_request("PATCH", SETTINGS_URI, payload.clone());
        let response = app.clone().oneshot(patch_req).await.unwrap();
        assert_eq!(
            response.status(),
            StatusCode::BAD_REQUEST,
            "expected 400 for payload: {payload}"
        );
        let body = json_body(response).await;
        assert_eq!(body["error"]["message"], "Invalid settings payload");
    }
}
