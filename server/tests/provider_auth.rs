//! Device-flow tests for `/v1/auth/qoder/*`, run against the fake Qoder
//! upstream so no real account or network is involved.

mod support;

use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode},
    response::Response,
};
use srouter_server::app::create_router;
use srouter_server::clock::now_ms;
use srouter_server::features::admin_auth::hash_session_token;
use srouter_server::infrastructure::database::oauth_sessions::{
    SESSION_TTL_MS, claim_session, delete_session, release_session, save_session,
};
use srouter_server::infrastructure::database::providers::{
    ClineConnectionWrite, load_cline_credentials, load_qoder_credentials, update_cline_tokens,
    upsert_cline_connection,
};
use support::{
    FakeClineUpstream, FakeQoderUpstream, TestDatabase, cline_state, json_request_with_headers,
    qoder_state, sqlx_security_state, with_loopback_client,
};
use tower::ServiceExt;

const SESSION_TOKEN: &str = "test-session-token";

async fn cline_app(database: &TestDatabase, fake: &FakeClineUpstream) -> Router {
    let security = sqlx_security_state(database, vec![hash_session_token(SESSION_TOKEN)]).await;
    let app_database = database.connect().await.expect("temporary database");
    create_router(cline_state(app_database, security, fake))
}

async fn app(database: &TestDatabase, fake: &FakeQoderUpstream) -> Router {
    let security = sqlx_security_state(database, vec![hash_session_token(SESSION_TOKEN)]).await;
    let app_database = database.connect().await.expect("temporary database");

    create_router(qoder_state(app_database, security, fake))
}

/// A GET carrying the fixture admin-session cookie.
fn admin_get(uri: &str) -> Request<Body> {
    let cookie = format!("srouter_admin_session={SESSION_TOKEN}");

    with_loopback_client(
        Request::builder()
            .method("GET")
            .uri(uri)
            .header("cookie", cookie)
            .body(Body::empty())
            .unwrap(),
    )
}

async fn json_body(response: Response) -> serde_json::Value {
    let bytes = to_bytes(response.into_body(), 65_536).await.unwrap();

    serde_json::from_slice(&bytes).unwrap()
}

/// Starts a login and returns its JSON body.
async fn start_login(app: &Router) -> serde_json::Value {
    let response = app
        .clone()
        .oneshot(admin_get("/v1/auth/qoder/login?format=json"))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    json_body(response).await
}

/// Polls the device flow once with the fixture admin-session cookie.
async fn poll(app: &Router, state: &str) -> serde_json::Value {
    let uri = format!("/v1/auth/qoder/poll?state={state}");
    let response = app.clone().oneshot(admin_get(&uri)).await.unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    json_body(response).await
}

#[tokio::test]
async fn login_opens_the_device_flow_with_a_pkce_challenge() {
    let database = TestDatabase::new().unwrap();
    let fake = FakeQoderUpstream::start().await;
    let app = app(&database, &fake).await;

    let body = start_login(&app).await;
    let authorize_url = body["authorizeUrl"].as_str().expect("authorize url");

    assert!(
        authorize_url.starts_with("https://qoder.com/device/selectAccounts?"),
        "{authorize_url}"
    );
    assert!(authorize_url.contains("challenge_method=S256"));
    assert!(authorize_url.contains("challenge="));
    assert!(authorize_url.contains("nonce="));
    assert_eq!(
        body["codeVerifier"].as_str().expect("verifier").len(),
        43,
        "RFC 7636 wants a 43 character verifier"
    );
    assert_eq!(body["state"].as_str().expect("state").len(), 36);
    assert_eq!(body["redirectUri"], "");
}

#[tokio::test]
async fn login_requires_the_admin_session() {
    let database = TestDatabase::new().unwrap();
    let fake = FakeQoderUpstream::start().await;
    let app = app(&database, &fake).await;
    let request = with_loopback_client(
        Request::builder()
            .method("GET")
            .uri("/v1/auth/qoder/login?format=json")
            .body(Body::empty())
            .unwrap(),
    );

    let response = app.oneshot(request).await.unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn poll_stays_pending_until_the_browser_approves() {
    let database = TestDatabase::new().unwrap();
    let fake = FakeQoderUpstream::start().await;
    let app = app(&database, &fake).await;
    let login = start_login(&app).await;
    let state = login["state"].as_str().expect("state").to_owned();

    let waiting = poll(&app, &state).await;
    assert_eq!(waiting["status"], "pending");
    assert!(
        waiting.get("error").is_none(),
        "a plain pending answer carries no message"
    );

    fake.with(|state| state.approve_device = true);

    let connected = poll(&app, &state).await;
    assert_eq!(connected["status"], "ok");
    assert_eq!(connected["provider"]["provider_id"], "qoder");
    assert_eq!(connected["provider"]["category"], "oauth");
    assert_eq!(connected["provider"]["protocol"], "openai");
    assert!(
        connected["provider"]["name"]
            .as_str()
            .expect("name")
            .starts_with("Qoder (Seaavey Dev"),
        "{}",
        connected["provider"]["name"]
    );

    let app_database = database.connect().await.expect("temporary database");
    let credentials = load_qoder_credentials(&app_database)
        .await
        .expect("credentials read")
        .expect("a connection was stored");

    assert_eq!(credentials.access_token, "dt-fixture-token");
    assert_eq!(credentials.user_id, "user-fixture");
    assert_eq!(credentials.email, "seaavey@example.com");
    assert!(credentials.is_expired(srouter_server::clock::now_ms() + 86_401_000));
}

#[tokio::test]
async fn poll_consumes_the_session_once_connected() {
    let database = TestDatabase::new().unwrap();
    let fake = FakeQoderUpstream::start().await;
    let app = app(&database, &fake).await;
    let login = start_login(&app).await;
    let state = login["state"].as_str().expect("state").to_owned();

    fake.with(|state| state.approve_device = true);
    let connected = poll(&app, &state).await;
    assert_eq!(connected["status"], "ok");

    let again = poll(&app, &state).await;
    assert_eq!(again["status"], "pending");
    assert_eq!(again["error"], "Session expired or not found");
}

#[tokio::test]
async fn poll_without_a_state_is_rejected() {
    let database = TestDatabase::new().unwrap();
    let fake = FakeQoderUpstream::start().await;
    let app = app(&database, &fake).await;

    let response = app
        .clone()
        .oneshot(admin_get("/v1/auth/qoder/poll"))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        json_body(response).await["error"]["message"],
        "Missing state parameter"
    );
}

#[tokio::test]
async fn the_callback_finishes_the_flow_for_a_pasted_url() {
    let database = TestDatabase::new().unwrap();
    let fake = FakeQoderUpstream::start().await;
    let app = app(&database, &fake).await;
    let login = start_login(&app).await;
    let state = login["state"].as_str().expect("state").to_owned();

    fake.with(|state| state.approve_device = true);

    let cookie = format!("srouter_admin_session={SESSION_TOKEN}");
    let callback_url =
        format!("http://localhost:1455/auth/qoder/callback?code={state}&state={state}");
    let request = with_loopback_client(
        Request::builder()
            .method("POST")
            .uri("/v1/auth/qoder/callback")
            .header("cookie", cookie)
            .header("content-type", "application/json")
            .body(Body::from(
                serde_json::json!({ "callback_url": callback_url }).to_string(),
            ))
            .unwrap(),
    );
    let response = app.clone().oneshot(request).await.unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = json_body(response).await;
    assert_eq!(body["success"], true);
    assert_eq!(body["message"], "Login Qoder Berhasil!");
    assert_eq!(body["provider"]["provider_id"], "qoder");
}

#[tokio::test]
async fn poll_requires_the_admin_session() {
    let database = TestDatabase::new().unwrap();
    let fake = FakeQoderUpstream::start().await;
    let app = app(&database, &fake).await;

    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/v1/auth/qoder/poll?state=whatever")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn a_session_can_be_claimed_once_released_and_reclaimed() {
    let database = TestDatabase::new().unwrap();
    let db = database.connect().await.expect("temporary database");

    save_session(&db, "state-1", "verifier-1", "", "")
        .await
        .expect("session stored");

    let first = claim_session(&db, "state-1")
        .await
        .expect("claim reads")
        .expect("claimable");
    assert_eq!(first.code_verifier, "verifier-1");
    assert!(
        claim_session(&db, "state-1")
            .await
            .expect("claim reads")
            .is_none(),
        "one claim at a time"
    );

    release_session(&db, "state-1").await.expect("released");
    assert!(
        claim_session(&db, "state-1")
            .await
            .expect("claim reads")
            .is_some(),
        "a released session is claimable again"
    );

    delete_session(&db, "state-1").await.expect("deleted");
    assert!(
        claim_session(&db, "state-1")
            .await
            .expect("claim reads")
            .is_none(),
        "a deleted session is gone"
    );
}

#[tokio::test]
async fn an_expired_session_cannot_be_claimed() {
    let database = TestDatabase::new().unwrap();
    let db = database.connect().await.expect("temporary database");

    sqlx::query(
        "INSERT INTO oauth_sessions \
         (state, code_verifier, device_code, client_id, redirect_uri, created_at, claimed_at) \
         VALUES (?, ?, NULL, '', '', ?, NULL)",
    )
    .bind("old-state")
    .bind("verifier")
    .bind(now_ms() - SESSION_TTL_MS - 1_000)
    .execute(db.sqlite_pool().expect("sqlite pool"))
    .await
    .expect("expired session inserted");

    assert!(
        claim_session(&db, "old-state")
            .await
            .expect("claim reads")
            .is_none(),
        "a session older than the ttl is refused"
    );
}

#[tokio::test]
async fn credentials_read_under_either_spelling() {
    let database = TestDatabase::new().unwrap();
    let db = database.connect().await.expect("temporary database");
    let pool = db.sqlite_pool().expect("sqlite pool");

    assert!(
        load_qoder_credentials(&db)
            .await
            .expect("credentials read")
            .is_none(),
        "no connection reads as none"
    );

    // The camelCase spelling a Node build writes must read as well.
    sqlx::query(
        "INSERT INTO providers \
         (id, provider_id, name, category, protocol, enabled, credentials, meta, created_at) \
         VALUES ('qoder_node', 'qoder', 'Qoder (Node)', 'oauth', 'openai', 1, ?, '{}', ?)",
    )
    .bind(
        r#"{"accessToken":"pt-node-token","refreshToken":"rt-node","provider_specific_data":{"userId":"user-node","name":"Node User","email":"node@example.com"}}"#,
    )
    .bind(now_ms())
    .execute(pool)
    .await
    .expect("node row inserted");

    let credentials = load_qoder_credentials(&db)
        .await
        .expect("credentials read")
        .expect("the camelCase row reads");

    assert_eq!(credentials.access_token, "pt-node-token");
    assert_eq!(credentials.refresh_token.as_deref(), Some("rt-node"));
    assert_eq!(credentials.user_id, "user-node");
    assert_eq!(credentials.name, "Node User");
    assert_eq!(credentials.email, "node@example.com");
    assert!(
        !credentials.is_expired(now_ms()),
        "no stated expiry never expires"
    );
}

#[tokio::test]
async fn the_callback_rejects_a_body_without_code_or_state() {
    let database = TestDatabase::new().unwrap();
    let fake = FakeQoderUpstream::start().await;
    let app = app(&database, &fake).await;
    let request = json_request_with_headers(
        "POST",
        "/v1/auth/qoder/callback",
        serde_json::json!({}),
        &[],
    );

    let response = app.oneshot(request).await.unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        json_body(response).await["error"]["message"],
        "Missing required 'code' or 'state' parameters in OAuth callback"
    );
}

#[tokio::test]
async fn cline_device_and_poll_connect_a_workos_device_account() {
    let database = TestDatabase::new().unwrap();
    let fake = FakeClineUpstream::start().await;
    fake.with(|state| state.authenticate_mode = "approved".to_owned());
    let app = cline_app(&database, &fake).await;
    let device_response = app
        .clone()
        .oneshot(admin_get("/v1/auth/cline/device"))
        .await
        .unwrap();
    assert_eq!(device_response.status(), StatusCode::OK);
    let device = json_body(device_response).await;
    assert_eq!(
        device["authorizeUrl"],
        format!("{}/device?user_code=ABCD-EFGH", fake.base_url())
    );
    assert_eq!(device["userCode"], "ABCD-EFGH");
    assert_eq!(device["expiresIn"], 300);
    assert_eq!(device["interval"], 5);
    let state = device["state"].as_str().expect("device state").to_owned();
    assert_eq!(
        fake.with(|fake| fake.last_device_form.clone()),
        "client_id=client_01K3A541FN8TA3EPPHTD2325AR"
    );

    let poll_response = app
        .clone()
        .oneshot(admin_get(&format!("/v1/auth/cline/poll?state={state}")))
        .await
        .unwrap();
    assert_eq!(poll_response.status(), StatusCode::OK);
    let connected = json_body(poll_response).await;
    assert_eq!(connected["status"], "ok");
    assert_eq!(connected["provider"]["id"], "user-1");
    assert_eq!(connected["provider"]["provider_id"], "cline");
    assert_eq!(connected["provider"]["name"], "Dev");
    assert_eq!(connected["provider"]["category"], "oauth");
    assert_eq!(connected["provider"]["protocol"], "openai");
    assert_eq!(
        fake.with(|fake| fake.last_authenticate_form.clone()),
        "grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Adevice_code&device_code=dev-1&client_id=client_01K3A541FN8TA3EPPHTD2325AR"
    );
    let db = database.connect().await.expect("temporary database");
    let credentials = load_cline_credentials(&db)
        .await
        .expect("credentials read")
        .expect("Cline connection stored");
    assert_eq!(credentials.access_token, "workos:cline-access");
    assert_eq!(credentials.refresh_token.as_deref(), Some("cline-refresh"));
    let raw = sqlx::query_scalar::<_, String>("SELECT credentials FROM providers WHERE id = ?")
        .bind("user-1")
        .fetch_one(db.sqlite_pool().expect("sqlite pool"))
        .await
        .expect("credentials JSON");
    let value: serde_json::Value = serde_json::from_str(&raw).expect("credentials JSON parses");
    assert_eq!(
        value["provider_specific_data"]["authMethod"],
        "workos-device"
    );
}

#[tokio::test]
async fn cline_poll_handles_pending_denied_unknown_and_missing_state() {
    let database = TestDatabase::new().unwrap();
    let fake = FakeClineUpstream::start().await;
    let app = cline_app(&database, &fake).await;

    let device = json_body(
        app.clone()
            .oneshot(admin_get("/v1/auth/cline/device"))
            .await
            .unwrap(),
    )
    .await;
    let state = device["state"].as_str().expect("device state");
    let pending = json_body(
        app.clone()
            .oneshot(admin_get(&format!("/v1/auth/cline/poll?state={state}")))
            .await
            .unwrap(),
    )
    .await;
    assert_eq!(pending["status"], "pending");
    assert!(pending.get("error").is_none());

    let post = with_loopback_client(
        Request::builder()
            .method("POST")
            .uri("/v1/auth/cline/poll")
            .header("cookie", format!("srouter_admin_session={SESSION_TOKEN}"))
            .header("content-type", "application/json")
            .body(Body::from(
                serde_json::json!({ "state": state }).to_string(),
            ))
            .unwrap(),
    );
    let post_pending = json_body(app.clone().oneshot(post).await.unwrap()).await;
    assert_eq!(post_pending["status"], "pending");

    fake.with(|fake| fake.authenticate_mode = "denied".to_owned());

    let fallback_database = TestDatabase::new().unwrap();
    let fallback_fake = FakeClineUpstream::start().await;
    fallback_fake.with(|fake| {
        fake.authenticate_mode = "approved".to_owned();
        fake.register_user_id.clear();
        fake.register_name.clear();
        fake.register_email.clear();
    });
    let fallback_app = cline_app(&fallback_database, &fallback_fake).await;
    let fallback_device = json_body(
        fallback_app
            .clone()
            .oneshot(admin_get("/v1/auth/cline/device"))
            .await
            .unwrap(),
    )
    .await;
    let fallback_state = fallback_device["state"].as_str().expect("device state");
    let fallback_connected = json_body(
        fallback_app
            .oneshot(admin_get(&format!(
                "/v1/auth/cline/poll?state={fallback_state}"
            )))
            .await
            .unwrap(),
    )
    .await;
    assert_eq!(fallback_connected["status"], "ok");
    assert!(
        fallback_connected["provider"]["id"]
            .as_str()
            .unwrap()
            .starts_with("cline_")
    );
    assert!(
        fallback_connected["provider"]["name"]
            .as_str()
            .unwrap()
            .starts_with("Cline (Account #")
    );

    fake.with(|fake| fake.authenticate_mode = "denied".to_owned());
    let denied = json_body(
        app.clone()
            .oneshot(admin_get(&format!("/v1/auth/cline/poll?state={state}")))
            .await
            .unwrap(),
    )
    .await;
    assert_eq!(denied["status"], "pending");
    assert_eq!(denied["error"], "access_denied");

    let unknown = json_body(
        app.clone()
            .oneshot(admin_get("/v1/auth/cline/poll?state=unknown"))
            .await
            .unwrap(),
    )
    .await;
    assert_eq!(unknown["status"], "pending");
    assert_eq!(unknown["error"], "Session expired or not found");

    let missing = app
        .clone()
        .oneshot(admin_get("/v1/auth/cline/poll"))
        .await
        .unwrap();
    assert_eq!(missing.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        json_body(missing).await["error"]["message"],
        "Missing state parameter"
    );
}

#[tokio::test]
async fn cline_device_and_poll_require_an_admin_session() {
    let database = TestDatabase::new().unwrap();
    let fake = FakeClineUpstream::start().await;
    let app = cline_app(&database, &fake).await;
    for uri in [
        "/v1/auth/cline/device",
        "/v1/auth/cline/poll?state=anything",
    ] {
        let response = app
            .clone()
            .oneshot(with_loopback_client(
                Request::builder()
                    .method("GET")
                    .uri(uri)
                    .body(Body::empty())
                    .unwrap(),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED, "{uri}");
    }
}

#[tokio::test]
async fn update_cline_tokens_persists_rotated_credentials() {
    let database = TestDatabase::new().unwrap();
    let db = database.connect().await.expect("temporary database");
    upsert_cline_connection(
        &db,
        &ClineConnectionWrite {
            id: "user-1".to_owned(),
            name: "Dev".to_owned(),
            access_token: "workos:old-access".to_owned(),
            refresh_token: Some("workos:old-refresh".to_owned()),
            token_expires_at: Some(1),
            email: "dev@example.com".to_owned(),
        },
    )
    .await
    .expect("connection stored");

    update_cline_tokens(
        &db,
        "user-1",
        "workos:new-access",
        "workos:new-refresh",
        Some(42),
        99,
    )
    .await
    .expect("tokens updated");

    let credentials = load_cline_credentials(&db)
        .await
        .expect("credentials read")
        .expect("Cline connection stored");
    assert_eq!(credentials.access_token, "workos:new-access");
    assert_eq!(
        credentials.refresh_token.as_deref(),
        Some("workos:new-refresh")
    );
    assert_eq!(credentials.token_expires_at, Some(42));
    assert_eq!(credentials.last_refreshed_at, Some(99));
}
