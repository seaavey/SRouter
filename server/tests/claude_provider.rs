//! Gateway tests for the `claude` provider: the connection-gated live catalog,
//! the Anthropic Messages transport, the request headers, the OpenAI response
//! translation, and the lazy OAuth refresh. The upstream is the fake Claude
//! host, so nothing here reaches the network.

mod support;

use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode, Version, header},
    response::Response,
};
use srouter_server::SecurityState;
use srouter_server::app::create_router;
use srouter_server::infrastructure::database::providers::{
    ClaudeConnectionWrite, load_claude_credentials, upsert_claude_connection,
};
use support::{
    FakeClaudeUpstream, TestDatabase, claude_state, connect_claude, with_loopback_client,
};
use tower::ServiceExt;

async fn app(database: &TestDatabase, fake: &FakeClaudeUpstream) -> Router {
    create_router(claude_state(
        database.connect().await.expect("temporary database"),
        SecurityState::unconfigured(),
        fake,
    ))
}

fn post(uri: &str, body: serde_json::Value) -> Request<Body> {
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

fn models_request() -> Request<Body> {
    with_loopback_client(
        Request::builder()
            .method("GET")
            .uri("/v1/models")
            .version(Version::HTTP_11)
            .body(Body::empty())
            .expect("models request"),
    )
}

fn chat_body(model: &str, stream: bool) -> serde_json::Value {
    serde_json::json!({
        "model": model,
        "messages": [
            { "role": "system", "content": "Be terse." },
            { "role": "user", "content": "Hello" }
        ],
        "stream": stream
    })
}

async fn text_body(response: Response) -> String {
    let bytes = to_bytes(response.into_body(), 1_048_576)
        .await
        .expect("response body");

    String::from_utf8(bytes.to_vec()).expect("response text")
}

async fn json_body(response: Response) -> serde_json::Value {
    let bytes = to_bytes(response.into_body(), 1_048_576)
        .await
        .expect("response body");

    serde_json::from_slice(&bytes).expect("response JSON")
}

#[tokio::test]
async fn the_catalog_is_gated_on_the_connection() {
    let database = TestDatabase::new().unwrap();
    let fake = FakeClaudeUpstream::start().await;
    let app = app(&database, &fake).await;

    // No connection: the catalog advertises no claude model.
    let body = json_body(app.clone().oneshot(models_request()).await.unwrap()).await;
    assert!(
        !body["data"]
            .as_array()
            .unwrap()
            .iter()
            .any(|model| model["id"].as_str().is_some_and(|id| id.contains("claude"))),
        "no claude model before a connection"
    );

    connect_claude(&database).await;

    let body = json_body(app.oneshot(models_request()).await.unwrap()).await;
    let ids: Vec<&str> = body["data"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|model| model["id"].as_str())
        .collect();
    assert!(
        ids.iter().any(|id| id.contains("claude-sonnet-4-5")),
        "the live catalog is advertised once connected: {ids:?}"
    );
    assert!(fake.model_requests() >= 1);
}

#[tokio::test]
async fn the_non_stream_translates_the_anthropic_response() {
    let database = TestDatabase::new().unwrap();
    let fake = FakeClaudeUpstream::start().await;
    connect_claude(&database).await;
    let app = app(&database, &fake).await;

    let response = app
        .oneshot(post(
            "/v1/chat/completions",
            chat_body("claude/claude-sonnet-4-5", false),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    let body = json_body(response).await;
    assert_eq!(
        body["choices"][0]["message"]["content"],
        "fake upstream reply"
    );
    assert_eq!(body["choices"][0]["finish_reason"], "stop");
    assert_eq!(body["usage"]["prompt_tokens"], 5);
    assert_eq!(body["usage"]["completion_tokens"], 7);
    assert_eq!(body["usage"]["total_tokens"], 12);
}

#[tokio::test]
async fn the_request_carries_the_anthropic_headers_and_body() {
    let database = TestDatabase::new().unwrap();
    let fake = FakeClaudeUpstream::start().await;
    connect_claude(&database).await;
    let app = app(&database, &fake).await;

    app.oneshot(post(
        "/v1/chat/completions",
        chat_body("claude/claude-sonnet-4-5", false),
    ))
    .await
    .unwrap();

    assert_eq!(
        fake.with(|state| state.last_authorization.clone()),
        "Bearer sk-ant-oat01-fixture"
    );
    assert!(
        fake.with(|state| state.last_anthropic_beta.clone())
            .contains("claude-code-20250219")
    );

    let sent = fake.with(|state| state.last_chat_body.clone());
    assert_eq!(
        sent["model"], "claude-sonnet-4-5",
        "the provider prefix is stripped"
    );
    // The Token Saver appends a fixed directive to the system prompt, so the
    // captured text starts with the caller's prompt.
    assert!(
        sent["system"]
            .as_str()
            .is_some_and(|system| system.starts_with("Be terse.")),
        "the system prompt survives: {}",
        sent["system"]
    );
    assert_eq!(
        sent["max_tokens"], 4096,
        "a missing max_tokens defaults to 4096"
    );
    assert_eq!(sent["messages"].as_array().unwrap().len(), 1);
    assert_eq!(sent["messages"][0]["role"], "user");
}

#[tokio::test]
async fn the_stream_re_frames_anthropic_events() {
    let database = TestDatabase::new().unwrap();
    let fake = FakeClaudeUpstream::start().await;
    connect_claude(&database).await;
    let app = app(&database, &fake).await;

    let response = app
        .oneshot(post(
            "/v1/chat/completions",
            chat_body("claude/claude-sonnet-4-5", true),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    let stream = text_body(response).await;
    assert!(stream.contains("\"content\":\"Hello\""), "{stream}");
    assert!(stream.contains("\"content\":\" world\""), "{stream}");
    assert!(stream.contains("\"finish_reason\":\"stop\""), "{stream}");
    assert!(stream.trim_end().ends_with("data: [DONE]"), "{stream}");
}

#[tokio::test]
async fn expired_credentials_refresh_against_the_fake_and_persist() {
    let database = TestDatabase::new().unwrap();
    let fake = FakeClaudeUpstream::start().await;

    // A connection whose access token has already lapsed forces the refresh.
    let app_database = database.connect().await.expect("temporary database");
    upsert_claude_connection(
        &app_database,
        &ClaudeConnectionWrite {
            id: "claude_stale".to_owned(),
            name: "Claude stale".to_owned(),
            access_token: "sk-ant-oat01-stale".to_owned(),
            refresh_token: Some("sk-ant-ort01-stale".to_owned()),
            expires_at: Some(srouter_server::clock::now_ms() - 1_000),
            organization_id: None,
        },
    )
    .await
    .expect("stale connection stored");

    let app = app(&database, &fake).await;
    let response = app
        .oneshot(post(
            "/v1/chat/completions",
            chat_body("claude/claude-sonnet-4-5", false),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(fake.token_requests(), 1, "the expired token was refreshed");

    let credentials = load_claude_credentials(&app_database)
        .await
        .expect("credentials read")
        .expect("the connection remains");
    assert_eq!(credentials.access_token, "sk-ant-oat01-fresh");
    assert_eq!(
        credentials.refresh_token.as_deref(),
        Some("sk-ant-ort01-rotated")
    );
}
