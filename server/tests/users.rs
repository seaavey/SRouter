//! End-to-end tests for the `/v1/users` admin CRUD. Each test opens its own
//! temporary SQLite database and seeds one admin-session row, because the
//! guard resolves the cookie through the real SQLx session store.

mod support;

use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode},
    response::Response,
};
use serde_json::{Value, json};
use srouter_server::AppState;
use srouter_server::app::create_router;
use srouter_server::clock::now_ms;
use srouter_server::constants;
use srouter_server::features::admin_auth::{
    ADMIN_SESSION_TTL_MS, SessionScope, hash_session_token,
};
use srouter_server::infrastructure::database::users::find_by_token;
use support::{
    TestDatabase, empty_registry_state, json_request, json_request_with_headers,
    sqlx_admin_security_state,
};
use tower::ServiceExt;

const SESSION_TOKEN: &str = "test-session-token";
const USERS: &str = "/v1/users";

async fn admin_state(database: &TestDatabase) -> AppState {
    let security = sqlx_admin_security_state(database).await;
    let now = now_ms();
    security
        .admin_auth
        .create_session(
            &hash_session_token(SESSION_TOKEN),
            now,
            now + ADMIN_SESSION_TTL_MS,
            None,
        )
        .await
        .expect("seed the admin session");

    empty_registry_state(security)
        .with_database(database.connect().await.expect("temporary database"))
}

async fn admin_app(database: &TestDatabase) -> Router {
    create_router(admin_state(database).await)
}

/// A request carrying the seeded admin-session cookie.
fn admin_request(method: &str, uri: &str, body: Value) -> Request<Body> {
    let cookie = format!("srouter_admin_session={SESSION_TOKEN}");

    json_request_with_headers(method, uri, body, &[("cookie", cookie.as_str())])
}

async fn json_body(response: Response) -> Value {
    let bytes = to_bytes(response.into_body(), 65_536).await.unwrap();

    serde_json::from_slice(&bytes).unwrap()
}

async fn send(app: &Router, request: Request<Body>) -> (StatusCode, Value) {
    let response = app.clone().oneshot(request).await.unwrap();
    let status = response.status();

    (status, json_body(response).await)
}

async fn create_user(app: &Router, name: &str) -> (StatusCode, Value) {
    send(app, admin_request("POST", USERS, json!({ "name": name }))).await
}

#[tokio::test]
async fn create_user_returns_the_token_once() {
    let database = TestDatabase::new().unwrap();
    let app = admin_app(&database).await;

    let (status, body) = create_user(&app, "Acme").await;

    assert_eq!(status, StatusCode::CREATED);
    let token = body["token"].as_str().unwrap();
    assert!(token.starts_with("sr-user-"));
    assert_eq!(token.len(), "sr-user-".len() + 32);
    let id = body["id"].as_str().unwrap();
    assert!(id.starts_with("usr_"));
    assert_eq!(id.len(), "usr_".len() + 24);
    assert_eq!(body["name"], "Acme");
    assert_eq!(body["enabled"], true);
    assert_eq!(body["token_prefix"], "sr-user-");
    assert!(body["created_at"].is_i64());

    // The list is the second read of the same row: it carries the prefix and
    // must not repeat the one-time secret.
    let (status, listed) = send(&app, admin_request("GET", USERS, json!({}))).await;
    assert_eq!(status, StatusCode::OK);
    assert!(listed["data"][0].get("token").is_none());

    // The account list is operator data, so the mount must stay closed without
    // the admin cookie.
    let (status, _) = send(
        &app,
        json_request("POST", USERS, json!({ "name": "Mallory" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn list_users_shows_the_prefix_and_never_the_token() {
    let database = TestDatabase::new().unwrap();
    let app = admin_app(&database).await;
    let (_, created) = create_user(&app, "Acme").await;
    let token = created["token"].as_str().unwrap().to_owned();

    let (status, body) = send(&app, admin_request("GET", USERS, json!({}))).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["object"], "list");
    let rows = body["data"].as_array().unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0]["token_prefix"], &token[..8]);
    assert!(rows[0].get("token").is_none());
    assert!(rows[0].get("token_hash").is_none());
}

#[tokio::test]
async fn rotate_token_invalidates_the_old_one() {
    let database = TestDatabase::new().unwrap();
    let app = admin_app(&database).await;
    let (_, created) = create_user(&app, "Acme").await;
    let id = created["id"].as_str().unwrap().to_owned();
    let old_token = created["token"].as_str().unwrap().to_owned();

    let (status, body) = send(
        &app,
        admin_request("POST", &format!("{USERS}/{id}/token"), json!({})),
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    let new_token = body["token"].as_str().unwrap();
    assert_ne!(new_token, old_token);
    assert_eq!(body["token_prefix"], &new_token[..8]);

    let database = database.connect().await.expect("temporary database");
    assert!(
        find_by_token(&database, &hash_session_token(&old_token))
            .await
            .unwrap()
            .is_none()
    );
    let found = find_by_token(&database, &hash_session_token(new_token))
        .await
        .unwrap()
        .expect("the rotated token resolves");
    assert_eq!(found.id, id);
}

#[tokio::test]
async fn update_rejects_an_empty_name() {
    let database = TestDatabase::new().unwrap();
    let app = admin_app(&database).await;
    let (_, created) = create_user(&app, "Acme").await;
    let id = created["id"].as_str().unwrap().to_owned();

    let (status, body) = send(
        &app,
        admin_request("PATCH", &format!("{USERS}/{id}"), json!({ "name": "" })),
    )
    .await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["error"]["message"], constants::users::NAME_EMPTY);

    // A rejected patch must leave the row untouched.
    let (_, listed) = send(&app, admin_request("GET", USERS, json!({}))).await;
    assert_eq!(listed["data"][0]["name"], "Acme");
}

#[tokio::test]
async fn an_unknown_user_id_is_404() {
    let database = TestDatabase::new().unwrap();
    let app = admin_app(&database).await;

    let (status, body) = send(
        &app,
        admin_request(
            "PATCH",
            &format!("{USERS}/usr_missing"),
            json!({ "enabled": false }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(
        body["error"]["message"],
        constants::users::not_found("usr_missing")
    );

    let (status, _) = send(
        &app,
        admin_request("POST", &format!("{USERS}/usr_missing/token"), json!({})),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn disabling_a_user_ends_their_console_sessions() {
    let database = TestDatabase::new().unwrap();
    let state = admin_state(&database).await;
    let app = create_router(state.clone());
    let (_, created) = create_user(&app, "Acme").await;
    let id = created["id"].as_str().unwrap().to_owned();

    let console_token = "customer-console-token";
    let now = now_ms();
    state
        .security
        .admin_auth
        .create_session(
            &hash_session_token(console_token),
            now,
            now + ADMIN_SESSION_TTL_MS,
            Some(&id),
        )
        .await
        .unwrap();
    assert_eq!(
        state
            .security
            .sessions
            .resolve_session(&hash_session_token(console_token), now)
            .await
            .unwrap(),
        Some(SessionScope::User(id.clone()))
    );

    let (status, body) = send(
        &app,
        admin_request(
            "PATCH",
            &format!("{USERS}/{id}"),
            json!({ "enabled": false }),
        ),
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["enabled"], false);
    assert_eq!(
        state
            .security
            .sessions
            .resolve_session(&hash_session_token(console_token), now)
            .await
            .unwrap(),
        None
    );
}
