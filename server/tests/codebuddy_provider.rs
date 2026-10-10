//! HTTP-level checks for CodeBuddy chat, streaming, and the live model catalog
//! against a local fake upstream.

mod support;

use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode, Version, header},
};
use srouter_server::SecurityState;
use srouter_server::app::create_router;
use support::{
    FakeCodeBuddyUpstream, TestDatabase, codebuddy_registry, connect_codebuddy, test_config,
    with_loopback_client,
};
use tower::ServiceExt;

async fn app(database: &TestDatabase, fake: &FakeCodeBuddyUpstream) -> Router {
    let database = database.connect().await.expect("temporary database");
    let state = srouter_server::AppState::with_security(
        test_config(),
        codebuddy_registry(Some(database.clone()), fake),
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
async fn codebuddy_models_come_from_the_live_catalog_and_gate_on_the_exact_connection() {
    let database = TestDatabase::new().expect("temporary database");
    let fake = FakeCodeBuddyUpstream::start().await;
    let app = app(&database, &fake).await;

    // No connection at all: no CodeBuddy ids and no catalog fetch.
    let body = json_body(
        app.clone()
            .oneshot(models_request())
            .await
            .expect("models response"),
    )
    .await;
    let ids = model_ids(&body);
    assert!(!ids.iter().any(|id| id.starts_with("codebuddy/")));
    assert!(!ids.iter().any(|id| id.starts_with("codebuddy-cn/")));
    assert_eq!(fake.config_requests(), 0);

    // Only the global connection: only the global catalog is fetched.
    connect_codebuddy(&database, "codebuddy").await;
    let body = json_body(
        app.clone()
            .oneshot(models_request())
            .await
            .expect("models response"),
    )
    .await;
    let ids = model_ids(&body);
    assert!(
        ids.contains(&"codebuddy/gpt-5.6-astra".to_owned()),
        "{ids:?}"
    );
    assert!(
        ids.contains(&"codebuddy/deepseek-v4.1-flash".to_owned()),
        "{ids:?}"
    );
    assert!(
        !ids.iter().any(|id| id.starts_with("codebuddy-cn/")),
        "the China adapter must not advertise without its own connection: {ids:?}"
    );
    assert_eq!(fake.config_requests(), 1);
}

#[tokio::test]
async fn codebuddy_cn_connection_advertises_only_the_cn_catalog() {
    let database = TestDatabase::new().expect("temporary database");
    connect_codebuddy(&database, "codebuddy-cn").await;
    let fake = FakeCodeBuddyUpstream::start().await;
    let app = app(&database, &fake).await;

    let body = json_body(
        app.oneshot(models_request())
            .await
            .expect("models response"),
    )
    .await;
    let ids = model_ids(&body);
    assert!(
        ids.contains(&"codebuddy-cn/gpt-5.6-astra".to_owned()),
        "{ids:?}"
    );
    assert!(
        !ids.iter().any(|id| id.starts_with("codebuddy/")),
        "the global adapter must not advertise without its own connection: {ids:?}"
    );
}

#[tokio::test]
async fn codebuddy_product_json_supplies_the_personal_account_catalog() {
    let database = TestDatabase::new().expect("temporary database");
    let fake = FakeCodeBuddyUpstream::start().await;

    // A personal account has no `models` in /v3/config; the vendor list comes
    // from the installed package's product.json, which the fixture stands in for.
    let product_path = std::env::temp_dir().join(format!(
        "srouter-codebuddy-product-{}.json",
        std::process::id()
    ));
    std::fs::write(
        &product_path,
        r#"{"models":[{"id":"hy4-preview"},{"id":"kimi-k3"},{"id":"deepseek-v4.1-flash"}]}"#,
    )
    .expect("fixture product.json");
    fake.with(|state| state.product_json_path = Some(product_path.clone()));

    let app = app(&database, &fake).await;

    // No connection: the vendor list must stay hidden.
    let ids = model_ids(
        &json_body(
            app.clone()
                .oneshot(models_request())
                .await
                .expect("models response"),
        )
        .await,
    );
    assert!(
        !ids.iter().any(|id| id.starts_with("codebuddy/")),
        "the vendor catalog must be gated on a connection: {ids:?}"
    );

    // With the global connection, the vendor ids and the live config ids merge.
    connect_codebuddy(&database, "codebuddy").await;
    let ids = model_ids(
        &json_body(
            app.oneshot(models_request())
                .await
                .expect("models response"),
        )
        .await,
    );
    for expected in [
        "codebuddy/hy4-preview",
        "codebuddy/kimi-k3",
        "codebuddy/gpt-5.6-astra",
    ] {
        assert!(
            ids.contains(&expected.to_owned()),
            "missing {expected}: {ids:?}"
        );
    }
    assert!(
        !ids.iter().any(|id| id.starts_with("codebuddy-cn/")),
        "the China adapter must not advertise without its own connection: {ids:?}"
    );

    let _ = std::fs::remove_file(&product_path);
}

#[tokio::test]
async fn codebuddy_config_failure_leaves_the_catalog_empty() {
    let database = TestDatabase::new().expect("temporary database");
    connect_codebuddy(&database, "codebuddy").await;
    let fake = FakeCodeBuddyUpstream::start().await;
    fake.with(|state| state.config_failure = true);
    let app = app(&database, &fake).await;

    let response = app
        .oneshot(models_request())
        .await
        .expect("models response");
    assert_eq!(response.status(), StatusCode::OK);
    let ids = model_ids(&json_body(response).await);
    assert!(
        !ids.iter().any(|id| id.starts_with("codebuddy/")),
        "a failed config fetch must advertise nothing: {ids:?}"
    );
}

#[tokio::test]
async fn codebuddy_request_uses_the_bare_model_and_global_headers() {
    let database = TestDatabase::new().expect("temporary database");
    connect_codebuddy(&database, "codebuddy").await;
    let fake = FakeCodeBuddyUpstream::start().await;
    let app = app(&database, &fake).await;

    let response = app
        .oneshot(post(
            "/v1/chat/completions",
            chat_body("codebuddy/gpt-5.6-astra", false),
        ))
        .await
        .expect("gateway response");
    assert_eq!(response.status(), StatusCode::OK);
    let _ = json_body(response).await;

    let body = fake.with(|state| state.last_chat_body.clone());
    assert_eq!(body["model"], "gpt-5.6-astra");
    assert_eq!(body["stream"], true);
    // The gateway may have injected its own system prompt first, so the
    // identity line is a prefix rather than the whole first message.
    assert!(
        body["messages"][0]["content"]
            .as_str()
            .expect("system prompt")
            .starts_with("You are CodeBuddy Code."),
        "{}",
        body["messages"][0]["content"]
    );
    assert_eq!(
        body["messages"][1]["content"],
        serde_json::json!([{ "type": "text", "text": "Hello" }])
    );

    assert_eq!(
        fake.with(|state| state.last_authorization.clone()),
        "Bearer fixture-codebuddy-access"
    );
    assert_eq!(
        fake.with(|state| state.last_user_agent.clone()),
        "IDE/2.108.1 CodeBuddy/2.108.1"
    );
    assert_eq!(fake.with(|state| state.last_ide_type.clone()), "IDE");
    assert_eq!(
        fake.with(|state| state.last_domain.clone()),
        "",
        "the global flavor sends no X-Domain header"
    );
}

#[tokio::test]
async fn codebuddy_cn_request_uses_the_cli_headers_and_domain() {
    let database = TestDatabase::new().expect("temporary database");
    connect_codebuddy(&database, "codebuddy-cn").await;
    let fake = FakeCodeBuddyUpstream::start().await;
    let app = app(&database, &fake).await;

    let response = app
        .oneshot(post(
            "/v1/chat/completions",
            chat_body("codebuddy-cn/deepseek-v4.1-flash", true),
        ))
        .await
        .expect("gateway response");
    assert_eq!(response.status(), StatusCode::OK);
    let _ = text_body(response).await;

    assert_eq!(
        fake.with(|state| state.last_authorization.clone()),
        "Bearer fixture-codebuddy-cn-access"
    );
    assert_eq!(
        fake.with(|state| state.last_user_agent.clone()),
        "CLI/2.96.0 CodeBuddy/2.96.0"
    );
    assert_eq!(fake.with(|state| state.last_ide_type.clone()), "CLI");
    assert_eq!(
        fake.with(|state| state.last_domain.clone()),
        "www.codebuddy.cn"
    );
}

#[tokio::test]
async fn codebuddy_request_mirrors_response_format_and_reasoning_into_the_body() {
    let database = TestDatabase::new().expect("temporary database");
    connect_codebuddy(&database, "codebuddy").await;
    let fake = FakeCodeBuddyUpstream::start().await;
    let app = app(&database, &fake).await;

    let mut body = chat_body("codebuddy/gpt-5.6-astra", false);
    body["reasoning_effort"] = serde_json::json!("none");
    body["response_format"] = serde_json::json!({"type": "json_object"});
    let response = app
        .oneshot(post("/v1/chat/completions", body))
        .await
        .expect("gateway response");
    assert_eq!(response.status(), StatusCode::OK);
    let _ = json_body(response).await;

    let upstream = fake.with(|state| state.last_chat_body.clone());
    assert!(upstream.get("reasoning_effort").is_none());
    assert!(upstream.get("response_format").is_none());
    assert_eq!(
        upstream["messages"][1]["content"][0]["text"],
        "Hello\n\nRespond only in valid JSON."
    );
}

#[tokio::test]
async fn codebuddy_stream_reframes_ndjson_and_terminates_once() {
    let database = TestDatabase::new().expect("temporary database");
    connect_codebuddy(&database, "codebuddy").await;
    let fake = FakeCodeBuddyUpstream::start().await;
    fake.with(|state| state.chat_mode = "ndjson".to_owned());
    let app = app(&database, &fake).await;

    let response = app
        .oneshot(post(
            "/v1/chat/completions",
            chat_body("codebuddy/gpt-5.6-astra", true),
        ))
        .await
        .expect("gateway response");
    assert_eq!(response.status(), StatusCode::OK);
    let body = text_body(response).await;
    assert!(body.contains("Hello"));
    assert!(body.contains(" world"));
    assert!(
        body.contains("data: {\"choices\""),
        "each NDJSON line must be re-framed as an SSE data frame: {body}"
    );
    assert_eq!(body.matches("data: [DONE]").count(), 1);
}

#[tokio::test]
async fn codebuddy_fragmented_stream_reassembles_lines() {
    let database = TestDatabase::new().expect("temporary database");
    connect_codebuddy(&database, "codebuddy").await;
    let fake = FakeCodeBuddyUpstream::start().await;
    fake.with(|state| state.chat_mode = "fragmented".to_owned());
    let app = app(&database, &fake).await;

    let response = app
        .oneshot(post(
            "/v1/chat/completions",
            chat_body("codebuddy/gpt-5.6-astra", true),
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
async fn codebuddy_non_stream_aggregates_content_reasoning_tools_and_usage() {
    let database = TestDatabase::new().expect("temporary database");
    connect_codebuddy(&database, "codebuddy").await;
    let fake = FakeCodeBuddyUpstream::start().await;
    fake.with(|state| state.chat_mode = "aggregate".to_owned());
    let app = app(&database, &fake).await;

    let response = app
        .oneshot(post(
            "/v1/chat/completions",
            chat_body("codebuddy/gpt-5.6-astra", false),
        ))
        .await
        .expect("gateway response");
    assert_eq!(response.status(), StatusCode::OK);
    let body = json_body(response).await;
    assert_eq!(body["object"], "chat.completion");
    assert_eq!(body["model"], "gpt-5.6-astra");
    assert_eq!(body["choices"][0]["message"]["content"], "answer");
    assert_eq!(body["choices"][0]["message"]["reasoning_content"], "think ");
    assert_eq!(
        body["choices"][0]["message"]["tool_calls"][0]["id"],
        "call-1"
    );
    assert_eq!(
        body["choices"][0]["message"]["tool_calls"][0]["function"]["name"],
        "lookup"
    );
    assert_eq!(
        body["choices"][0]["message"]["tool_calls"][0]["function"]["arguments"],
        r#"{"q":"weather"}"#
    );
    assert_eq!(body["choices"][0]["finish_reason"], "tool_calls");
    assert_eq!(body["usage"]["total_tokens"], 17);
}

#[tokio::test]
async fn codebuddy_midstream_errors_become_error_events() {
    let database = TestDatabase::new().expect("temporary database");
    connect_codebuddy(&database, "codebuddy").await;
    let fake = FakeCodeBuddyUpstream::start().await;
    fake.with(|state| state.chat_mode = "root_error".to_owned());
    let app = app(&database, &fake).await;

    let response = app
        .oneshot(post(
            "/v1/chat/completions",
            chat_body("codebuddy/gpt-5.6-astra", true),
        ))
        .await
        .expect("gateway response");
    assert_eq!(response.status(), StatusCode::OK);
    let body = text_body(response).await;
    assert!(body.contains("\"message\":\"boom\""), "{body}");
}

#[tokio::test]
async fn no_codebuddy_connection_returns_not_connected() {
    let database = TestDatabase::new().expect("temporary database");
    let fake = FakeCodeBuddyUpstream::start().await;
    let app = app(&database, &fake).await;

    let response = app
        .oneshot(post(
            "/v1/chat/completions",
            chat_body("codebuddy/gpt-5.6-astra", false),
        ))
        .await
        .expect("gateway response");
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(
        json_body(response).await["error"]["message"],
        "No active CodeBuddy connection found. Connect the CodeBuddy account in the Providers tab."
    );
}
