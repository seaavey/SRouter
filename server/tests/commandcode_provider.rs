//! HTTP-level checks for Command Code chat, streaming, tool calls, and the live
//! model catalog against a local fake relay.

mod support;

use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode, Version, header},
};
use srouter_server::SecurityState;
use srouter_server::app::create_router;
use support::{
    FakeCommandCodeUpstream, TestDatabase, commandcode_registry, connect_commandcode, test_config,
    with_loopback_client,
};
use tower::ServiceExt;

async fn app(database: &TestDatabase, fake: &FakeCommandCodeUpstream) -> Router {
    let database = database.connect().await.expect("temporary database");
    let state = srouter_server::AppState::with_security(
        test_config(),
        commandcode_registry(Some(database.clone()), fake),
        SecurityState::unconfigured(),
    )
    .with_database(database);
    create_router(state)
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

fn model_ids(body: &serde_json::Value) -> Vec<String> {
    body["data"]
        .as_array()
        .expect("model list")
        .iter()
        .filter_map(|entry| entry["id"].as_str().map(str::to_owned))
        .collect()
}

#[tokio::test]
async fn a_buffered_completion_is_aggregated_from_the_ndjson_stream() {
    let database = TestDatabase::new().expect("temporary database");
    connect_commandcode(&database, "primary").await;
    let fake = FakeCommandCodeUpstream::start().await;
    let app = app(&database, &fake).await;

    let response = app
        .oneshot(post(
            "/v1/chat/completions",
            chat_body("commandcode/deepseek/deepseek-v4.1-flash", false),
        ))
        .await
        .expect("gateway response");

    assert_eq!(response.status(), StatusCode::OK);
    let body = json_body(response).await;
    assert_eq!(body["object"], "chat.completion");
    assert_eq!(body["choices"][0]["message"]["content"], "Hello world");
    assert_eq!(body["choices"][0]["finish_reason"], "stop");
    assert_eq!(body["usage"]["prompt_tokens"], 5);
    assert_eq!(body["usage"]["completion_tokens"], 2);
    assert_eq!(body["usage"]["total_tokens"], 7);
    assert_eq!(body["usage"]["prompt_tokens_details"]["cached_tokens"], 3);

    let upstream = fake.last_generate_body();
    assert_eq!(upstream["params"]["model"], "deepseek/deepseek-v4.1-flash");
    assert_eq!(upstream["params"]["stream"], true);
    assert_eq!(upstream["mode"], "agent");
    assert!(
        upstream["config"].get("date").is_none(),
        "the snapshot carries no date"
    );
    assert_eq!(fake.last_authorization(), "Bearer fixture-commandcode-key");
    assert!(
        !fake.last_session_id().is_empty(),
        "every request carries a fresh session id"
    );
}

#[tokio::test]
async fn a_streamed_completion_frames_every_event_and_terminates() {
    let database = TestDatabase::new().expect("temporary database");
    connect_commandcode(&database, "primary").await;
    let fake = FakeCommandCodeUpstream::start().await;
    let app = app(&database, &fake).await;

    let response = app
        .oneshot(post(
            "/v1/chat/completions",
            chat_body("commandcode/deepseek/deepseek-v4.1-flash", true),
        ))
        .await
        .expect("gateway response");

    assert_eq!(response.status(), StatusCode::OK);
    let body = text_body(response).await;
    assert!(body.contains("data: {"), "frames are SSE: {body}");
    assert!(body.contains("\"content\":\"Hello\""), "{body}");
    assert!(body.contains("\"content\":\" world\""), "{body}");
    assert!(body.contains("\"finish_reason\":\"stop\""), "{body}");
    assert!(
        body.contains("data: [DONE]"),
        "the stream terminates: {body}"
    );
    assert_eq!(fake.generate_requests(), 1);
}

#[tokio::test]
async fn a_tool_call_survives_the_round_trip() {
    let database = TestDatabase::new().expect("temporary database");
    connect_commandcode(&database, "primary").await;
    let fake = FakeCommandCodeUpstream::start().await;
    fake.set_generate_mode("tool");
    let app = app(&database, &fake).await;

    let response = app
        .oneshot(post(
            "/v1/chat/completions",
            chat_body("commandcode/Qwen/Qwen3.8-Max-0902", false),
        ))
        .await
        .expect("gateway response");

    assert_eq!(response.status(), StatusCode::OK);
    let body = json_body(response).await;
    assert_eq!(body["choices"][0]["finish_reason"], "tool_calls");
    assert_eq!(body["choices"][0]["message"]["content"], "Let me look.");
    let calls = body["choices"][0]["message"]["tool_calls"]
        .as_array()
        .expect("tool calls");
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0]["id"], "call-1");
    assert_eq!(calls[0]["function"]["name"], "read_file");
    assert_eq!(calls[0]["function"]["arguments"], "{\"path\":\"/tmp/a\"}");
}

#[tokio::test]
async fn an_in_stream_error_fails_the_turn_instead_of_returning_empty_content() {
    let database = TestDatabase::new().expect("temporary database");
    connect_commandcode(&database, "primary").await;
    let fake = FakeCommandCodeUpstream::start().await;
    let app = app(&database, &fake).await;

    fake.set_generate_mode("error");
    let buffered = app
        .clone()
        .oneshot(post(
            "/v1/chat/completions",
            chat_body("commandcode/deepseek/deepseek-v4.1-flash", false),
        ))
        .await
        .expect("gateway response");
    assert_eq!(buffered.status(), StatusCode::PAYMENT_REQUIRED);
    let body = json_body(buffered).await;
    assert!(
        body["error"]["message"]
            .as_str()
            .unwrap_or_default()
            .contains("Insufficient Balance"),
        "{body}"
    );

    let streamed = app
        .oneshot(post(
            "/v1/chat/completions",
            chat_body("commandcode/deepseek/deepseek-v4.1-flash", true),
        ))
        .await
        .expect("gateway response");
    assert_eq!(streamed.status(), StatusCode::OK);
    let body = text_body(streamed).await;
    assert!(body.contains("\"error\""), "{body}");
    assert!(body.contains("Insufficient Balance"), "{body}");
}

#[tokio::test]
async fn an_empty_stream_is_an_error_not_a_blank_success() {
    let database = TestDatabase::new().expect("temporary database");
    connect_commandcode(&database, "primary").await;
    let fake = FakeCommandCodeUpstream::start().await;
    fake.set_generate_mode("empty");
    let app = app(&database, &fake).await;

    let response = app
        .oneshot(post(
            "/v1/chat/completions",
            chat_body("commandcode/deepseek/deepseek-v4.1-flash", false),
        ))
        .await
        .expect("gateway response");

    assert_eq!(response.status(), StatusCode::BAD_GATEWAY);
    let body = json_body(response).await;
    assert!(
        body["error"]["message"]
            .as_str()
            .unwrap_or_default()
            .contains("empty or incomplete"),
        "{body}"
    );
}

#[tokio::test]
async fn the_catalog_advertises_the_vendor_ids_behind_the_alias() {
    let database = TestDatabase::new().expect("temporary database");
    let fake = FakeCommandCodeUpstream::start().await;
    let app = app(&database, &fake).await;

    // No connection: nothing advertised and no catalog fetch.
    let body = json_body(
        app.clone()
            .oneshot(models_request())
            .await
            .expect("models response"),
    )
    .await;
    let ids = model_ids(&body);
    assert!(!ids.iter().any(|id| id.starts_with("commandcode/")));
    assert_eq!(fake.models_requests(), 0);

    connect_commandcode(&database, "primary").await;
    let body = json_body(
        app.clone()
            .oneshot(models_request())
            .await
            .expect("models response"),
    )
    .await;
    let ids = model_ids(&body);
    assert!(
        ids.contains(&"commandcode/deepseek/deepseek-v4.1-flash".to_owned()),
        "the vendor slash survives: {ids:?}"
    );
    assert!(
        ids.contains(&"commandcode/Qwen/Qwen3.8-Max-0902".to_owned()),
        "{ids:?}"
    );
    assert_eq!(fake.models_requests(), 1);
}

#[tokio::test]
async fn an_unconnected_provider_refuses_inference() {
    let database = TestDatabase::new().expect("temporary database");
    let fake = FakeCommandCodeUpstream::start().await;
    let app = app(&database, &fake).await;

    let response = app
        .oneshot(post(
            "/v1/chat/completions",
            chat_body("commandcode/deepseek/deepseek-v4.1-flash", false),
        ))
        .await
        .expect("gateway response");

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    let body = json_body(response).await;
    assert!(
        body["error"]["message"]
            .as_str()
            .unwrap_or_default()
            .contains("Command Code connection"),
        "{body}"
    );
    assert_eq!(fake.generate_requests(), 0);
}
