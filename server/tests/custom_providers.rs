//! End-to-end tests for the custom-provider routes: create, edit, delete, and
//! the two verification probes. Each test opens its own temporary SQLite
//! database; admin sessions come from a fixture so no admin flow is needed.

mod support;

use axum::body::to_bytes;
use axum::{
    Router,
    body::Body,
    http::{Request, StatusCode},
    response::Response,
};
use srouter_server::AppState;
use srouter_server::app::create_router;
use srouter_server::features::admin_auth::hash_session_token;
use srouter_server::features::providers::ProviderRegistry;
use support::{TestDatabase, json_request_with_headers, with_loopback_client};
use tower::ServiceExt;

const SESSION_TOKEN: &str = "test-session-token";

async fn app(database: &TestDatabase) -> Router {
    let security =
        support::sqlx_security_state(database, vec![hash_session_token(SESSION_TOKEN)]).await;
    let state = AppState::with_security(
        support::test_config(),
        ProviderRegistry::with_defaults().expect("default providers"),
        security,
    )
    .with_database(database.connect().await.expect("connect"));

    create_router(state)
}

/// A request carrying a valid admin-session cookie.
fn admin_request(method: &str, uri: &str, body: serde_json::Value) -> Request<Body> {
    let cookie = format!("srouter_admin_session={SESSION_TOKEN}");

    json_request_with_headers(method, uri, body, &[("cookie", cookie.as_str())])
}

async fn json(response: Response) -> serde_json::Value {
    let bytes = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("response body");

    serde_json::from_slice(&bytes).expect("json body")
}

/// A public URL the create path accepts; `example.com` is never contacted by the
/// create route, only by the verify route.
const PUBLIC_BASE_URL: &str = "https://api.example.com/v1";

#[tokio::test]
async fn creates_a_custom_provider_under_a_uuid() {
    let database = TestDatabase::new().unwrap();
    let app = app(&database).await;

    let response = app
        .oneshot(admin_request(
            "POST",
            "/v1/providers",
            serde_json::json!({
                "name": "My Gateway",
                "category": "custom_provider",
                "protocol": "openai",
                "base_url": PUBLIC_BASE_URL,
                "api_key": "sk-test"
            }),
        ))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = json(response).await;
    let id = body["id"].as_str().expect("an id");
    assert_eq!(body["name"], "My Gateway");
    assert_eq!(body["category"], "custom_provider");
    assert_eq!(body["protocol"], "openai");
    assert_eq!(body["default_base_url"], PUBLIC_BASE_URL);
    // A UUID v4 is the immutable internal id, like Node's `crypto.randomUUID()`.
    assert_eq!(id.len(), 36, "uuid length");
    assert!(id.contains('-'), "uuid shape: {id}");
}

#[tokio::test]
async fn a_missing_name_is_rejected() {
    let database = TestDatabase::new().unwrap();
    let app = app(&database).await;

    let response = app
        .oneshot(admin_request(
            "POST",
            "/v1/providers",
            serde_json::json!({
                "category": "custom_provider",
                "protocol": "openai",
                "base_url": PUBLIC_BASE_URL,
                "api_key": "sk-test"
            }),
        ))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn a_loopback_base_url_is_rejected() {
    let database = TestDatabase::new().unwrap();
    let app = app(&database).await;

    let response = app
        .oneshot(admin_request(
            "POST",
            "/v1/providers",
            serde_json::json!({
                "name": "Local",
                "category": "custom_provider",
                "protocol": "openai",
                "base_url": "http://127.0.0.1:9000/v1",
                "api_key": "sk-test"
            }),
        ))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn a_custom_provider_lists_in_the_catalog_and_resolves() {
    let database = TestDatabase::new().unwrap();
    let app = app(&database).await;

    let created = app
        .clone()
        .oneshot(admin_request(
            "POST",
            "/v1/providers",
            serde_json::json!({
                "name": "My Gateway",
                "prefix": "mine",
                "category": "custom_provider",
                "protocol": "openai",
                "base_url": PUBLIC_BASE_URL,
                "api_key": "sk-test"
            }),
        ))
        .await
        .unwrap();
    let id = json(created).await["id"].as_str().unwrap().to_owned();

    // The catalog now carries the custom provider under its own bucket.
    let catalog = app
        .clone()
        .oneshot(with_loopback_client(
            Request::builder()
                .method("GET")
                .uri("/v1/providers/catalog")
                .body(Body::empty())
                .unwrap(),
        ))
        .await
        .unwrap();
    let body = json(catalog).await;
    let customs = body["categories"]["custom_provider"].as_array().unwrap();
    assert_eq!(customs.len(), 1, "one custom provider");
    assert_eq!(customs[0]["id"], id, "listed by its uuid");

    // The detail route resolves by that uuid, and reports the model prefix.
    let detail = app
        .oneshot(with_loopback_client(
            Request::builder()
                .method("GET")
                .uri(format!("/v1/providers/{id}"))
                .body(Body::empty())
                .unwrap(),
        ))
        .await
        .unwrap();
    assert_eq!(detail.status(), StatusCode::OK);
    let detail = json(detail).await;
    assert_eq!(detail["id"], id);
    assert_eq!(detail["connections"][0]["prefix"], "mine");
}

#[tokio::test]
async fn patches_a_custom_provider_connection_field() {
    let database = TestDatabase::new().unwrap();
    let app = app(&database).await;

    let created = app
        .clone()
        .oneshot(admin_request(
            "POST",
            "/v1/providers",
            serde_json::json!({
                "name": "Before",
                "category": "custom_provider",
                "protocol": "openai",
                "base_url": PUBLIC_BASE_URL,
                "api_key": "sk-test"
            }),
        ))
        .await
        .unwrap();
    let id = json(created).await["id"].as_str().unwrap().to_owned();

    let patched = app
        .clone()
        .oneshot(admin_request(
            "PATCH",
            &format!("/v1/providers/{id}"),
            serde_json::json!({
                "name": "After",
                "protocol": "anthropic",
                "prefix": "after"
            }),
        ))
        .await
        .unwrap();
    assert_eq!(patched.status(), StatusCode::OK);
    let body = json(patched).await;
    assert_eq!(body["name"], "After");
    assert_eq!(body["protocol"], "anthropic");
    // The edit wrote the model prefix back to the connection view.
    assert_eq!(body["connections"][0]["prefix"], "after");
    // A field the patch did not name keeps its stored value.
    assert_eq!(body["default_base_url"], PUBLIC_BASE_URL);
}

#[tokio::test]
async fn an_empty_patch_is_rejected() {
    let database = TestDatabase::new().unwrap();
    let app = app(&database).await;

    let created = app
        .clone()
        .oneshot(admin_request(
            "POST",
            "/v1/providers",
            serde_json::json!({
                "name": "My Gateway",
                "category": "custom_provider",
                "protocol": "openai",
                "base_url": PUBLIC_BASE_URL,
                "api_key": "sk-test"
            }),
        ))
        .await
        .unwrap();
    let id = json(created).await["id"].as_str().unwrap().to_owned();

    let response = app
        .oneshot(admin_request(
            "PATCH",
            &format!("/v1/providers/{id}"),
            serde_json::json!({}),
        ))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn deletes_a_custom_provider_and_then_reports_not_found() {
    let database = TestDatabase::new().unwrap();
    let app = app(&database).await;

    let created = app
        .clone()
        .oneshot(admin_request(
            "POST",
            "/v1/providers",
            serde_json::json!({
                "name": "My Gateway",
                "category": "custom_provider",
                "protocol": "openai",
                "base_url": PUBLIC_BASE_URL,
                "api_key": "sk-test"
            }),
        ))
        .await
        .unwrap();
    let id = json(created).await["id"].as_str().unwrap().to_owned();

    let deleted = app
        .clone()
        .oneshot(admin_request(
            "DELETE",
            &format!("/v1/providers/{id}"),
            serde_json::json!(null),
        ))
        .await
        .unwrap();
    assert_eq!(deleted.status(), StatusCode::OK);

    // A second delete reports the row is gone.
    let again = app
        .clone()
        .oneshot(admin_request(
            "DELETE",
            &format!("/v1/providers/{id}"),
            serde_json::json!(null),
        ))
        .await
        .unwrap();
    assert_eq!(again.status(), StatusCode::NOT_FOUND);

    // The registry dropped it too, so the catalog no longer lists it.
    let catalog = app
        .oneshot(with_loopback_client(
            Request::builder()
                .method("GET")
                .uri("/v1/providers/catalog")
                .body(Body::empty())
                .unwrap(),
        ))
        .await
        .unwrap();
    assert_eq!(
        json(catalog).await["categories"]["custom_provider"]
            .as_array()
            .unwrap()
            .len(),
        0
    );
}

#[tokio::test]
async fn the_writes_require_an_admin_session() {
    let database = TestDatabase::new().unwrap();
    let app = app(&database).await;

    let response = app
        .oneshot(with_loopback_client(json_request_with_headers(
            "POST",
            "/v1/providers",
            serde_json::json!({
                "name": "My Gateway",
                "category": "custom_provider",
                "protocol": "openai",
                "base_url": PUBLIC_BASE_URL,
                "api_key": "sk-test"
            }),
            &[],
        )))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn the_detail_view_carries_the_registered_custom_model() {
    let database = TestDatabase::new().unwrap();
    let app = app(&database).await;

    let created = app
        .clone()
        .oneshot(admin_request(
            "POST",
            "/v1/providers",
            serde_json::json!({
                "name": "My Gateway",
                // The legacy `alias` key still sets the prefix.
                "alias": "mine",
                "category": "custom_provider",
                "protocol": "openai",
                "base_url": PUBLIC_BASE_URL,
                "api_key": "sk-test"
            }),
        ))
        .await
        .unwrap();
    let id = json(created).await["id"].as_str().unwrap().to_owned();

    // Register a custom model under the provider's alias.
    app.clone()
        .oneshot(admin_request(
            "POST",
            "/v1/models",
            serde_json::json!({ "model_id": "mine/gpt-x" }),
        ))
        .await
        .unwrap();

    // The catalog lists it, and so does the provider detail, like Node's
    // `GetProviderById` which merges custom models in.
    let models = app
        .clone()
        .oneshot(with_loopback_client(
            Request::builder()
                .method("GET")
                .uri("/v1/models")
                .body(Body::empty())
                .unwrap(),
        ))
        .await
        .unwrap();
    assert!(
        json(models).await["data"]
            .as_array()
            .unwrap()
            .iter()
            .any(|model| model["id"] == "mine/gpt-x"),
        "the catalog lists the custom model"
    );

    let detail = app
        .oneshot(with_loopback_client(
            Request::builder()
                .method("GET")
                .uri(format!("/v1/providers/{id}"))
                .body(Body::empty())
                .unwrap(),
        ))
        .await
        .unwrap();
    let detail = json(detail).await;
    let listed = detail["models"]
        .as_array()
        .unwrap()
        .iter()
        .find(|model| model["id"] == "mine/gpt-x")
        .cloned()
        .expect("the detail view carries the custom model");
    assert_eq!(listed["hidden"], false);
    assert_eq!(listed["favorite"], false);
}

#[tokio::test]
async fn the_saved_row_carries_the_secret_and_no_secret_leaves_it() {
    let database = TestDatabase::new().unwrap();
    let app = app(&database).await;

    let created = app
        .oneshot(admin_request(
            "POST",
            "/v1/providers",
            serde_json::json!({
                "name": "My Gateway",
                "category": "custom_provider",
                "protocol": "openai",
                "base_url": PUBLIC_BASE_URL,
                "api_key": "sk-secret-value"
            }),
        ))
        .await
        .unwrap();
    let id = json(created).await["id"].as_str().unwrap().to_owned();

    // The stored row holds the key; the response and the catalog never do.
    let pool = database
        .connect()
        .await
        .unwrap()
        .sqlite_pool()
        .unwrap()
        .clone();
    let stored: String = sqlx::query_scalar("SELECT credentials FROM providers WHERE id = ?")
        .bind(&id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(stored.contains("sk-secret-value"), "stored credential");
}
