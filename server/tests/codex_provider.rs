//! HTTP-level checks for the Codex provider against a local fake upstream.

mod support;

use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode, Version, header},
};
use srouter_server::SecurityState;
use srouter_server::app::create_router;
use srouter_server::clock::now_ms;
use support::TestDatabase;
use support::codex_fake::{FakeCodexUpstream, codex_registry, connect_codex};
use support::{test_config, with_loopback_client};
use tower::ServiceExt;

async fn app(database: &TestDatabase, fake: &FakeCodexUpstream) -> Router {
    let database = database.connect().await.expect("temporary database");
    let state = srouter_server::AppState::with_security(
        test_config(),
        codex_registry(Some(database.clone()), fake),
        SecurityState::unconfigured(),
    )
    .with_database(database);
    create_router(state)
}

fn post_request(uri: &str, body: serde_json::Value) -> Request<Body> {
    with_loopback_client(
        Request::builder()
            .method("POST")
            .uri(uri)
            .version(Version::HTTP_11)
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(serde_json::to_vec(&body).expect("request JSON")))
            .expect("request"),
    )
}

fn get_request(uri: &str) -> Request<Body> {
    with_loopback_client(
        Request::builder()
            .method("GET")
            .uri(uri)
            .body(Body::empty())
            .expect("request"),
    )
}

fn chat_body(model: &str, stream: bool) -> serde_json::Value {
    serde_json::json!({
        "model": model,
        "messages": [{ "role": "user", "content": "Hello" }],
        "max_tokens": 1024,
        "stream": stream
    })
}

async fn text_body(response: axum::response::Response) -> String {
    let bytes = to_bytes(response.into_body(), 65_536)
        .await
        .expect("response body");
    String::from_utf8(bytes.to_vec()).expect("response text")
}

async fn json_body(response: axum::response::Response) -> serde_json::Value {
    let bytes = to_bytes(response.into_body(), 65_536)
        .await
        .expect("response body");
    serde_json::from_slice(&bytes).expect("response JSON")
}

async fn catalog_ids(app: &Router) -> Vec<String> {
    let response = app
        .clone()
        .oneshot(get_request("/v1/models"))
        .await
        .expect("models response");
    assert_eq!(response.status(), StatusCode::OK);

    json_body(response).await["data"]
        .as_array()
        .expect("model list")
        .iter()
        .map(|entry| entry["id"].as_str().expect("model id").to_owned())
        .collect()
}

#[tokio::test]
async fn codex_models_appear_only_for_a_connected_account() {
    let database = TestDatabase::new().expect("temporary database");
    let fake = FakeCodexUpstream::start().await;
    let app = app(&database, &fake).await;

    let unconnected = catalog_ids(&app).await;
    assert!(
        unconnected
            .iter()
            .all(|id| !id.starts_with("openai_codex/")),
        "{unconnected:?}"
    );

    connect_codex(&database, Some(now_ms() + 86_400_000)).await;
    let connected = catalog_ids(&app).await;
    assert!(connected.contains(&"openai_codex/gpt-6.1-sol".to_owned()));
    assert!(connected.contains(&"openai_codex/gpt-6-luna".to_owned()));
    assert!(!connected.contains(&"openai_codex/gpt-reserve".to_owned()));
    assert_eq!(
        connected
            .iter()
            .filter(|id| id.starts_with("openai_codex/"))
            .count(),
        2
    );
    assert_eq!(fake.models_requests(), 1);
}

#[tokio::test]
async fn codex_models_disappear_after_the_last_connection_is_removed_and_registry_refreshes() {
    let database = TestDatabase::new().expect("temporary database");
    connect_codex(&database, Some(now_ms() + 86_400_000)).await;
    let fake = FakeCodexUpstream::start().await;
    let app = app(&database, &fake).await;

    assert!(
        catalog_ids(&app)
            .await
            .contains(&"openai_codex/gpt-6.1-sol".to_owned())
    );

    let db = database.connect().await.expect("temporary database");
    let deleted = sqlx::query("DELETE FROM providers WHERE id = 'codex-account'")
        .execute(db.sqlite_pool().expect("sqlite pool"))
        .await
        .unwrap();
    assert_eq!(deleted.rows_affected(), 1);

    let models = catalog_ids(&app).await;
    assert!(
        models.iter().all(|id| !id.starts_with("openai_codex/")),
        "deleted account must be absent from catalog: {models:?}"
    );
    assert_eq!(fake.models_requests(), 1);
}

#[tokio::test]
async fn codex_stream_translates_responses_events_and_carries_the_session_headers() {
    let database = TestDatabase::new().expect("temporary database");
    connect_codex(&database, Some(now_ms() + 86_400_000)).await;
    let fake = FakeCodexUpstream::start().await;
    let app = app(&database, &fake).await;

    let response = app
        .clone()
        .oneshot(post_request(
            "/v1/chat/completions",
            chat_body("openai_codex/gpt-6.1-sol", true),
        ))
        .await
        .expect("gateway response");
    assert_eq!(response.status(), StatusCode::OK);
    let body = text_body(response).await;

    assert!(body.contains("\"Hello\""), "{body}");
    assert!(body.contains("\" world\""), "{body}");
    assert!(body.contains("\"finish_reason\":\"stop\""), "{body}");
    assert!(body.contains("\"prompt_tokens\":5"), "{body}");
    assert_eq!(body.matches("data: [DONE]").count(), 1, "{body}");

    let (authorization, account_id, originator, model) = fake.with(|state| {
        (
            state.last_authorization.clone(),
            state.last_account_id.clone(),
            state.last_originator.clone(),
            state.last_chat_body["model"]
                .as_str()
                .unwrap_or_default()
                .to_owned(),
        )
    });
    assert_eq!(authorization, "Bearer chatgpt-access");
    assert_eq!(account_id, "acct-1");
    assert_eq!(originator, "codex_cli_rs");
    assert_eq!(model, "gpt-6.1-sol", "the bare slug goes upstream");
}

#[tokio::test]
async fn a_fragmented_responses_stream_is_reassembled() {
    let database = TestDatabase::new().expect("temporary database");
    connect_codex(&database, Some(now_ms() + 86_400_000)).await;
    let fake = FakeCodexUpstream::start().await;
    fake.with(|state| state.chat_mode = "fragmented".to_owned());
    let app = app(&database, &fake).await;

    let response = app
        .clone()
        .oneshot(post_request(
            "/v1/chat/completions",
            chat_body("openai_codex/gpt-6.1-sol", true),
        ))
        .await
        .expect("gateway response");
    assert_eq!(response.status(), StatusCode::OK);
    let body = text_body(response).await;

    assert!(body.contains("\"Hello\""), "{body}");
    assert!(body.contains("\" world\""), "{body}");
    assert_eq!(body.matches("data: [DONE]").count(), 1, "{body}");
}

#[tokio::test]
async fn codex_non_stream_aggregates_tools_and_usage() {
    let database = TestDatabase::new().expect("temporary database");
    connect_codex(&database, Some(now_ms() + 86_400_000)).await;
    let fake = FakeCodexUpstream::start().await;
    fake.with(|state| state.chat_mode = "tools".to_owned());
    let app = app(&database, &fake).await;

    let response = app
        .clone()
        .oneshot(post_request(
            "/v1/chat/completions",
            chat_body("openai_codex/gpt-6.1-sol", false),
        ))
        .await
        .expect("gateway response");
    assert_eq!(response.status(), StatusCode::OK);
    let body = json_body(response).await;

    assert_eq!(body["object"], "chat.completion");
    assert_eq!(body["model"], "gpt-6.1-sol");
    assert_eq!(body["choices"][0]["finish_reason"], "tool_calls");
    assert_eq!(
        body["choices"][0]["message"]["tool_calls"][0]["function"]["name"],
        "lookup"
    );
    assert_eq!(
        body["choices"][0]["message"]["tool_calls"][0]["function"]["arguments"],
        "{\"q\":\"bmw\"}"
    );
    assert_eq!(body["usage"]["prompt_tokens"], 5);
    assert_eq!(body["usage"]["completion_tokens"], 7);
}

#[tokio::test]
async fn a_failed_responses_event_ends_the_stream_with_an_error_event() {
    let database = TestDatabase::new().expect("temporary database");
    connect_codex(&database, Some(now_ms() + 86_400_000)).await;
    let fake = FakeCodexUpstream::start().await;
    fake.with(|state| state.chat_mode = "failed".to_owned());
    let app = app(&database, &fake).await;

    let response = app
        .clone()
        .oneshot(post_request(
            "/v1/chat/completions",
            chat_body("openai_codex/gpt-6.1-sol", true),
        ))
        .await
        .expect("gateway response");
    assert_eq!(response.status(), StatusCode::OK);
    let body = text_body(response).await;

    assert!(body.contains("quota blown"), "{body}");
    assert!(!body.contains("[DONE]"), "{body}");
}

#[tokio::test]
async fn an_expired_token_is_refreshed_before_the_chat() {
    let database = TestDatabase::new().expect("temporary database");
    connect_codex(&database, Some(now_ms() - 1_000)).await;
    let fake = FakeCodexUpstream::start().await;
    let app = app(&database, &fake).await;

    let response = app
        .clone()
        .oneshot(post_request(
            "/v1/chat/completions",
            chat_body("openai_codex/gpt-6.1-sol", true),
        ))
        .await
        .expect("gateway response");
    assert_eq!(response.status(), StatusCode::OK);
    let body = text_body(response).await;
    assert!(body.contains("\"Hello\""), "the chat must succeed: {body}");

    assert_eq!(fake.refresh_requests(), 1);
    let (authorization, form) = fake.with(|state| {
        (
            state.last_authorization.clone(),
            state.last_refresh_form.clone(),
        )
    });
    assert_eq!(authorization, "Bearer new-access");
    assert!(form.contains("grant_type=refresh_token"), "{form}");
    assert!(form.contains("refresh_token=chatgpt-refresh"), "{form}");
    assert!(form.contains("client_id="), "{form}");

    // The rotated session was persisted, not only used in memory.
    let database = database.connect().await.expect("temporary database");
    let stored =
        srouter_server::infrastructure::database::providers::load_codex_credentials(&database)
            .await
            .expect("credentials read")
            .expect("connection exists");
    assert_eq!(stored.access_token, "new-access");
    assert_eq!(stored.refresh_token.as_deref(), Some("new-refresh"));
    assert_eq!(stored.account_id.as_deref(), Some("acct-1"));
}

#[tokio::test]
async fn a_revoked_token_surfaces_the_reconnect_message() {
    let database = TestDatabase::new().expect("temporary database");
    connect_codex(&database, Some(now_ms() + 86_400_000)).await;
    let fake = FakeCodexUpstream::start().await;
    fake.with(|state| state.chat_mode = "unauthorized".to_owned());
    let app = app(&database, &fake).await;

    let response = app
        .clone()
        .oneshot(post_request(
            "/v1/chat/completions",
            chat_body("openai_codex/gpt-6.1-sol", true),
        ))
        .await
        .expect("gateway response");
    assert_eq!(response.status(), StatusCode::OK);
    let body = text_body(response).await;

    assert!(
        body.contains("reconnect the OpenAI Codex account"),
        "the 401 must surface the reconnect message, got: {body}"
    );
    assert_eq!(
        fake.with(|state| state.chat_requests),
        2,
        "a 401 is retried once after a forced refresh"
    );
}

#[tokio::test]
async fn a_chat_without_a_connection_reports_not_connected() {
    let database = TestDatabase::new().expect("temporary database");
    let fake = FakeCodexUpstream::start().await;
    let app = app(&database, &fake).await;

    let response = app
        .clone()
        .oneshot(post_request(
            "/v1/chat/completions",
            chat_body("openai_codex/gpt-6.1-sol", true),
        ))
        .await
        .expect("gateway response");
    assert_eq!(response.status(), StatusCode::OK);
    let body = text_body(response).await;

    assert!(body.contains("Connect the OpenAI Codex account"), "{body}");
    assert_eq!(
        fake.chat_requests(),
        0,
        "no upstream call without a session"
    );
}

#[tokio::test]
async fn codex_chat_supports_dot_variant_and_chat_route() {
    let database = TestDatabase::new().expect("temporary database");
    connect_codex(&database, None).await;
    let fake = FakeCodexUpstream::start().await;
    let app = app(&database, &fake).await;

    // Both /v1/chat and bare "gpt-6.luna" should resolve and translate to upstream "gpt-6-luna"
    let response = app
        .clone()
        .oneshot(post_request("/v1/chat", chat_body("gpt-6.luna", false)))
        .await
        .expect("gateway response");
    let status = response.status();
    let body = text_body(response).await;
    assert_eq!(status, StatusCode::OK, "response failed with: {body}");

    let upstream_payload = fake.with(|state| state.last_chat_body.clone());
    assert_eq!(upstream_payload["model"], "gpt-6-luna");
}

#[tokio::test]
async fn sweeper_refreshes_due_tokens_in_the_background() {
    let database = TestDatabase::new().expect("temporary database");
    connect_codex(&database, Some(now_ms() - 1_000)).await;
    let fake = FakeCodexUpstream::start().await;
    let app_db = database.connect().await.expect("temporary database");
    let registry = codex_registry(Some(app_db.clone()), &fake);

    assert_eq!(fake.refresh_requests(), 0);

    // Run a sweep cycle
    registry.sweep_tokens().await;

    // The due token was refreshed by the sweeper
    assert_eq!(fake.refresh_requests(), 1);

    // Stored credentials reflect the rotated tokens
    let stored =
        srouter_server::infrastructure::database::providers::load_codex_credentials(&app_db)
            .await
            .expect("read credentials")
            .expect("connection exists");
    assert_eq!(stored.access_token, "new-access");
    assert_eq!(stored.refresh_token.as_deref(), Some("new-refresh"));
}
