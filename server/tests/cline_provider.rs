//! HTTP-level checks for Cline chat and model requests against a local fake.

mod support;

use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode, Version, header},
};
use srouter_server::SecurityState;
use srouter_server::app::create_router;
use srouter_server::clock::now_ms;
use srouter_server::infrastructure::database::providers::{
    ClineConnectionWrite, load_cline_credentials, upsert_cline_connection,
};
use support::{
    FakeClineUpstream, TestDatabase, cline_registry, connect_cline, connect_second_cline,
    test_config, with_loopback_client,
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
async fn cline_mandatory_reasoning_drops_the_disable_and_keeps_real_efforts() {
    let database = TestDatabase::new().expect("temporary database");
    connect_cline(&database).await;
    let fake = FakeClineUpstream::start().await;
    fake.with(|state| {
        state.model_catalog = serde_json::json!({
            "object": "list",
            "data": [
                { "id": "cline-free/muse-spark-1.3-contributor" },
                { "id": "anthropic/claude-sonnet-5.5" }
            ]
        });
    });
    let app = app(&database, &fake).await;

    // The mandatory-reasoning model must never receive the disable its
    // endpoint rejects with 400.
    let mut body = chat_body("cline/cline-free/muse-spark-1.3-contributor", true);
    body["reasoning_effort"] = serde_json::json!("none");
    let response = app
        .clone()
        .oneshot(request("/v1/chat/completions", body))
        .await
        .expect("gateway response");
    assert_eq!(response.status(), StatusCode::OK);
    let _ = text_body(response).await;
    let upstream = fake.with(|state| state.last_chat_body.clone());
    assert!(
        upstream.get("reasoning_effort").is_none(),
        "the reasoning disable must be dropped upstream: {upstream}"
    );

    // An ordinary model keeps the caller's effort untouched.
    let mut body = chat_body("cline/anthropic/claude-sonnet-5.5", true);
    body["reasoning_effort"] = serde_json::json!("none");
    let response = app
        .oneshot(request("/v1/chat/completions", body))
        .await
        .expect("gateway response");
    assert_eq!(response.status(), StatusCode::OK);
    let _ = text_body(response).await;
    let upstream = fake.with(|state| state.last_chat_body.clone());
    assert_eq!(
        upstream["reasoning_effort"], "none",
        "models without the mandate forward the caller's effort verbatim"
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

#[tokio::test]
async fn cline_refresh_drops_the_workos_prefix_and_rotates_the_stored_token() {
    let database = TestDatabase::new().expect("temporary database");
    let db = database.connect().await.expect("temporary database");
    // The row shape written by earlier builds: a refresh token that still
    // carries the header-only prefix, past its refresh lead.
    upsert_cline_connection(
        &db,
        &ClineConnectionWrite {
            id: "user-1".to_owned(),
            name: "Dev".to_owned(),
            access_token: "workos:old-access".to_owned(),
            refresh_token: Some("workos:cline-refresh".to_owned()),
            token_expires_at: Some(now_ms() - 1),
            email: "dev@example.com".to_owned(),
        },
    )
    .await
    .expect("Cline connection stored");
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

    assert_eq!(fake.with(|state| state.refresh_requests), 1);
    assert_eq!(
        fake.with(|state| state.last_refresh_token.clone()),
        "cline-refresh",
        "upstream rejects the refresh token while it carries the workos: prefix"
    );
    let credentials = load_cline_credentials(&db)
        .await
        .expect("credentials load")
        .into_iter()
        .next()
        .expect("connection");
    assert_eq!(credentials.access_token, "workos:cline-access");
    assert_eq!(credentials.refresh_token.as_deref(), Some("cline-refresh"));
}

/// Two connected accounts with the first chat answered `429`: the request must
/// succeed through the second account, and the rate-limited one must be skipped
/// by the next request. The bearers differ per account, so they name the
/// connection each attempt used.
#[tokio::test]
async fn a_rate_limited_cline_account_fails_over_to_the_next_one() {
    let database = TestDatabase::new().expect("temporary database");
    connect_cline(&database).await;
    connect_second_cline(&database).await;
    let fake = FakeClineUpstream::start().await;
    fake.with(|state| state.rate_limited_chats = 1);
    let app = app(&database, &fake).await;

    let response = app
        .clone()
        .oneshot(request(
            "/v1/chat/completions",
            chat_body("cline/anthropic/claude-sonnet-5.5", false),
        ))
        .await
        .expect("gateway response");
    assert_eq!(
        response.status(),
        StatusCode::OK,
        "the client never sees the upstream 429"
    );
    let _ = text_body(response).await;

    let attempts = fake.with(|state| state.chat_authorizations.clone());
    assert_eq!(attempts.len(), 2, "the request was tried twice");
    assert_ne!(
        attempts[0], attempts[1],
        "the second attempt used a different account"
    );

    // The rate-limited account stays cooling, so the next request goes straight
    // to the surviving one.
    let response = app
        .oneshot(request(
            "/v1/chat/completions",
            chat_body("cline/anthropic/claude-sonnet-5.5", false),
        ))
        .await
        .expect("gateway response");
    assert_eq!(response.status(), StatusCode::OK);

    let attempts = fake.with(|state| state.chat_authorizations.clone());
    assert_eq!(attempts.len(), 3, "the cooling account was skipped");
    assert_eq!(
        attempts[2], attempts[1],
        "the surviving account served the follow-up"
    );
}
