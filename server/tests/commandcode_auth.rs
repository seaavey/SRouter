//! The Command Code sign-in routes against a local fake relay. No real provider
//! credentials are used.

mod support;

use axum::middleware::from_fn_with_state;
use axum::{
    Router,
    body::Body,
    http::{Request, StatusCode},
    response::Response,
};
use srouter_server::features::admin_auth::hash_session_token;
use srouter_server::features::provider_auth::{
    create_commandcode_callback_router_with_endpoints,
    create_commandcode_login_router_with_endpoints,
};
use srouter_server::http::middleware::session_guard::require_admin_session;
use srouter_server::infrastructure::database::providers::list_connections;
use srouter_server::{APIConfig, AppState};
use support::{
    FakeCommandCodeUpstream, TestDatabase, commandcode_config, commandcode_registry,
    json_request_with_headers, sqlx_security_state, with_loopback_client,
};
use tower::ServiceExt;

const SESSION_TOKEN: &str = "test-session-token";

async fn app_with(
    config: APIConfig,
    database: &TestDatabase,
    fake: &FakeCommandCodeUpstream,
) -> Router {
    let security = sqlx_security_state(database, vec![hash_session_token(SESSION_TOKEN)]).await;
    let app_database = database.connect().await.expect("temporary database");
    let state = AppState::with_security(
        config,
        commandcode_registry(Some(app_database.clone()), fake),
        security,
    )
    .with_database(app_database);
    let guarded = create_commandcode_login_router_with_endpoints(fake.endpoints())
        .layer(from_fn_with_state(state.clone(), require_admin_session));
    let public = create_commandcode_callback_router_with_endpoints(fake.endpoints());

    Router::new()
        .nest("/v1", guarded.merge(public))
        .with_state(state)
}

async fn app(database: &TestDatabase, fake: &FakeCommandCodeUpstream) -> Router {
    app_with(commandcode_config(), database, fake).await
}

fn admin_get(uri: &str) -> Request<Body> {
    with_loopback_client(
        Request::builder()
            .method("GET")
            .uri(uri)
            .header("cookie", format!("srouter_admin_session={SESSION_TOKEN}"))
            .body(Body::empty())
            .expect("request"),
    )
}

fn admin_post(uri: &str, body: serde_json::Value) -> Request<Body> {
    with_loopback_client(json_request_with_headers(
        "POST",
        uri,
        body,
        &[("cookie", &format!("srouter_admin_session={SESSION_TOKEN}"))],
    ))
}

fn anonymous_post(uri: &str, body: serde_json::Value) -> Request<Body> {
    with_loopback_client(json_request_with_headers("POST", uri, body, &[]))
}

async fn json_body(response: Response) -> serde_json::Value {
    let bytes = axum::body::to_bytes(response.into_body(), 65_536)
        .await
        .expect("response body");

    serde_json::from_slice(&bytes).expect("response JSON")
}

/// The `providers` rows the sign-in has written.
async fn connection_count(database: &TestDatabase) -> i64 {
    let pool = database
        .connect()
        .await
        .expect("temporary database")
        .sqlite_pool()
        .expect("sqlite pool");

    sqlx::query_scalar("SELECT COUNT(*) FROM providers WHERE provider_id = 'commandcode'")
        .fetch_one(&pool)
        .await
        .expect("connection count")
}

#[tokio::test]
async fn login_returns_the_studio_url_and_a_live_state() {
    let database = TestDatabase::new().expect("temporary database");
    let fake = FakeCommandCodeUpstream::start().await;
    let app = app(&database, &fake).await;

    let response = app
        .clone()
        .oneshot(admin_get("/v1/auth/commandcode/login"))
        .await
        .expect("login response");
    assert_eq!(response.status(), StatusCode::OK);
    let body = json_body(response).await;
    let authorize_url = body["authorize_url"].as_str().expect("authorize url");
    assert!(
        authorize_url.starts_with("https://commandcode.ai/studio/auth/cli?"),
        "{authorize_url}"
    );
    assert!(
        authorize_url.contains(&format!("state={}", body["state"].as_str().unwrap())),
        "{authorize_url}"
    );
    assert!(
        authorize_url.contains(
            "callback=http%3A%2F%2Flocalhost%3A3000%2Fv1%2Fauth%2Fcommandcode%2Fcallback"
        ),
        "the studio is handed our own callback: {authorize_url}"
    );
    assert_eq!(
        body["redirect_uri"],
        "http://localhost:3000/v1/auth/commandcode/callback"
    );

    // The session row exists and is unclaimed, so a poll before the browser
    // lands reports pending rather than failing.
    let state_token = body["state"].as_str().expect("state");
    let poll = app
        .oneshot(admin_get(&format!(
            "/v1/auth/commandcode/poll?state={state_token}"
        )))
        .await
        .expect("poll response");
    assert_eq!(poll.status(), StatusCode::OK);
    let poll = json_body(poll).await;
    assert_eq!(poll["status"], "pending");
    assert_eq!(connection_count(&database).await, 0);
}

#[tokio::test]
async fn login_refuses_when_the_studio_origin_is_not_allowed() {
    let database = TestDatabase::new().expect("temporary database");
    let fake = FakeCommandCodeUpstream::start().await;
    let app = app_with(support::test_config(), &database, &fake).await;

    let response = app
        .oneshot(admin_get("/v1/auth/commandcode/login"))
        .await
        .expect("login response");

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let body = json_body(response).await;
    assert!(
        body["error"]["message"]
            .as_str()
            .unwrap_or_default()
            .contains("SROUTER_CORS_ORIGINS"),
        "{body}"
    );
}

#[tokio::test]
async fn a_callback_with_an_unknown_state_is_rejected() {
    let database = TestDatabase::new().expect("temporary database");
    let fake = FakeCommandCodeUpstream::start().await;
    let app = app(&database, &fake).await;

    let response = app
        .oneshot(anonymous_post(
            "/v1/auth/commandcode/callback",
            serde_json::json!({ "state": "not-a-session", "apiKey": "fixture-key" }),
        ))
        .await
        .expect("callback response");

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert_eq!(connection_count(&database).await, 0);
}

#[tokio::test]
async fn a_rejected_key_never_reaches_the_database() {
    let database = TestDatabase::new().expect("temporary database");
    let fake = FakeCommandCodeUpstream::start().await;
    let app = app(&database, &fake).await;

    let login = json_body(
        app.clone()
            .oneshot(admin_get("/v1/auth/commandcode/login"))
            .await
            .expect("login response"),
    )
    .await;
    let state_token = login["state"].as_str().expect("state").to_owned();

    let response = app
        .oneshot(anonymous_post(
            "/v1/auth/commandcode/callback",
            serde_json::json!({ "state": state_token, "apiKey": "rejected-key" }),
        ))
        .await
        .expect("callback response");

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let body = json_body(response).await;
    assert!(
        body["error"]["message"]
            .as_str()
            .unwrap_or_default()
            .contains("rejected"),
        "{body}"
    );
    assert_eq!(connection_count(&database).await, 0);
}

#[tokio::test]
async fn the_callback_parks_the_key_and_the_poll_stores_the_connection() {
    let database = TestDatabase::new().expect("temporary database");
    let fake = FakeCommandCodeUpstream::start().await;
    let app = app(&database, &fake).await;

    let login = json_body(
        app.clone()
            .oneshot(admin_get("/v1/auth/commandcode/login"))
            .await
            .expect("login response"),
    )
    .await;
    let state_token = login["state"].as_str().expect("state").to_owned();

    let callback = app
        .clone()
        .oneshot(anonymous_post(
            "/v1/auth/commandcode/callback",
            serde_json::json!({ "state": state_token, "apiKey": "fixture-key" }),
        ))
        .await
        .expect("callback response");
    assert_eq!(callback.status(), StatusCode::OK);
    let body = json_body(callback).await;
    assert_eq!(body["success"], true);
    assert!(
        !body.to_string().contains("fixture-key"),
        "the key is never echoed back: {body}"
    );
    assert_eq!(
        connection_count(&database).await,
        0,
        "the callback parks the key; the poll writes the row"
    );

    let poll = app
        .clone()
        .oneshot(admin_get(&format!(
            "/v1/auth/commandcode/poll?state={state_token}"
        )))
        .await
        .expect("poll response");
    assert_eq!(poll.status(), StatusCode::OK);
    let poll = json_body(poll).await;
    assert_eq!(poll["status"], "ok");
    assert_eq!(poll["provider"]["provider_id"], "commandcode");
    assert_eq!(poll["provider"]["name"], "Fixture Account");
    assert_eq!(connection_count(&database).await, 1);

    let connections = list_connections(&database.connect().await.expect("temporary database"))
        .await
        .expect("connections");
    let commandcode = connections
        .iter()
        .find(|connection| connection.provider_id == "commandcode")
        .expect("the stored connection");
    assert_eq!(commandcode.name, "Fixture Account");

    // The session is consumed: a second poll reports the expiry rather than
    // writing a second connection.
    let second = app
        .oneshot(admin_get(&format!(
            "/v1/auth/commandcode/poll?state={state_token}"
        )))
        .await
        .expect("second poll response");
    let second = json_body(second).await;
    assert_eq!(second["status"], "pending");
    assert!(
        second["error"]
            .as_str()
            .unwrap_or_default()
            .contains("expired")
    );
    assert_eq!(connection_count(&database).await, 1);
}

#[tokio::test]
async fn a_pasted_key_imports_the_same_connection() {
    let database = TestDatabase::new().expect("temporary database");
    let fake = FakeCommandCodeUpstream::start().await;
    let app = app(&database, &fake).await;

    let response = app
        .oneshot(admin_post(
            "/v1/auth/commandcode/token",
            serde_json::json!({ "access_token": "pasted-key" }),
        ))
        .await
        .expect("token response");

    assert_eq!(response.status(), StatusCode::OK);
    let body = json_body(response).await;
    assert_eq!(body["success"], true);
    assert_eq!(body["provider"]["provider_id"], "commandcode");
    assert_eq!(connection_count(&database).await, 1);

    let connections = list_connections(&database.connect().await.expect("temporary database"))
        .await
        .expect("connections");
    assert!(
        connections
            .iter()
            .any(|connection| connection.provider_id == "commandcode"
                && connection.name == "Fixture Account"),
        "{connections:?}"
    );
}

#[tokio::test]
async fn starting_a_sign_in_or_importing_a_key_needs_the_admin_session() {
    let database = TestDatabase::new().expect("temporary database");
    let fake = FakeCommandCodeUpstream::start().await;
    let app = app(&database, &fake).await;

    let login = with_loopback_client(
        Request::builder()
            .method("GET")
            .uri("/v1/auth/commandcode/login")
            .body(Body::empty())
            .expect("request"),
    );
    assert_eq!(
        app.clone()
            .oneshot(login)
            .await
            .expect("login response")
            .status(),
        StatusCode::UNAUTHORIZED
    );

    assert_eq!(
        app.oneshot(anonymous_post(
            "/v1/auth/commandcode/token",
            serde_json::json!({ "access_token": "pasted-key" }),
        ))
        .await
        .expect("token response")
        .status(),
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(connection_count(&database).await, 0);
}
