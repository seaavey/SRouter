//! HTTP-level checks for Cline chat and model requests against a local fake.

mod support;

use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode, Version, header},
};
use srouter_server::SecurityState;
use srouter_server::app::create_router;
use support::{
    FakeClineUpstream, TestDatabase, cline_registry, connect_cline, test_config,
    with_loopback_client,
};
use tower::ServiceExt;

async fn app(database: &TestDatabase, fake: &FakeClineUpstream) -> Router {
    let database = database.connect().await.expect("temporary database");
    let state = srouter_server::AppState::with_security(
        test_config(),
        cline_registry(Some(database.clone()), fake),
        SecurityState::unconfigured(),
    )
    .with_database(database);
    create_router(state)
}

fn request(uri: &str, body: serde_json::Value) -> Request<Body> {
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

#[tokio::test]
async fn cline_stream_fragments_survive_and_done_is_emitted_once() {
    let database = TestDatabase::new().expect("temporary database");
    connect_cline(&database).await;
    let fake = FakeClineUpstream::start().await;
    fake.with(|state| state.chat_mode = "fragmented".to_owned());
    let app = app(&database, &fake).await;

    let response = app
        .oneshot(request(
            "/v1/chat/completions",
            chat_body("cline/anthropic/claude-sonnet-5.5", true),
        ))
        .await
        .expect("gateway response");
    assert_eq!(response.status(), StatusCode::OK);
    let body = text_body(response).await;
    assert!(body.contains("Hello"));
    assert!(body.contains(" world"));
    assert_eq!(body.matches("data: [DONE]").count(), 1);
}

#[tokio::test]
async fn cline_midstream_errors_become_error_events() {
    for mode in ["root_error", "choice_error", "failure_envelope"] {
        let database = TestDatabase::new().expect("temporary database");
        connect_cline(&database).await;
        let fake = FakeClineUpstream::start().await;
        fake.with(|state| state.chat_mode = mode.to_owned());
        let app = app(&database, &fake).await;
        let response = app
            .oneshot(request(
                "/v1/chat/completions",
                chat_body("cline/anthropic/claude-sonnet-5.5", true),
            ))
            .await
            .expect("gateway response");
        assert_eq!(response.status(), StatusCode::OK);
        let body = text_body(response).await;
        assert!(
            body.contains("\"message\":\"boom\"") || body.contains("\"message\":\"denied\""),
            "mode={mode}: {body}"
        );
        assert!(
            !body.contains("finish_reason\\\":\\\"error"),
            "mode={mode}: {body}"
        );
    }
}

#[tokio::test]
async fn cline_non_stream_aggregates_content_reasoning_tools_and_usage() {
    let database = TestDatabase::new().expect("temporary database");
    connect_cline(&database).await;
    let fake = FakeClineUpstream::start().await;
    fake.with(|state| state.chat_mode = "aggregate".to_owned());
    let app = app(&database, &fake).await;

    let response = app
        .oneshot(request(
            "/v1/chat/completions",
            chat_body("cline/anthropic/claude-sonnet-5.5", false),
        ))
        .await
        .expect("gateway response");
    assert_eq!(response.status(), StatusCode::OK);
    let body = json_body(response).await;
    assert_eq!(body["choices"][0]["message"]["content"], "answer");
    assert_eq!(body["choices"][0]["message"]["reasoning"], "think ");
    assert_eq!(
        body["choices"][0]["message"]["tool_calls"][0]["id"],
        "call-1"
    );
    assert_eq!(
        body["choices"][0]["message"]["tool_calls"][0]["function"]["name"],
        "lookup"
    );
    assert_eq!(body["choices"][0]["finish_reason"], "tool_calls");
    assert_eq!(body["usage"]["prompt_tokens"], 8);
    assert_eq!(body["usage"]["completion_tokens"], 9);
}

#[tokio::test]
async fn cline_request_uses_bare_model_forced_stream_and_single_workos_prefix() {
    let database = TestDatabase::new().expect("temporary database");
    connect_cline(&database).await;
    let fake = FakeClineUpstream::start().await;
    let app = app(&database, &fake).await;

    let response = app
        .oneshot(request(
            "/v1/chat/completions",
            chat_body("cline/anthropic/claude-sonnet-5.5", false),
        ))
        .await
        .expect("gateway response");
    assert_eq!(response.status(), StatusCode::OK);
    let _ = json_body(response).await;
    let body = fake.with(|state| state.last_chat_body.clone());
    assert_eq!(body["model"], "anthropic/claude-sonnet-5.5");
    assert_eq!(body["stream"], true);
    assert_eq!(
        fake.with(|state| state.last_authorization.clone()),
        "Bearer workos:cline-access"
    );
}

#[tokio::test]
async fn cline_catalog_merges_the_curated_free_ids_and_chat_sends_one_bare() {
    let database = TestDatabase::new().expect("temporary database");
    connect_cline(&database).await;
    let fake = FakeClineUpstream::start().await;
    let app = app(&database, &fake).await;

    let response = app
        .clone()
        .oneshot(with_loopback_client(
            Request::builder()
                .method("GET")
                .uri("/v1/models")
                .version(Version::HTTP_11)
                .body(Body::empty())
                .expect("models request"),
        ))
        .await
        .expect("models response");
    assert_eq!(response.status(), StatusCode::OK);
    let body = json_body(response).await;
    let ids: Vec<String> = body["data"]
        .as_array()
        .expect("model list")
        .iter()
        .filter_map(|entry| entry["id"].as_str().map(str::to_owned))
        .collect();
    assert!(
        ids.contains(&"cline/cline-free/deepseek-v4.1-flash".to_owned()),
        "the curated free id must be advertised: {ids:?}"
    );
    assert!(ids.contains(&"cline/anthropic/claude-sonnet-5.5".to_owned()));
    assert_eq!(fake.with(|state| state.recommended_requests), 1);

    let response = app
        .oneshot(request(
            "/v1/chat/completions",
            chat_body("cline/cline-free/deepseek-v4.1-flash", false),
        ))
        .await
        .expect("gateway response");
    assert_eq!(response.status(), StatusCode::OK);
    let _ = json_body(response).await;
    let body = fake.with(|state| state.last_chat_body.clone());
    assert_eq!(body["model"], "cline-free/deepseek-v4.1-flash");
    assert_eq!(
        fake.with(|state| state.last_client_type.clone()),
        "cline-cli",
        "upstream refuses the free models without the product-surface header"
    );
}

#[tokio::test]
async fn no_cline_connection_returns_not_connected_and_messages_route_smokes() {
    let database = TestDatabase::new().expect("temporary database");
    let fake = FakeClineUpstream::start().await;
    let app = app(&database, &fake).await;
    let rejected = app
        .clone()
        .oneshot(request(
            "/v1/chat/completions",
            chat_body("cline/anthropic/claude-sonnet-5.5", false),
        ))
        .await
        .expect("gateway response");
    assert_eq!(rejected.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(
        json_body(rejected).await["error"]["message"],
        "No active Cline connection found. Connect the Cline account in the Providers tab."
    );

    connect_cline(&database).await;
    let response = app
        .oneshot(with_loopback_client(
            Request::builder()
                .method("POST")
                .uri("/v1/messages")
                .version(Version::HTTP_11)
                .header(header::CONTENT_TYPE, "application/json")
                .header("anthropic-version", "2023-06-01")
                .body(Body::from(
                    serde_json::json!({
                        "model": "cline/anthropic/claude-sonnet-5.5",
                        "messages": [{ "role": "user", "content": "Hello" }],
                        "max_tokens": 1024,
                        "stream": false
                    })
                    .to_string(),
                ))
                .expect("messages request"),
        ))
        .await
        .expect("messages response");
    assert_eq!(response.status(), StatusCode::OK);
    let body = json_body(response).await;
    assert_eq!(body["type"], "message");
    assert_eq!(body["stop_reason"], "end_turn");
}
