//! Claude Code OAuth routes against a local fake token endpoint. No real
//! Anthropic credentials are used.

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
use srouter_server::features::provider_auth::{
    create_claude_callback_router_with_endpoints, create_claude_login_router,
};
use srouter_server::features::providers::ProviderRegistry;
use srouter_server::http::middleware::admin_session::require_admin_session;
use srouter_server::infrastructure::database::providers::load_claude_credentials;
use support::{
    FakeClaudeUpstream, TestDatabase, json_request_with_headers, sqlx_security_state, test_config,
    with_loopback_client,
};
use tower::ServiceExt;

const SESSION_TOKEN: &str = "test-session-token";

async fn app(database: &TestDatabase, fake: &FakeClaudeUpstream) -> Router {
    let security = sqlx_security_state(database, vec![hash_session_token(SESSION_TOKEN)]).await;
    let app_database = database.connect().await.expect("temporary database");
    let state = AppState::with_security(
        test_config(),
        ProviderRegistry::with_defaults().expect("provider registry"),
        security,
    )
    .with_database(app_database);
    let login_routes = create_claude_login_router()
        .layer(from_fn_with_state(state.clone(), require_admin_session));
    let callback_routes = create_claude_callback_router_with_endpoints(fake.endpoints());

    Router::new()
        .nest("/v1", login_routes.merge(callback_routes))
        .with_state(state)
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

fn public_get(uri: &str) -> Request<Body> {
    with_loopback_client(
        Request::builder()
            .method("GET")
            .uri(uri)
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

/// The `^claude_\d+$` id the routes mint.
fn is_claude_id(id: &str) -> bool {
    id.strip_prefix("claude_").is_some_and(|suffix| {
        !suffix.is_empty() && suffix.bytes().all(|byte| byte.is_ascii_digit())
    })
}

#[tokio::test]
async fn login_returns_the_claude_authorize_url_with_pkce() {
    let database = TestDatabase::new().unwrap();
    let fake = FakeClaudeUpstream::start().await;
    let app = app(&database, &fake).await;

    let response = app
        .oneshot(admin_get("/v1/auth/claude/login?format=json"))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = json_body(response).await;
    let authorize_url = body["authorize_url"].as_str().expect("authorize url");
    let state = body["state"].as_str().expect("state");

    assert!(
        authorize_url.starts_with("https://claude.ai/oauth/authorize?"),
        "{authorize_url}"
    );
    assert!(authorize_url.contains("code_challenge_method=S256"));
    assert!(authorize_url.contains("code_challenge="));
    assert!(
        authorize_url.contains("client_id=9d1c250a-e61b-44d9-88ed-5944d1962f5e"),
        "the official Claude Code client id"
    );
    assert!(
        authorize_url.contains(&format!("state={state}")),
        "{authorize_url}"
    );
    assert!(
        authorize_url
            .contains("redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fv1%2Fauth%2Fclaude%2Fcallback"),
        "{authorize_url}"
    );
    assert_eq!(
        body["code_verifier"].as_str().expect("verifier").len(),
        43,
        "RFC 7636 wants a 43 character verifier"
    );
    assert_eq!(state.len(), 36);
    assert_eq!(
        body["redirect_uri"],
        "http://localhost:3000/v1/auth/claude/callback"
    );
}

#[tokio::test]
async fn login_requires_the_admin_session() {
    let database = TestDatabase::new().unwrap();
    let fake = FakeClaudeUpstream::start().await;
    let app = app(&database, &fake).await;

    let response = app
        .oneshot(public_get("/v1/auth/claude/login?format=json"))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn callback_exchanges_the_code_and_stores_the_connection() {
    let database = TestDatabase::new().unwrap();
    let fake = FakeClaudeUpstream::start().await;
    let app = app(&database, &fake).await;
    let login = app
        .clone()
        .oneshot(admin_get("/v1/auth/claude/login?format=json"))
        .await
        .unwrap();
    let state = json_body(login).await["state"].as_str().unwrap().to_owned();

    // The callback route is public: no admin cookie is carried here.
    let response = app
        .clone()
        .oneshot(public_get(&format!(
            "/v1/auth/claude/callback?code=code-1&state={state}"
        )))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = json_body(response).await;
    assert_eq!(body["success"], true);
    assert_eq!(body["message"], "Login Claude Code OAuth Berhasil!");
    assert_eq!(body["provider"]["provider_id"], "claude");
    assert_eq!(body["provider"]["category"], "oauth");
    assert_eq!(body["provider"]["protocol"], "anthropic");
    assert!(is_claude_id(body["provider"]["id"].as_str().unwrap()));

    assert_eq!(fake.token_requests(), 1);
    let exchange = fake.with(|state| state.last_token_body.clone());
    assert!(exchange.contains("\"grant_type\":\"authorization_code\""));
    assert!(exchange.contains("\"code\":\"code-1\""));
    assert!(exchange.contains("\"code_verifier\":"));
    assert!(
        !exchange.contains("client_secret"),
        "Claude OAuth takes client_id only"
    );

    let app_database = database.connect().await.expect("temporary database");
    let credentials = load_claude_credentials(&app_database)
        .await
        .expect("credentials read")
        .expect("a connection was stored");
    assert!(is_claude_id(&credentials.id));
    assert_eq!(credentials.access_token, "sk-ant-oat01-fresh");
    assert_eq!(
        credentials.refresh_token.as_deref(),
        Some("sk-ant-ort01-rotated")
    );
    assert_eq!(credentials.organization_id.as_deref(), Some("org-fake"));
}

#[tokio::test]
async fn callback_rejects_missing_params_and_unknown_state() {
    let database = TestDatabase::new().unwrap();
    let fake = FakeClaudeUpstream::start().await;
    let app = app(&database, &fake).await;

    let missing = app
        .clone()
        .oneshot(json_request_with_headers(
            "POST",
            "/v1/auth/claude/callback",
            serde_json::json!({}),
            &[],
        ))
        .await
        .unwrap();
    assert_eq!(missing.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        json_body(missing).await["error"]["message"],
        "Missing required 'code' or 'state' parameters in OAuth callback"
    );

    let unknown = app
        .oneshot(public_get(
            "/v1/auth/claude/callback?code=code-1&state=unknown",
        ))
        .await
        .unwrap();
    assert_eq!(unknown.status(), StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(
        json_body(unknown).await["error"]["message"],
        "Invalid or expired OAuth state parameter"
    );
}

#[tokio::test]
async fn callback_reads_a_pasted_callback_url() {
    let database = TestDatabase::new().unwrap();
    let fake = FakeClaudeUpstream::start().await;
    let app = app(&database, &fake).await;
    let login = app
        .clone()
        .oneshot(admin_get("/v1/auth/claude/login?format=json"))
        .await
        .unwrap();
    let state = json_body(login).await["state"].as_str().unwrap().to_owned();

    let callback_url =
        format!("http://localhost:1455/auth/claude/callback?code=code-2&state={state}");
    let response = app
        .oneshot(json_request_with_headers(
            "POST",
            "/v1/auth/claude/callback",
            serde_json::json!({ "callback_url": callback_url }),
            &[],
        ))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        json_body(response).await["provider"]["provider_id"],
        "claude"
    );
    assert_eq!(fake.token_requests(), 1);
    assert!(
        fake.with(|state| state.last_token_body.clone())
            .contains("\"code\":\"code-2\"")
    );
}

#[tokio::test]
async fn token_import_stores_a_connection() {
    let database = TestDatabase::new().unwrap();
    let fake = FakeClaudeUpstream::start().await;
    let app = app(&database, &fake).await;
    let cookie = format!("srouter_admin_session={SESSION_TOKEN}");

    let response = app
        .oneshot(json_request_with_headers(
            "POST",
            "/v1/auth/claude/token",
            serde_json::json!({
                "accessToken": "sk-ant-oat01-imported",
                "refreshToken": "sk-ant-ort01-imported",
                "organizationId": "org-imported"
            }),
            &[("cookie", cookie.as_str())],
        ))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::CREATED);
    let body = json_body(response).await;
    assert_eq!(body["success"], true);
    assert_eq!(
        body["message"],
        "Claude Code OAuth token registered and saved directly to SQLite database!"
    );
    assert_eq!(body["provider"]["provider_id"], "claude");
    assert_eq!(body["provider"]["protocol"], "anthropic");
    assert!(is_claude_id(body["provider"]["id"].as_str().unwrap()));

    let app_database = database.connect().await.expect("temporary database");
    let credentials = load_claude_credentials(&app_database)
        .await
        .expect("credentials read")
        .expect("a connection was stored");
    assert_eq!(credentials.access_token, "sk-ant-oat01-imported");
    assert_eq!(
        credentials.refresh_token.as_deref(),
        Some("sk-ant-ort01-imported")
    );
    assert_eq!(credentials.organization_id.as_deref(), Some("org-imported"));
}

#[tokio::test]
async fn token_import_requires_admin_and_an_access_token() {
    let database = TestDatabase::new().unwrap();
    let fake = FakeClaudeUpstream::start().await;
    let app = app(&database, &fake).await;

    let anonymous = app
        .clone()
        .oneshot(json_request_with_headers(
            "POST",
            "/v1/auth/claude/token",
            serde_json::json!({ "accessToken": "unverified" }),
            &[],
        ))
        .await
        .unwrap();
    assert_eq!(anonymous.status(), StatusCode::UNAUTHORIZED);

    let cookie = format!("srouter_admin_session={SESSION_TOKEN}");
    let missing = app
        .oneshot(json_request_with_headers(
            "POST",
            "/v1/auth/claude/token",
            serde_json::json!({ "refreshToken": "only" }),
            &[("cookie", cookie.as_str())],
        ))
        .await
        .unwrap();
    assert_eq!(missing.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        json_body(missing).await["error"]["message"],
        "Missing required 'accessToken' parameter"
    );
}
