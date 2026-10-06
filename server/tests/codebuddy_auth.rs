//! CodeBuddy OAuth routes against a local fake. No real provider credentials are used.

mod support;

use axum::middleware::from_fn_with_state;
use axum::{
    Router,
    body::Body,
    http::{Request, StatusCode},
    response::Response,
};
use srouter_server::AppState;
use srouter_server::features::admin_auth::hash_session_token;
use srouter_server::features::provider_auth::create_codebuddy_login_router_with_endpoints;
use srouter_server::features::providers::ProviderRegistry;
use srouter_server::http::middleware::admin_session::require_admin_session;
use srouter_server::infrastructure::database::oauth_sessions::claim_session;
use srouter_server::infrastructure::database::providers::list_connections;
use support::{
    FakeCodeBuddyUpstream, TestDatabase, json_request_with_headers, sqlx_security_state,
    test_config, with_loopback_client,
};
use tower::ServiceExt;

const SESSION_TOKEN: &str = "test-session-token";

async fn app(database: &TestDatabase, fake: &FakeCodeBuddyUpstream) -> Router {
    let security = sqlx_security_state(database, vec![hash_session_token(SESSION_TOKEN)]).await;
    let app_database = database.connect().await.expect("temporary database");
    let state = AppState::with_security(
        test_config(),
        ProviderRegistry::with_defaults().expect("provider registry"),
        security,
    )
    .with_database(app_database);
    let routes = create_codebuddy_login_router_with_endpoints(fake.endpoints())
        .layer(from_fn_with_state(state.clone(), require_admin_session));

    Router::new().nest("/v1", routes).with_state(state)
}

fn admin_get(uri: &str) -> Request<Body> {
    with_loopback_client(
        Request::builder()
            .method("GET")
            .uri(uri)
            .header("cookie", format!("srouter_admin_session={SESSION_TOKEN}"))
            .body(Body::empty())
            .unwrap(),
    )
}

async fn json_body(response: Response) -> serde_json::Value {
    let bytes = axum::body::to_bytes(response.into_body(), 65_536)
        .await
        .unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

#[tokio::test]
async fn login_returns_codebuddy_authorization_url_and_uses_its_oauth_state() {
    let database = TestDatabase::new().unwrap();
    let fake = FakeCodeBuddyUpstream::start().await;
    let app = app(&database, &fake).await;

    let state = app
        .clone()
        .oneshot(admin_get("/v1/auth/codebuddy/login?format=json"))
        .await
        .unwrap();
    assert_eq!(fake.last_state_query("global"), "platform=ide");
    let body = json_body(state).await;
    assert_eq!(body["authorizeUrl"], fake.authorize_url("global"));
    assert_eq!(body["state"], fake.last_state("global"));
    assert_eq!(fake.last_platform("global"), "ide");
    assert_eq!(fake.last_ioa("global"), "");
}

#[tokio::test]
async fn codebuddy_cn_login_redirects_and_uses_the_cn_oauth_origin() {
    let database = TestDatabase::new().unwrap();
    let fake = FakeCodeBuddyUpstream::start().await;
    let app = app(&database, &fake).await;

    let response = app
        .oneshot(admin_get("/v1/auth/codebuddy-cn/login"))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::SEE_OTHER);
    assert_eq!(
        response.headers().get("location").unwrap(),
        &fake.authorize_url("cn")
    );
    assert_eq!(fake.last_platform("cn"), "CLI");
    assert_eq!(fake.last_ioa("cn"), "1");
    assert_eq!(fake.last_state_query("cn"), "platform=CLI&ioa=1");
    assert_eq!(fake.last_origin("cn"), "https://www.codebuddy.cn");
}

#[tokio::test]
async fn poll_stays_pending_then_stores_only_a_codebuddy_verified_token() {
    let database = TestDatabase::new().unwrap();
    let fake = FakeCodeBuddyUpstream::start().await;
    let app = app(&database, &fake).await;
    let login = app
        .clone()
        .oneshot(admin_get("/v1/auth/codebuddy/login?format=json"))
        .await
        .unwrap();
    let state = json_body(login).await["state"].as_str().unwrap().to_owned();

    let pending = app
        .clone()
        .oneshot(admin_get(&format!("/v1/auth/codebuddy/poll?state={state}")))
        .await
        .unwrap();
    assert_eq!(pending.status(), StatusCode::OK);
    assert_eq!(json_body(pending).await["status"], "pending");

    fake.approve("global");
    let approved = app
        .clone()
        .oneshot(json_request_with_headers(
            "POST",
            "/v1/auth/codebuddy/poll",
            serde_json::json!({ "state": state }),
            &[("cookie", &format!("srouter_admin_session={SESSION_TOKEN}"))],
        ))
        .await
        .unwrap();
    assert_eq!(approved.status(), StatusCode::OK);
    let body = json_body(approved).await;
    assert_eq!(body["status"], "ok");
    assert_eq!(body["provider"]["provider_id"], "codebuddy");
    assert_eq!(body["provider"]["category"], "oauth");

    let app_database = database.connect().await.expect("temporary database");
    let connection = list_connections(&app_database)
        .await
        .expect("connections read")
        .into_iter()
        .find(|connection| connection.provider_id == "codebuddy")
        .expect("OAuth-approved provider stored");
    assert_eq!(
        connection.base_url.as_deref(),
        Some("https://www.codebuddy.ai/v2/chat/completions")
    );
    let raw_credentials: String =
        sqlx::query_scalar("SELECT credentials FROM providers WHERE id = ?")
            .bind(&connection.id)
            .fetch_one(&app_database.sqlite_pool().unwrap())
            .await
            .unwrap();
    let credentials: serde_json::Value = serde_json::from_str(&raw_credentials).unwrap();
    assert_eq!(credentials["access_token"], "fixture-codebuddy-access");
    assert_eq!(credentials["refresh_token"], "fixture-codebuddy-refresh");
    assert!(
        claim_session(&app_database, &state)
            .await
            .unwrap()
            .is_none()
    );
}

#[tokio::test]
async fn codebuddy_cn_poll_persists_only_the_cn_approved_connection() {
    let database = TestDatabase::new().unwrap();
    let fake = FakeCodeBuddyUpstream::start().await;
    let app = app(&database, &fake).await;
    let login = app
        .clone()
        .oneshot(admin_get("/v1/auth/codebuddy-cn/login?format=json"))
        .await
        .unwrap();
    let state = json_body(login).await["state"].as_str().unwrap().to_owned();
    fake.approve("cn");

    let approved = app
        .oneshot(admin_get(&format!(
            "/v1/auth/codebuddy-cn/poll?state={state}"
        )))
        .await
        .unwrap();
    assert_eq!(approved.status(), StatusCode::OK);
    let body = json_body(approved).await;
    assert_eq!(body["status"], "ok");
    assert_eq!(body["provider"]["provider_id"], "codebuddy-cn");

    let app_database = database.connect().await.expect("temporary database");
    let connection = list_connections(&app_database)
        .await
        .expect("connections read")
        .into_iter()
        .find(|connection| connection.provider_id == "codebuddy-cn")
        .expect("CodeBuddy CN OAuth-approved provider stored");
    assert_eq!(
        connection.base_url.as_deref(),
        Some("https://copilot.tencent.com/v2/chat/completions")
    );
}

#[tokio::test]
async fn codebuddy_oauth_routes_require_admin_and_do_not_expose_manual_token_import() {
    let database = TestDatabase::new().unwrap();
    let fake = FakeCodeBuddyUpstream::start().await;
    let app = app(&database, &fake).await;

    let anonymous = app
        .clone()
        .oneshot(with_loopback_client(
            Request::builder()
                .uri("/v1/auth/codebuddy/login?format=json")
                .body(Body::empty())
                .unwrap(),
        ))
        .await
        .unwrap();
    assert_eq!(anonymous.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(fake.state_requests(), 0);

    let missing_state = app
        .clone()
        .oneshot(admin_get("/v1/auth/codebuddy/poll"))
        .await
        .unwrap();
    assert_eq!(missing_state.status(), StatusCode::BAD_REQUEST);

    let token_import = app
        .oneshot(json_request_with_headers(
            "POST",
            "/v1/auth/codebuddy/token",
            serde_json::json!({ "accessToken": "unverified" }),
            &[("cookie", &format!("srouter_admin_session={SESSION_TOKEN}"))],
        ))
        .await
        .unwrap();
    assert_eq!(token_import.status(), StatusCode::NOT_FOUND);
}
