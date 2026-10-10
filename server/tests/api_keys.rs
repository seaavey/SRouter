//! End-to-end tests for the `/v1/keys` management routes. Each test opens its
//! own temporary SQLite database through the real SQLx store; admin sessions
//! come from a fixture so no admin flow is needed.

mod support;

use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode},
    response::Response,
};
use srouter_server::app::create_router;
use srouter_server::features::admin_auth::hash_session_token;
use srouter_server::features::api_keys::APIKeyRepository;
use srouter_server::infrastructure::database::api_keys::SQLxAPIKeyStore;
use support::{
    TestDatabase, empty_registry_state, json_request, json_request_with_headers,
    sqlx_security_state,
};
use tower::ServiceExt;

const SESSION_TOKEN: &str = "test-session-token";
const KEYS: &str = "/v1/keys";

async fn admin_app(database: &TestDatabase) -> Router {
    let security = sqlx_security_state(database, vec![hash_session_token(SESSION_TOKEN)]).await;

    create_router(empty_registry_state(security))
}

/// A request carrying a valid admin-session cookie.
fn admin_request(method: &str, uri: &str, body: serde_json::Value) -> Request<Body> {
    let cookie = format!("srouter_admin_session={SESSION_TOKEN}");

    json_request_with_headers(method, uri, body, &[("cookie", cookie.as_str())])
}

async fn json_body(response: Response) -> serde_json::Value {
    let bytes = to_bytes(response.into_body(), 65_536).await.unwrap();

    serde_json::from_slice(&bytes).unwrap()
}

async fn create_key(app: &Router, body: serde_json::Value) -> (StatusCode, serde_json::Value) {
    let response = app
        .clone()
        .oneshot(admin_request("POST", KEYS, body))
        .await
        .unwrap();
    let status = response.status();

    (status, json_body(response).await)
}

#[tokio::test]
async fn create_returns_the_full_secret_once_with_defaults() {
    let database = TestDatabase::new().unwrap();
    let app = admin_app(&database).await;

    let (status, body) = create_key(&app, serde_json::json!({ "name": "Client Key" })).await;

    assert_eq!(status, StatusCode::CREATED);
    assert!(body["id"].as_str().unwrap().starts_with("key_"));
    assert!(body["key"].as_str().unwrap().starts_with("sr-live-"));
    assert_eq!(body["key_prefix"], "sr-live-");
    assert_eq!(body["name"], "Client Key");
    assert_eq!(body["enabled"], true);
    assert_eq!(body["rate_limit"], 0);
    assert_eq!(body["quota_limit"], 0);
    assert_eq!(body["usage_tokens"], 0);
    assert_eq!(body["credit_limit"], 0.0);
    assert_eq!(body["usage_cost"], 0.0);
    assert_eq!(body["allowed_models"], serde_json::Value::Null);
    assert!(body["created_at"].as_i64().unwrap() > 0);
}

#[tokio::test]
async fn list_returns_stored_keys_without_the_secret() {
    let database = TestDatabase::new().unwrap();
    let app = admin_app(&database).await;
    let (_, created) = create_key(&app, serde_json::json!({ "name": "Listed Key" })).await;

    let response = app
        .oneshot(admin_request("GET", KEYS, serde_json::json!(null)))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = json_body(response).await;
    assert_eq!(body["object"], "list");
    let keys = body["data"].as_array().unwrap();
    assert_eq!(keys.len(), 1);
    assert_eq!(keys[0]["id"], created["id"]);
    assert_eq!(keys[0]["key_prefix"], "sr-live-");
    assert!(keys[0].get("key").is_none());
}

#[tokio::test]
async fn patch_updates_fields_and_reports_a_missing_key() {
    let database = TestDatabase::new().unwrap();
    let app = admin_app(&database).await;
    let (_, created) = create_key(&app, serde_json::json!({ "name": "Before" })).await;
    let id = created["id"].as_str().unwrap().to_owned();

    let response = app
        .clone()
        .oneshot(admin_request(
            "PATCH",
            &format!("{KEYS}/{id}"),
            serde_json::json!({ "name": "After", "enabled": false, "rate_limit": 60 }),
        ))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = json_body(response).await;
    assert_eq!(body["name"], "After");
    assert_eq!(body["enabled"], false);
    assert_eq!(body["rate_limit"], 60);

    let missing = app
        .oneshot(admin_request(
            "PATCH",
            &format!("{KEYS}/key_missing"),
            serde_json::json!({ "enabled": true }),
        ))
        .await
        .unwrap();
    assert_eq!(missing.status(), StatusCode::NOT_FOUND);
    let body = json_body(missing).await;
    assert_eq!(body["error"]["message"], "Key 'key_missing' not found");
    assert_eq!(body["error"]["type"], "invalid_request_error");
}

#[tokio::test]
async fn credit_adds_to_an_existing_key_and_rejects_bad_amounts() {
    let database = TestDatabase::new().unwrap();
    let app = admin_app(&database).await;
    let (_, created) = create_key(
        &app,
        serde_json::json!({ "name": "Credit Key", "credit_limit": 10.0 }),
    )
    .await;
    let id = created["id"].as_str().unwrap().to_owned();

    let response = app
        .clone()
        .oneshot(admin_request(
            "POST",
            &format!("{KEYS}/{id}/credit"),
            serde_json::json!({ "amount": 15.0 }),
        ))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = json_body(response).await;
    assert_eq!(body["credit_limit"], 25.0);

    let rejected = app
        .clone()
        .oneshot(admin_request(
            "POST",
            &format!("{KEYS}/{id}/credit"),
            serde_json::json!({ "amount": -5.0 }),
        ))
        .await
        .unwrap();
    assert_eq!(rejected.status(), StatusCode::BAD_REQUEST);

    let missing = app
        .oneshot(admin_request(
            "POST",
            &format!("{KEYS}/key_missing/credit"),
            serde_json::json!({ "amount": 1.0 }),
        ))
        .await
        .unwrap();
    assert_eq!(missing.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn delete_revokes_a_key_and_then_reports_it_missing() {
    let database = TestDatabase::new().unwrap();
    let app = admin_app(&database).await;
    let (_, created) = create_key(&app, serde_json::json!({ "name": "Doomed" })).await;
    let id = created["id"].as_str().unwrap().to_owned();

    let deleted = app
        .clone()
        .oneshot(admin_request(
            "DELETE",
            &format!("{KEYS}/{id}"),
            serde_json::json!(null),
        ))
        .await
        .unwrap();
    assert_eq!(deleted.status(), StatusCode::OK);
    let body = json_body(deleted).await;
    assert_eq!(body["message"], "API Key revoked and deleted successfully");

    let again = app
        .oneshot(admin_request(
            "DELETE",
            &format!("{KEYS}/{id}"),
            serde_json::json!(null),
        ))
        .await
        .unwrap();
    assert_eq!(again.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn an_allowlist_round_trips_through_create_and_patch() {
    let database = TestDatabase::new().unwrap();
    let app = admin_app(&database).await;
    let (_, created) = create_key(
        &app,
        serde_json::json!({ "name": "Scoped", "allowed_models": ["gpt-4o"] }),
    )
    .await;
    let id = created["id"].as_str().unwrap().to_owned();
    assert_eq!(created["allowed_models"], serde_json::json!(["gpt-4o"]));

    let cleared = app
        .oneshot(admin_request(
            "PATCH",
            &format!("{KEYS}/{id}"),
            serde_json::json!({ "allowed_models": null }),
        ))
        .await
        .unwrap();
    assert_eq!(cleared.status(), StatusCode::OK);
    let body = json_body(cleared).await;
    assert_eq!(body["allowed_models"], serde_json::Value::Null);
}

#[tokio::test]
async fn an_empty_allowlist_is_stored_and_reported_as_null() {
    let database = TestDatabase::new().unwrap();
    let app = admin_app(&database).await;

    let (_, created) = create_key(
        &app,
        serde_json::json!({ "name": "Unrestricted", "allowed_models": [] }),
    )
    .await;
    let id = created["id"].as_str().unwrap().to_owned();
    assert_eq!(created["allowed_models"], serde_json::Value::Null);

    let restricted = app
        .clone()
        .oneshot(admin_request(
            "PATCH",
            &format!("{KEYS}/{id}"),
            serde_json::json!({ "allowed_models": ["gpt-4o"] }),
        ))
        .await
        .unwrap();
    let body = json_body(restricted).await;
    assert_eq!(body["allowed_models"], serde_json::json!(["gpt-4o"]));

    // `[]` clears an allowlist exactly like an explicit `null`, in the response
    // and in the stored row; Node writes `NULL` for both.
    let cleared = app
        .clone()
        .oneshot(admin_request(
            "PATCH",
            &format!("{KEYS}/{id}"),
            serde_json::json!({ "allowed_models": [] }),
        ))
        .await
        .unwrap();
    let body = json_body(cleared).await;
    assert_eq!(body["allowed_models"], serde_json::Value::Null);

    let stored: Option<String> =
        sqlx::query_scalar("SELECT allowed_models FROM api_keys WHERE id = ?")
            .bind(&id)
            .fetch_one(&database.connect().await.unwrap().sqlite_pool().unwrap())
            .await
            .unwrap();
    assert_eq!(stored, None);

    let listed = app
        .oneshot(admin_request("GET", KEYS, serde_json::json!(null)))
        .await
        .unwrap();
    let body = json_body(listed).await;
    assert_eq!(body["data"][0]["allowed_models"], serde_json::Value::Null);
}

#[tokio::test]
async fn requests_without_an_admin_session_are_rejected() {
    let database = TestDatabase::new().unwrap();
    let app = admin_app(&database).await;

    let response = app
        .oneshot(json_request("GET", KEYS, serde_json::json!(null)))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    let body = json_body(response).await;
    assert_eq!(body["error"]["message"], "Admin authentication is required");
    assert_eq!(body["error"]["code"], "authentication_required");
    assert_eq!(body["error"]["type"], "authentication_error");
}

#[tokio::test]
async fn an_api_key_does_not_authorize_management() {
    let database = TestDatabase::new().unwrap();
    let app = admin_app(&database).await;

    let response = app
        .oneshot(json_request_with_headers(
            "GET",
            KEYS,
            serde_json::json!(null),
            &[("x-api-key", "sr-live-whatever")],
        ))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn a_created_key_authenticates_the_gateway() {
    let database = TestDatabase::new().unwrap();
    let app = admin_app(&database).await;
    let (_, created) = create_key(&app, serde_json::json!({ "name": "Gateway Key" })).await;
    let secret = created["key"].as_str().unwrap();

    // The empty provider registry turns a request that passed auth into a 404,
    // so 404 (rather than 401) proves the hashed lookup found the new key.
    let response = app
        .oneshot(json_request_with_headers(
            "POST",
            "/v1/chat/completions",
            serde_json::json!({
                "model": "space-bunny-free",
                "messages": [ { "role": "user", "content": "hi" } ]
            }),
            &[("x-api-key", secret)],
        ))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn create_rejects_a_missing_name() {
    let database = TestDatabase::new().unwrap();
    let app = admin_app(&database).await;

    let (status, body) = create_key(&app, serde_json::json!({})).await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["error"]["message"], "Field 'name' is required");
}

/// The quota accounting the gateway runs against the real SQLx repository:
/// reserve is atomic with the limit check, settle adjusts to actual usage, and
/// increment records tokens and cost.
#[tokio::test]
async fn quota_reservation_settlement_and_increment_update_usage() {
    let database = TestDatabase::new().unwrap();
    let app = admin_app(&database).await;
    let (_, body) = create_key(
        &app,
        serde_json::json!({ "name": "Quota Key", "quota_limit": 100 }),
    )
    .await;
    let id = body["id"].as_str().unwrap().to_owned();

    let repository = SQLxAPIKeyStore::new(database.connect().await.unwrap());

    // 60 fits; a further 50 would exceed the 100 limit and is refused.
    assert!(repository.reserve_quota(&id, 60).await.unwrap());
    assert!(!repository.reserve_quota(&id, 50).await.unwrap());

    // Settling to the actual 40 returns the unused 20.
    repository.settle_quota(&id, 60, 40).await.unwrap();
    repository.increment_usage(&id, 5, 0.25).await.unwrap();

    let key = repository
        .list()
        .await
        .unwrap()
        .into_iter()
        .find(|key| key.id == id)
        .expect("the stored key");
    assert_eq!(key.usage_tokens, 45);
    assert_eq!(key.usage_cost, 0.25);
}

#[tokio::test]
async fn an_unlimited_key_reserves_any_budget() {
    let database = TestDatabase::new().unwrap();
    let app = admin_app(&database).await;
    let (_, body) = create_key(&app, serde_json::json!({ "name": "Unlimited" })).await;
    let id = body["id"].as_str().unwrap().to_owned();

    let repository = SQLxAPIKeyStore::new(database.connect().await.unwrap());
    assert!(repository.reserve_quota(&id, 10_000).await.unwrap());
    repository.settle_quota(&id, 10_000, 0).await.unwrap();

    let key = repository
        .list()
        .await
        .unwrap()
        .into_iter()
        .find(|key| key.id == id)
        .expect("the stored key");
    assert_eq!(key.usage_tokens, 0);
}
