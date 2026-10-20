//! End-to-end tests for the `/v1/users` admin CRUD. Each test opens its own
//! temporary SQLite database and seeds one admin-session row, because the
//! guard resolves the cookie through the real SQLx session store.

mod support;

use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode, header},
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
use srouter_server::infrastructure::database::AppDatabase;
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

const PORTAL_LOGIN: &str = "/v1/portal/login";
const PORTAL_LOGOUT: &str = "/v1/portal/logout";
const PORTAL_ME: &str = "/v1/portal/me";
const PORTAL_LOGS: &str = "/v1/portal/logs?page=1&limit=50";

fn portal_request(cookie: &str, method: &str, uri: &str, body: Value) -> Request<Body> {
    json_request_with_headers(method, uri, body, &[("cookie", cookie)])
}

/// Signs in and returns the `name=value` cookie pair a browser would send back.
async fn login(app: &Router, token: &str) -> (StatusCode, String, Value) {
    let response = app
        .clone()
        .oneshot(json_request(
            "POST",
            PORTAL_LOGIN,
            json!({ "token": token }),
        ))
        .await
        .unwrap();
    let status = response.status();
    let cookie = response
        .headers()
        .get(header::SET_COOKIE)
        .expect("a successful portal login sets the session cookie")
        .to_str()
        .unwrap()
        .split(';')
        .next()
        .unwrap()
        .to_owned();

    (status, cookie, json_body(response).await)
}

/// Inserts an API key owned by one account. The console never authenticates
/// with this key, so the hash only has to stay unique.
async fn seed_key(database: &AppDatabase, id: &str, user_id: &str) {
    sqlx::query(
        "INSERT INTO api_keys (id, key_hash, key_prefix, name, enabled, user_id, created_at) \
         VALUES (?, ?, 'sr-live-', ?, 1, ?, 1)",
    )
    .bind(id)
    .bind(hash_session_token(id))
    .bind(id)
    .bind(user_id)
    .execute(&database.sqlite_pool().unwrap())
    .await
    .unwrap();
}

/// Inserts one request-log row attributed to a key, the way the gateway stores
/// it: current key ids live in `legacy_api_key_id`, which is what the tenant
/// subquery reads.
async fn seed_log(database: &AppDatabase, id: &str, key_id: &str, status: i64) {
    sqlx::query(
        "INSERT INTO request_logs (id, request_id, method, path, legacy_api_key_id, \
         provider_id, model, status_code, latency_ms, created_at) \
         VALUES (?, ?, 'POST', '/v1/chat/completions', ?, 'opencode_zen', 'test-model', ?, 12, 100)",
    )
    .bind(id)
    .bind(id)
    .bind(key_id)
    .bind(status)
    .execute(&database.sqlite_pool().unwrap())
    .await
    .unwrap();
}

fn log_id(index: u32) -> String {
    format!("00000000-0000-4000-8000-{index:012}")
}

#[tokio::test]
async fn portal_login_sets_a_session_cookie() {
    let database = TestDatabase::new().unwrap();
    let app = admin_app(&database).await;
    let (_, created) = create_user(&app, "Acme").await;
    let token = created["token"].as_str().unwrap();

    let (status, cookie, body) = login(&app, token).await;

    assert_eq!(status, StatusCode::OK);
    assert!(cookie.starts_with("srouter_admin_session="));
    assert_eq!(body["id"], created["id"]);
    assert_eq!(body["name"], "Acme");

    let (status, me) = send(&app, portal_request(&cookie, "GET", PORTAL_ME, json!({}))).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(me["user"]["id"], created["id"]);
    assert_eq!(me["user"]["name"], "Acme");

    let response = app
        .clone()
        .oneshot(portal_request(&cookie, "POST", PORTAL_LOGOUT, json!({})))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    let cleared = response
        .headers()
        .get(header::SET_COOKIE)
        .expect("logout clears the cookie")
        .to_str()
        .unwrap();
    assert!(cleared.contains("Max-Age=0"));

    // Clearing the browser cookie is not enough: the session row must be gone
    // too, or a copied cookie would outlive the sign-out.
    let (status, body) = send(&app, portal_request(&cookie, "GET", PORTAL_ME, json!({}))).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(body["error"]["message"], constants::portal::AUTH_REQUIRED);
}

#[tokio::test]
async fn a_wrong_token_is_401_and_six_failures_are_429() {
    let database = TestDatabase::new().unwrap();
    let app = admin_app(&database).await;

    for _ in 0..5 {
        let (status, body) = send(
            &app,
            json_request("POST", PORTAL_LOGIN, json!({ "token": "sr-user-wrong" })),
        )
        .await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
        assert_eq!(body["error"]["message"], constants::portal::INVALID_TOKEN);
        assert_eq!(body["error"]["code"], "invalid_credentials");
    }

    let (status, body) = send(
        &app,
        json_request("POST", PORTAL_LOGIN, json!({ "token": "sr-user-wrong" })),
    )
    .await;
    assert_eq!(status, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(
        body["error"]["message"],
        constants::portal::TOO_MANY_ATTEMPTS
    );
    assert_eq!(body["error"]["code"], "login_rate_limited");
}

#[tokio::test]
async fn portal_me_lists_only_the_callers_keys() {
    let database = TestDatabase::new().unwrap();
    let app = admin_app(&database).await;
    let (_, acme) = create_user(&app, "Acme").await;
    let (_, globex) = create_user(&app, "Globex").await;
    let database = database.connect().await.expect("temporary database");
    seed_key(&database, "key_acme", acme["id"].as_str().unwrap()).await;
    seed_key(&database, "key_globex", globex["id"].as_str().unwrap()).await;

    let (_, acme_cookie, _) = login(&app, acme["token"].as_str().unwrap()).await;
    let (status, me) = send(
        &app,
        portal_request(&acme_cookie, "GET", PORTAL_ME, json!({})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let keys = me["keys"].as_array().unwrap();
    assert_eq!(keys.len(), 1);
    assert_eq!(keys[0]["id"], "key_acme");

    let (_, globex_cookie, _) = login(&app, globex["token"].as_str().unwrap()).await;
    let (status, me) = send(
        &app,
        portal_request(&globex_cookie, "GET", PORTAL_ME, json!({})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let keys = me["keys"].as_array().unwrap();
    assert_eq!(keys.len(), 1);
    assert_eq!(keys[0]["id"], "key_globex");
}

#[tokio::test]
async fn portal_logs_count_only_the_callers_rows() {
    let database = TestDatabase::new().unwrap();
    let app = admin_app(&database).await;
    let (_, acme) = create_user(&app, "Acme").await;
    let (_, globex) = create_user(&app, "Globex").await;
    let database = database.connect().await.expect("temporary database");
    for (key_id, user) in [
        ("key_acme_1", &acme),
        ("key_acme_2", &acme),
        ("key_globex_1", &globex),
        ("key_globex_2", &globex),
    ] {
        seed_key(&database, key_id, user["id"].as_str().unwrap()).await;
    }
    seed_log(&database, &log_id(1), "key_acme_1", 200).await;
    seed_log(&database, &log_id(2), "key_acme_1", 500).await;
    seed_log(&database, &log_id(3), "key_acme_2", 200).await;
    seed_log(&database, &log_id(4), "key_globex_1", 200).await;
    seed_log(&database, &log_id(5), "key_globex_2", 200).await;

    let (_, acme_cookie, _) = login(&app, acme["token"].as_str().unwrap()).await;
    let (status, page) = send(
        &app,
        portal_request(&acme_cookie, "GET", PORTAL_LOGS, json!({})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(page["pagination"]["total"], 3);
    assert_eq!(page["data"].as_array().unwrap().len(), 3);

    let (_, globex_cookie, _) = login(&app, globex["token"].as_str().unwrap()).await;
    let (status, page) = send(
        &app,
        portal_request(&globex_cookie, "GET", PORTAL_LOGS, json!({})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(page["pagination"]["total"], 2);
    assert_eq!(page["data"].as_array().unwrap().len(), 2);

    // The operator read is unscoped. A tenant bind landing in the wrong
    // position would silently shrink this total as well.
    let (status, all) = send(
        &app,
        admin_request("GET", "/v1/logs?page=1&limit=50", json!({})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(all["pagination"]["total"], 5);
    assert_eq!(all["data"].as_array().unwrap().len(), 5);
}

#[tokio::test]
async fn a_user_without_keys_sees_an_empty_console() {
    let database = TestDatabase::new().unwrap();
    let app = admin_app(&database).await;
    let (_, created) = create_user(&app, "Acme").await;

    let (_, cookie, _) = login(&app, created["token"].as_str().unwrap()).await;

    let (status, me) = send(&app, portal_request(&cookie, "GET", PORTAL_ME, json!({}))).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(me["keys"].as_array().unwrap().len(), 0);

    let (status, logs) = send(&app, portal_request(&cookie, "GET", PORTAL_LOGS, json!({}))).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(logs["pagination"]["total"], 0);
    assert_eq!(logs["data"].as_array().unwrap().len(), 0);
}

#[tokio::test]
async fn a_user_session_is_refused_on_admin_routes() {
    let database = TestDatabase::new().unwrap();
    let app = admin_app(&database).await;
    let (_, created) = create_user(&app, "Acme").await;

    let (_, cookie, _) = login(&app, created["token"].as_str().unwrap()).await;

    for uri in ["/v1/keys", "/v1/users", "/v1/admin/system"] {
        let (status, body) = send(&app, portal_request(&cookie, "GET", uri, json!({}))).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED, "{uri}");
        assert_eq!(body["error"]["message"], constants::admin::AUTH_REQUIRED);
        assert_eq!(body["error"]["code"], "authentication_required");
    }
}

#[tokio::test]
async fn an_admin_session_is_refused_on_the_portal() {
    let database = TestDatabase::new().unwrap();
    let app = admin_app(&database).await;

    for uri in [PORTAL_ME, PORTAL_LOGS] {
        let (status, body) = send(&app, admin_request("GET", uri, json!({}))).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED, "{uri}");
        assert_eq!(body["error"]["message"], constants::portal::AUTH_REQUIRED);
        assert_eq!(body["error"]["code"], "authentication_required");
    }
}
