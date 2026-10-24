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
use srouter_server::constants;
use srouter_server::features::admin_auth::hash_session_token;
use srouter_server::features::api_keys::APIKeyRepository;
use srouter_server::infrastructure::database::api_keys::{
    SQLxAPIKeyStore, reconcile_usage_from_logs,
};
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

/// Admin app with a database attached, for the ownership tests: creating a
/// customer is an operator route, so it needs `state.database`.
async fn admin_app_with_users(database: &TestDatabase) -> Router {
    let security = sqlx_security_state(database, vec![hash_session_token(SESSION_TOKEN)]).await;

    create_router(
        empty_registry_state(security)
            .with_database(database.connect().await.expect("temporary database")),
    )
}

/// Creates a customer through the admin route so the ownership check runs
/// against a real `users` row.
async fn create_user(app: &Router, name: &str) -> String {
    let response = app
        .clone()
        .oneshot(admin_request(
            "POST",
            "/v1/users",
            serde_json::json!({ "name": name }),
        ))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::CREATED);
    let body = json_body(response).await;

    body["id"].as_str().unwrap().to_owned()
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
async fn auth_cache_invalidates_immediately_on_key_modification() {
    let database = TestDatabase::new().unwrap();
    let security = sqlx_security_state(&database, vec![hash_session_token(SESSION_TOKEN)]).await;
    let app = create_router(empty_registry_state(security.clone()));
    let (_, created) = create_key(&app, serde_json::json!({ "name": "Cache Test Key" })).await;
    let id = created["id"].as_str().unwrap();
    let secret = created["key"].as_str().unwrap();

    // Authenticate once to populate the cache
    let record1 = security
        .api_keys
        .find_by_key(secret)
        .await
        .unwrap()
        .unwrap();
    assert!(record1.enabled);

    // Disable the key via admin patch route
    let patch_body = serde_json::json!({ "enabled": false });
    let response = app
        .clone()
        .oneshot(admin_request("PATCH", &format!("{KEYS}/{id}"), patch_body))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    // The auth cache must be invalidated and reflect disabled immediately
    let record2 = security
        .api_keys
        .find_by_key(secret)
        .await
        .unwrap()
        .unwrap();
    assert!(!record2.enabled);
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
async fn a_key_can_belong_to_a_user() {
    let database = TestDatabase::new().unwrap();
    let app = admin_app_with_users(&database).await;
    let user_id = create_user(&app, "Acme").await;

    let (status, created) = create_key(
        &app,
        serde_json::json!({ "name": "Acme Key", "user_id": user_id }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(created["user_id"], user_id);
    let id = created["id"].as_str().unwrap().to_owned();

    let listed = app
        .clone()
        .oneshot(admin_request("GET", KEYS, serde_json::json!(null)))
        .await
        .unwrap();
    assert_eq!(listed.status(), StatusCode::OK);
    let body = json_body(listed).await;
    assert_eq!(body["data"][0]["user_id"], user_id);

    let patched = app
        .oneshot(admin_request(
            "PATCH",
            &format!("{KEYS}/{id}"),
            serde_json::json!({ "name": "Acme Key 2" }),
        ))
        .await
        .unwrap();
    assert_eq!(patched.status(), StatusCode::OK);
    let body = json_body(patched).await;
    assert_eq!(body["name"], "Acme Key 2");
    assert_eq!(body["user_id"], user_id);
}

#[tokio::test]
async fn an_unknown_owner_is_400() {
    let database = TestDatabase::new().unwrap();
    let app = admin_app_with_users(&database).await;

    let (status, body) = create_key(
        &app,
        serde_json::json!({ "name": "Orphan", "user_id": "usr_missing" }),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(
        body["error"]["message"],
        constants::users::not_found("usr_missing")
    );

    // The same check guards a reassignment; the rejected patch must not write.
    let (_, created) = create_key(&app, serde_json::json!({ "name": "Owned" })).await;
    let id = created["id"].as_str().unwrap();
    let response = app
        .clone()
        .oneshot(admin_request(
            "PATCH",
            &format!("{KEYS}/{id}"),
            serde_json::json!({ "user_id": "usr_missing", "name": "Rewritten" }),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let body = json_body(response).await;
    assert_eq!(
        body["error"]["message"],
        constants::users::not_found("usr_missing")
    );

    let response = app
        .oneshot(admin_request("GET", KEYS, serde_json::json!(null)))
        .await
        .unwrap();
    let body = json_body(response).await;
    assert_eq!(body["data"][0]["name"], "Owned");
    assert_eq!(body["data"][0]["user_id"], serde_json::Value::Null);
}

#[tokio::test]
async fn clearing_the_owner_is_allowed() {
    let database = TestDatabase::new().unwrap();
    let app = admin_app_with_users(&database).await;
    let user_id = create_user(&app, "Acme").await;
    let (_, created) = create_key(
        &app,
        serde_json::json!({ "name": "Acme Key", "user_id": user_id }),
    )
    .await;
    let id = created["id"].as_str().unwrap().to_owned();

    let response = app
        .clone()
        .oneshot(admin_request(
            "PATCH",
            &format!("{KEYS}/{id}"),
            serde_json::json!({ "user_id": null }),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        json_body(response).await["user_id"],
        serde_json::Value::Null
    );

    let listed = app
        .oneshot(admin_request("GET", KEYS, serde_json::json!(null)))
        .await
        .unwrap();
    let body = json_body(listed).await;
    assert_eq!(body["data"][0]["user_id"], serde_json::Value::Null);
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

/// One completed chat request must bill the key once. The request-log insert and
/// the quota settlement both used to write `usage_tokens`, so a 3-token answer
/// left 6 tokens on the key.
#[tokio::test]
async fn a_completed_chat_request_bills_the_key_exactly_once() {
    use std::sync::Arc;

    use srouter_server::SecurityState;
    use srouter_server::features::api_keys::{APIKeyRepository, CreateAPIKeyInput};
    use srouter_server::infrastructure::database::admin_auth::SQLxAdminAuthStore;
    use support::{app_state_with_fake_upstream_and_security, with_loopback_client};

    let database = TestDatabase::new().unwrap();
    let app_database = database.connect().await.unwrap();

    let keys = Arc::new(SQLxAPIKeyStore::new(app_database.clone()));
    let created = keys
        .create(CreateAPIKeyInput {
            name: "Billed once".to_owned(),
            user_id: None,
            enabled: true,
            rate_limit: 0,
            quota_limit: 1_000_000,
            credit_limit: 0.0,
            allowed_models: None,
        })
        .await
        .unwrap();

    let security = SecurityState::with_repository(
        keys.clone(),
        Arc::new(SQLxAdminAuthStore::new(app_database.clone())),
        keys.clone(),
    );
    let (_upstream, state) = app_state_with_fake_upstream_and_security(security).await;
    let app = create_router(state.with_database(app_database));

    let body = serde_json::json!({
        "model": "opencode_zen/space-bunny-free",
        "messages": [{ "role": "user", "content": "Hello" }]
    });
    let request = with_loopback_client(
        Request::builder()
            .method("POST")
            .uri("/v1/chat/completions")
            .header("content-type", "application/json")
            .header("authorization", format!("Bearer {}", created.secret))
            .body(Body::from(serde_json::to_vec(&body).unwrap()))
            .unwrap(),
    );

    let response = app.oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    let stored = keys
        .list()
        .await
        .unwrap()
        .into_iter()
        .find(|key| key.id == created.key.id)
        .expect("the stored key");

    // The fake upstream answers with 3 total tokens; the reservation was 4096.
    assert_eq!(
        stored.usage_tokens, 3,
        "one request must bill its own tokens once, not twice"
    );
}

/// The Anthropic route reserves no budget, so it used to bill nothing at all:
/// `usage_tokens` and `usage_cost` stayed at zero for every `/v1/messages`
/// request while the request log recorded its tokens.
#[tokio::test]
async fn a_completed_anthropic_request_bills_the_key() {
    use std::sync::Arc;

    use srouter_server::SecurityState;
    use srouter_server::features::api_keys::{APIKeyRepository, CreateAPIKeyInput};
    use srouter_server::infrastructure::database::admin_auth::SQLxAdminAuthStore;
    use support::{app_state_with_fake_upstream_and_security, with_loopback_client};

    let database = TestDatabase::new().unwrap();
    let app_database = database.connect().await.unwrap();

    let keys = Arc::new(SQLxAPIKeyStore::new(app_database.clone()));
    let created = keys
        .create(CreateAPIKeyInput {
            name: "Anthropic route".to_owned(),
            user_id: None,
            enabled: true,
            rate_limit: 0,
            quota_limit: 1_000_000,
            credit_limit: 0.0,
            allowed_models: None,
        })
        .await
        .unwrap();

    let security = SecurityState::with_repository(
        keys.clone(),
        Arc::new(SQLxAdminAuthStore::new(app_database.clone())),
        keys.clone(),
    );
    let (_upstream, state) = app_state_with_fake_upstream_and_security(security).await;
    let app = create_router(state.with_database(app_database));

    let body = serde_json::json!({
        "model": "opencode_zen/space-bunny-free",
        "max_tokens": 1024,
        "messages": [{ "role": "user", "content": "Hello" }]
    });
    let request = with_loopback_client(
        Request::builder()
            .method("POST")
            .uri("/v1/messages")
            .header("content-type", "application/json")
            .header("anthropic-version", "2023-06-01")
            .header("authorization", format!("Bearer {}", created.secret))
            .body(Body::from(serde_json::to_vec(&body).unwrap()))
            .unwrap(),
    );

    let response = app.oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    let stored = keys
        .list()
        .await
        .unwrap()
        .into_iter()
        .find(|key| key.id == created.key.id)
        .expect("the stored key");

    assert_eq!(
        stored.usage_tokens, 3,
        "a route without a reservation must still bill its tokens"
    );
}

/// The boot repair raises a key whose counters are behind its own request log
/// and leaves a key that is ahead untouched: one-way, so a key billed by an
/// older path never has quota refunded behind the operator's back.
#[tokio::test]
async fn reconcile_raises_usage_to_the_request_log_and_never_lowers_it() {
    use std::sync::Arc;

    use srouter_server::features::api_keys::{APIKeyRepository, CreateAPIKeyInput};
    use srouter_server::infrastructure::database::request_logs::{
        RequestLogInput, insert_request_log,
    };
    use srouter_server::protocol::usage::UsageBreakdown;

    let database = TestDatabase::new().unwrap();
    let app_database = database.connect().await.unwrap();
    let keys = Arc::new(SQLxAPIKeyStore::new(app_database.clone()));

    let behind = keys
        .create(CreateAPIKeyInput {
            name: "Behind".to_owned(),
            user_id: None,
            enabled: true,
            rate_limit: 0,
            quota_limit: 1_000_000,
            credit_limit: 0.0,
            allowed_models: None,
        })
        .await
        .unwrap()
        .key;
    let ahead = keys
        .create(CreateAPIKeyInput {
            name: "Ahead".to_owned(),
            user_id: None,
            enabled: true,
            rate_limit: 0,
            quota_limit: 1_000_000,
            credit_limit: 0.0,
            allowed_models: None,
        })
        .await
        .unwrap()
        .key;

    let usage = UsageBreakdown {
        prompt_tokens: 100,
        completion_tokens: 20,
        total_tokens: 120,
        ..UsageBreakdown::default()
    };
    for (key_id, status_code) in [(&behind.id, 200), (&behind.id, 200), (&behind.id, 500)] {
        insert_request_log(
            &app_database,
            RequestLogInput {
                request_id: "00000000-0000-4000-8000-0000000000bb",
                method: "POST",
                path: "/v1/messages",
                api_key_id: Some(key_id),
                user_id: None,
                ip_address: None,
                user_agent: None,
                provider_id: "openai",
                model: "gpt-4o",
                status_code,
                latency_ms: 1,
                usage: &usage,
                estimated_cost: 0.5,
                resolved_model: None,
                error_code: None,
                error_message: None,
                upstream_status: None,
                created_at: 1_700_000_000_000,
            },
        )
        .await
        .expect("insert log");
    }

    // The key that is ahead of its log keeps its higher counter.
    keys.increment_usage(&ahead.id, 9_999, 12.5).await.unwrap();

    let raised = reconcile_usage_from_logs(&app_database).await.unwrap();
    assert_eq!(raised, 1, "only the key behind its log is raised");

    let stored = |id: &str| {
        let keys = keys.clone();
        let id = id.to_owned();

        async move {
            keys.list()
                .await
                .unwrap()
                .into_iter()
                .find(|key| key.id == id)
                .expect("the stored key")
        }
    };

    // Two successful rows at 120 tokens and 0.5 each; the failed row bills nothing.
    let repaired = stored(&behind.id).await;
    assert_eq!(repaired.usage_tokens, 240);
    assert_eq!(repaired.usage_cost, 1.0);

    let untouched = stored(&ahead.id).await;
    assert_eq!(untouched.usage_tokens, 9_999);
    assert_eq!(untouched.usage_cost, 12.5);
}

/// The auth cache carries `usage_tokens`, and `api_key_auth` rejects on it, so a
/// usage write has to invalidate the cached record. Otherwise an exhausted key
/// keeps authenticating until the process restarts.
#[tokio::test]
async fn a_usage_write_invalidates_the_cached_auth_record() {
    use std::sync::Arc;

    use srouter_server::features::api_keys::{APIKeyRepository, APIKeyStore, CreateAPIKeyInput};

    let database = TestDatabase::new().unwrap();
    let store = Arc::new(SQLxAPIKeyStore::new(database.connect().await.unwrap()));

    let created = store
        .create(CreateAPIKeyInput {
            name: "Quota".to_owned(),
            user_id: None,
            enabled: true,
            rate_limit: 0,
            quota_limit: 100,
            credit_limit: 0.0,
            allowed_models: None,
        })
        .await
        .unwrap();

    // Authenticate once, which caches the record at zero usage.
    let cached = store.find_by_key(&created.secret).await.unwrap().unwrap();
    assert_eq!(cached.usage_tokens, 0.0);

    // The gateway's accounting pushes the key past its quota.
    store.reserve_quota(&created.key.id, 80).await.unwrap();
    store.settle_quota(&created.key.id, 80, 150).await.unwrap();

    let refreshed = store.find_by_key(&created.secret).await.unwrap().unwrap();
    assert_eq!(
        refreshed.usage_tokens, 150.0,
        "the cached record must not keep serving the pre-request count"
    );
    assert!(refreshed.usage_tokens >= refreshed.quota_limit);
}

/// A cost write feeds the credit check, so it invalidates the cache too.
#[tokio::test]
async fn a_cost_write_invalidates_the_cached_auth_record() {
    use std::sync::Arc;

    use srouter_server::features::api_keys::{APIKeyRepository, APIKeyStore, CreateAPIKeyInput};

    let database = TestDatabase::new().unwrap();
    let store = Arc::new(SQLxAPIKeyStore::new(database.connect().await.unwrap()));

    let created = store
        .create(CreateAPIKeyInput {
            name: "Credit".to_owned(),
            user_id: None,
            enabled: true,
            rate_limit: 0,
            quota_limit: 0,
            credit_limit: 5.0,
            allowed_models: None,
        })
        .await
        .unwrap();

    let cached = store.find_by_key(&created.secret).await.unwrap().unwrap();
    assert_eq!(cached.usage_cost, 0.0);

    store
        .increment_usage(&created.key.id, 0, 7.5)
        .await
        .unwrap();

    let refreshed = store.find_by_key(&created.secret).await.unwrap().unwrap();
    assert_eq!(refreshed.usage_cost, 7.5);
    assert!(refreshed.usage_cost >= refreshed.credit_limit);
}
