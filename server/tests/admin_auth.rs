//! End-to-end tests for `/v1/admin/*` against a temporary SQLite database.
//! Requests carry an explicit loopback or public peer address so the
//! setup-loopback rule and the login throttle are exercised for real.

mod support;

use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode, header},
    response::Response,
};
use srouter_server::app::create_router;
use support::{
    TestDatabase, empty_registry_state, json_request, json_request_with_headers,
    sqlx_admin_security_state, with_loopback_client, with_remote_client,
};
use tower::ServiceExt;

const SETUP: &str = "/v1/admin/setup";
const LOGIN: &str = "/v1/admin/login";
const LOGOUT: &str = "/v1/admin/logout";
const CHANGE_PASSWORD: &str = "/v1/admin/change-password";
const STATUS: &str = "/v1/admin/status";
const REMOTE: &str = "203.0.113.7";

async fn admin_app(database: &TestDatabase) -> Router {
    let security = sqlx_admin_security_state(database).await;

    create_router(empty_registry_state(security))
}

fn loopback(request: Request<Body>) -> Request<Body> {
    with_loopback_client(request)
}

fn with_session(method: &str, uri: &str, body: serde_json::Value, cookie: &str) -> Request<Body> {
    json_request_with_headers(method, uri, body, &[("cookie", cookie)])
}

/// The `srouter_admin_session=...` pair from a response's `Set-Cookie`.
fn session_cookie(response: &Response) -> String {
    let value = response
        .headers()
        .get(header::SET_COOKIE)
        .expect("a Set-Cookie header")
        .to_str()
        .unwrap();

    value.split(';').next().unwrap().to_owned()
}

async fn json_body(response: Response) -> serde_json::Value {
    let bytes = to_bytes(response.into_body(), 65_536).await.unwrap();

    serde_json::from_slice(&bytes).unwrap()
}

async fn set_up(app: &Router, password: &str) -> Response {
    app.clone()
        .oneshot(loopback(json_request(
            "POST",
            SETUP,
            serde_json::json!({ "password": password, "confirmation": password }),
        )))
        .await
        .unwrap()
}

#[tokio::test]
async fn status_reports_a_fresh_install() {
    let database = TestDatabase::new().unwrap();
    let app = admin_app(&database).await;

    let response = app
        .oneshot(loopback(json_request(
            "GET",
            STATUS,
            serde_json::json!(null),
        )))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = json_body(response).await;
    assert_eq!(body["setup_required"], true);
    assert_eq!(body["authenticated"], false);
}

#[tokio::test]
async fn setup_creates_the_admin_and_a_session() {
    let database = TestDatabase::new().unwrap();
    let app = admin_app(&database).await;

    let response = set_up(&app, "correct horse").await;
    assert_eq!(response.status(), StatusCode::CREATED);
    let cookie = session_cookie(&response);
    assert!(cookie.starts_with("srouter_admin_session="));
    assert_eq!(json_body(response).await["authenticated"], true);

    let status = app
        .oneshot(loopback(with_session(
            "GET",
            STATUS,
            serde_json::json!(null),
            &cookie,
        )))
        .await
        .unwrap();
    let body = json_body(status).await;
    assert_eq!(body["setup_required"], false);
    assert_eq!(body["authenticated"], true);
}

#[tokio::test]
async fn setup_is_refused_from_a_remote_address() {
    let database = TestDatabase::new().unwrap();
    let app = admin_app(&database).await;

    let response = app
        .oneshot(with_remote_client(
            json_request(
                "POST",
                SETUP,
                serde_json::json!({ "password": "x", "confirmation": "x" }),
            ),
            REMOTE,
        ))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    let body = json_body(response).await;
    assert_eq!(body["error"]["code"], "setup_local_only");
}

#[tokio::test]
async fn setup_is_refused_once_an_account_exists() {
    let database = TestDatabase::new().unwrap();
    let app = admin_app(&database).await;
    assert_eq!(set_up(&app, "first").await.status(), StatusCode::CREATED);

    let response = set_up(&app, "second").await;

    assert_eq!(response.status(), StatusCode::CONFLICT);
    let body = json_body(response).await;
    assert_eq!(body["error"]["code"], "setup_already_complete");
}

#[tokio::test]
async fn setup_rejects_mismatched_and_oversized_passwords() {
    let database = TestDatabase::new().unwrap();
    let app = admin_app(&database).await;

    let mismatch = app
        .clone()
        .oneshot(loopback(json_request(
            "POST",
            SETUP,
            serde_json::json!({ "password": "one", "confirmation": "other" }),
        )))
        .await
        .unwrap();
    assert_eq!(mismatch.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        json_body(mismatch).await["error"]["code"],
        "password_mismatch"
    );

    let oversized = app
        .oneshot(loopback(json_request(
            "POST",
            SETUP,
            serde_json::json!({ "password": "a".repeat(129), "confirmation": "a".repeat(129) }),
        )))
        .await
        .unwrap();
    assert_eq!(oversized.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        json_body(oversized).await["error"]["code"],
        "invalid_password"
    );
}

#[tokio::test]
async fn login_succeeds_with_the_setup_password() {
    let database = TestDatabase::new().unwrap();
    let app = admin_app(&database).await;
    set_up(&app, "correct horse").await;

    let response = app
        .oneshot(loopback(json_request(
            "POST",
            LOGIN,
            serde_json::json!({ "password": "correct horse" }),
        )))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let cookie = session_cookie(&response);
    assert!(cookie.starts_with("srouter_admin_session="));
    assert_eq!(json_body(response).await["authenticated"], true);
}

#[tokio::test]
async fn five_failed_logins_block_further_attempts() {
    let database = TestDatabase::new().unwrap();
    let app = admin_app(&database).await;
    set_up(&app, "correct horse").await;

    for _ in 0..5 {
        let response = app
            .clone()
            .oneshot(loopback(json_request(
                "POST",
                LOGIN,
                serde_json::json!({ "password": "wrong" }),
            )))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    let blocked = app
        .oneshot(loopback(json_request(
            "POST",
            LOGIN,
            serde_json::json!({ "password": "wrong" }),
        )))
        .await
        .unwrap();

    assert_eq!(blocked.status(), StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(
        json_body(blocked).await["error"]["code"],
        "login_rate_limited"
    );
}

#[tokio::test]
async fn change_password_requires_a_session_and_rotates_the_password() {
    let database = TestDatabase::new().unwrap();
    let app = admin_app(&database).await;
    let cookie = session_cookie(&set_up(&app, "correct horse").await);

    let unauthenticated = app
        .clone()
        .oneshot(loopback(json_request(
            "POST",
            CHANGE_PASSWORD,
            serde_json::json!({
                "current_password": "correct horse",
                "new_password": "new horse",
                "confirmation": "new horse"
            }),
        )))
        .await
        .unwrap();
    assert_eq!(unauthenticated.status(), StatusCode::UNAUTHORIZED);

    let wrong_current = app
        .clone()
        .oneshot(loopback(with_session(
            "POST",
            CHANGE_PASSWORD,
            serde_json::json!({
                "current_password": "nope",
                "new_password": "new horse",
                "confirmation": "new horse"
            }),
            &cookie,
        )))
        .await
        .unwrap();
    assert_eq!(wrong_current.status(), StatusCode::UNAUTHORIZED);

    let changed = app
        .clone()
        .oneshot(loopback(with_session(
            "POST",
            CHANGE_PASSWORD,
            serde_json::json!({
                "current_password": "correct horse",
                "new_password": "new horse",
                "confirmation": "new horse"
            }),
            &cookie,
        )))
        .await
        .unwrap();
    assert_eq!(changed.status(), StatusCode::OK);

    let relogin = app
        .oneshot(loopback(json_request(
            "POST",
            LOGIN,
            serde_json::json!({ "password": "new horse" }),
        )))
        .await
        .unwrap();
    assert_eq!(relogin.status(), StatusCode::OK);
}

#[tokio::test]
async fn logout_revokes_the_session_and_clears_the_cookie() {
    let database = TestDatabase::new().unwrap();
    let app = admin_app(&database).await;
    let cookie = session_cookie(&set_up(&app, "correct horse").await);

    let response = app
        .clone()
        .oneshot(loopback(with_session(
            "POST",
            LOGOUT,
            serde_json::json!(null),
            &cookie,
        )))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NO_CONTENT);

    let status = app
        .oneshot(loopback(with_session(
            "GET",
            STATUS,
            serde_json::json!(null),
            &cookie,
        )))
        .await
        .unwrap();
    assert_eq!(json_body(status).await["authenticated"], false);
}

#[tokio::test]
async fn logout_without_a_session_still_clears_the_cookie() {
    let database = TestDatabase::new().unwrap();
    let app = admin_app(&database).await;

    let response = app
        .oneshot(loopback(json_request(
            "POST",
            LOGOUT,
            serde_json::json!(null),
        )))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert!(response.headers().contains_key(header::SET_COOKIE));
}
