mod support;

use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode, Version, header},
};
use srouter_server::app::create_router;
use srouter_server::features::gateway::token_saver::TERSE_DIRECTIVE;
use support::{
    FakeUpstream, TestDatabase, api_key_record, app_state_with_fake_upstream,
    app_state_with_fake_upstream_and_security, security_state, with_loopback_client,
};
use tower::ServiceExt;

async fn test_app() -> (FakeUpstream, Router) {
    let (upstream, state) = app_state_with_fake_upstream().await;
    (upstream, create_router(state))
}

fn message_request(uri: &str, body: serde_json::Value) -> Request<Body> {
    with_loopback_client(
        Request::builder()
            .method("POST")
            .uri(uri)
            .version(Version::HTTP_11)
            .header(header::CONTENT_TYPE, "application/json")
            .header("anthropic-version", "2023-06-01")
            .body(Body::from(serde_json::to_vec(&body).unwrap()))
            .unwrap(),
    )
}

fn raw_message_request(uri: &str, body: String) -> Request<Body> {
    with_loopback_client(
        Request::builder()
            .method("POST")
            .uri(uri)
            .version(Version::HTTP_11)
            .header(header::CONTENT_TYPE, "application/json")
            .header("anthropic-version", "2023-06-01")
            .body(Body::from(body))
            .unwrap(),
    )
}

async fn json_body(response: axum::response::Response) -> serde_json::Value {
    let bytes = to_bytes(response.into_body(), 65_536).await.unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

async fn text_body(response: axum::response::Response) -> String {
    let bytes = to_bytes(response.into_body(), 65_536).await.unwrap();
    String::from_utf8(bytes.to_vec()).unwrap()
}

#[tokio::test]
async fn post_v1_messages_non_streaming_returns_anthropic_format() {
    let (_upstream, app) = test_app().await;
    let body = serde_json::json!({
        "model": "opencode_zen/space-bunny-free",
        "messages": [
            { "role": "user", "content": "Hello Claude via SRouter!" }
        ],
        "max_tokens": 1024,
        "stream": false
    });

    let response = app
        .oneshot(message_request("/v1/messages", body))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let json = json_body(response).await;

    assert_eq!(json["type"], "message");
    assert_eq!(json["role"], "assistant");
    assert_eq!(json["model"], "opencode_zen/space-bunny-free");
    assert_eq!(json["stop_reason"], "end_turn");
    assert_eq!(json["content"][0]["type"], "text");
    assert_eq!(json["content"][0]["text"], "fake upstream reply");
    assert!(json["usage"]["input_tokens"].as_u64().unwrap() > 0);
    assert!(json["usage"]["output_tokens"].as_u64().unwrap() > 0);
}

#[tokio::test]
async fn post_v1_messages_streaming_emits_anthropic_sse_events() {
    let (_upstream, app) = test_app().await;
    let body = serde_json::json!({
        "model": "opencode_zen/space-bunny-free",
        "messages": [
            { "role": "user", "content": "Tell me a story" }
        ],
        "max_tokens": 1024,
        "stream": true
    });

    let response = app
        .oneshot(message_request("/v1/messages", body))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok()),
        Some("text/event-stream")
    );

    let text = text_body(response).await;
    assert!(text.contains("event: message_start"));
    assert!(text.contains("event: content_block_start"));
    assert!(text.contains("event: content_block_delta"));
    assert!(text.contains("event: content_block_stop"));
    assert!(text.contains("event: message_delta"));
    assert!(text.contains("event: message_stop"));
    assert!(text.contains("fake stream"));
}

#[tokio::test]
async fn post_v1_messages_logs_streaming_request() {
    let test_db = TestDatabase::new().expect("test db");
    let database = test_db.connect().await.expect("db connect");
    let (_upstream, state) = app_state_with_fake_upstream().await;
    let app = create_router(state.with_database(database.clone()));
    let body = serde_json::json!({
        "model": "opencode_zen/fragmented-stream",
        "messages": [{ "role": "user", "content": "log stream" }],
        "max_tokens": 1024,
        "stream": true
    });

    let response = app
        .oneshot(message_request("/v1/messages", body))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let stream_body = text_body(response).await;
    assert!(stream_body.contains("message_stop"));

    let row = sqlx::query(
        "SELECT status_code, prompt_tokens, completion_tokens, total_tokens, path FROM request_logs",
    )
    .fetch_one(database.sqlite_pool().unwrap())
    .await
    .expect("stream log row");
    assert_eq!(
        sqlx::Row::try_get::<i64, _>(&row, "status_code").unwrap(),
        200
    );
    assert_eq!(
        sqlx::Row::try_get::<i64, _>(&row, "prompt_tokens").unwrap(),
        11
    );
    assert_eq!(
        sqlx::Row::try_get::<i64, _>(&row, "completion_tokens").unwrap(),
        22
    );
    assert_eq!(
        sqlx::Row::try_get::<i64, _>(&row, "total_tokens").unwrap(),
        33
    );
    assert_eq!(
        sqlx::Row::try_get::<String, _>(&row, "path").unwrap(),
        "/v1/messages"
    );
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM request_logs")
        .fetch_one(database.sqlite_pool().unwrap())
        .await
        .unwrap();
    assert_eq!(count, 1);
}

#[tokio::test]
async fn post_v1_v1_compat_messages_returns_anthropic_format() {
    let (_upstream, app) = test_app().await;
    let body = serde_json::json!({
        "model": "opencode/space-bunny-free",
        "messages": [
            { "role": "user", "content": "Compat check" }
        ],
        "stream": false
    });

    let response = app
        .oneshot(message_request("/v1/v1/messages", body))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let json = json_body(response).await;
    assert_eq!(json["type"], "message");
    assert_eq!(json["content"][0]["text"], "fake upstream reply");
}

#[tokio::test]
async fn post_v1_messages_count_tokens_returns_token_count() {
    let (_upstream, app) = test_app().await;
    let body = serde_json::json!({
        "model": "opencode_zen/space-bunny-free",
        "system": "You are a very helpful assistant with advanced coding capabilities.",
        "messages": [
            { "role": "user", "content": "How many tokens are in this message request?" }
        ],
        "tools": [
            {
                "name": "bash",
                "description": "Run bash commands in user environment",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "command": { "type": "string" }
                    },
                    "required": ["command"]
                }
            }
        ]
    });

    let response = app
        .oneshot(message_request("/v1/messages/count_tokens", body))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let json = json_body(response).await;
    let tokens = json["input_tokens"].as_u64().unwrap();
    assert!(tokens > 10, "estimated tokens should be greater than 10");
}

#[tokio::test]
async fn post_v1_messages_with_system_blocks_and_tools() {
    let (_upstream, app) = test_app().await;
    let body = serde_json::json!({
        "model": "opencode_zen/space-bunny-free",
        "system": [
            {
                "type": "text",
                "text": "System prompt with ephemeral cache control",
                "cache_control": { "type": "ephemeral" }
            }
        ],
        "messages": [
            {
                "role": "user",
                "content": [
                    { "type": "text", "text": "Execute command" }
                ]
            },
            {
                "role": "assistant",
                "content": [
                    {
                        "type": "tool_use",
                        "id": "toolu_test_123",
                        "name": "bash",
                        "input": { "command": "echo hello" }
                    }
                ]
            },
            {
                "role": "user",
                "content": [
                    {
                        "type": "tool_result",
                        "tool_use_id": "toolu_test_123",
                        "content": "hello"
                    },
                    {
                        "type": "text",
                        "text": "What was the output?"
                    }
                ]
            }
        ],
        "tools": [
            {
                "name": "bash",
                "description": "Run bash command",
                "input_schema": {
                    "type": "object",
                    "properties": { "command": { "type": "string" } }
                }
            }
        ],
        "stream": false
    });

    let response = app
        .oneshot(message_request("/v1/messages", body))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let json = json_body(response).await;
    assert_eq!(json["type"], "message");
}

#[tokio::test]
async fn post_v1_messages_rejects_missing_model_with_anthropic_error() {
    let (_upstream, app) = test_app().await;
    let body = serde_json::json!({
        "messages": [{ "role": "user", "content": "hi" }]
    });

    let response = app
        .oneshot(message_request("/v1/messages", body))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let json = json_body(response).await;
    assert_eq!(json["type"], "error");
    assert_eq!(json["error"]["type"], "invalid_request_error");
    assert!(json["error"]["message"].as_str().unwrap().contains("model"));
}

#[tokio::test]
async fn post_v1_messages_rejects_empty_messages_with_anthropic_error() {
    let (_upstream, app) = test_app().await;
    let body = serde_json::json!({
        "model": "opencode_zen/space-bunny-free",
        "messages": []
    });

    let response = app
        .oneshot(message_request("/v1/messages", body))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let json = json_body(response).await;
    assert_eq!(json["type"], "error");
    assert_eq!(json["error"]["type"], "invalid_request_error");
}

#[tokio::test]
async fn post_v1_messages_rejects_malformed_json_with_anthropic_error() {
    let (_upstream, app) = test_app().await;

    let response = app
        .oneshot(raw_message_request(
            "/v1/messages",
            "{ invalid json".to_owned(),
        ))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let json = json_body(response).await;
    assert_eq!(json["type"], "error");
    assert_eq!(json["error"]["type"], "invalid_request_error");
}

#[tokio::test]
async fn post_v1_messages_rejects_unregistered_model_with_anthropic_error() {
    let (_upstream, app) = test_app().await;
    let body = serde_json::json!({
        "model": "non-existent-provider/ghost-model",
        "messages": [{ "role": "user", "content": "hello" }]
    });

    let response = app
        .oneshot(message_request("/v1/messages", body))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    let json = json_body(response).await;
    assert_eq!(json["type"], "error");
    assert_eq!(json["error"]["type"], "invalid_request_error");
}

#[tokio::test]
async fn post_v1_messages_authenticates_with_x_api_key_and_bearer() {
    let key = "sr-test-key-123";
    let record = api_key_record("key_1");
    let security = security_state(true, vec![(key.to_owned(), record)], vec![]);
    let (_upstream, state) = app_state_with_fake_upstream_and_security(security).await;
    let app = create_router(state);

    // 1. Without key -> 401
    let unauth_req = with_loopback_client(
        Request::builder()
            .method("POST")
            .uri("/v1/messages")
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(
                serde_json::to_vec(&serde_json::json!({
                    "model": "opencode_zen/space-bunny-free",
                    "messages": [{ "role": "user", "content": "hi" }]
                }))
                .unwrap(),
            ))
            .unwrap(),
    );
    let res_unauth = app.clone().oneshot(unauth_req).await.unwrap();
    assert_eq!(res_unauth.status(), StatusCode::UNAUTHORIZED);

    // 2. With x-api-key -> 200
    let x_key_req = with_loopback_client(
        Request::builder()
            .method("POST")
            .uri("/v1/messages")
            .header(header::CONTENT_TYPE, "application/json")
            .header("x-api-key", key)
            .body(Body::from(
                serde_json::to_vec(&serde_json::json!({
                    "model": "opencode_zen/space-bunny-free",
                    "messages": [{ "role": "user", "content": "hi" }]
                }))
                .unwrap(),
            ))
            .unwrap(),
    );
    let res_x_key = app.clone().oneshot(x_key_req).await.unwrap();
    assert_eq!(res_x_key.status(), StatusCode::OK);

    // 3. With Authorization: Bearer -> 200
    let bearer_req = with_loopback_client(
        Request::builder()
            .method("POST")
            .uri("/v1/messages")
            .header(header::CONTENT_TYPE, "application/json")
            .header(header::AUTHORIZATION, format!("Bearer {key}"))
            .body(Body::from(
                serde_json::to_vec(&serde_json::json!({
                    "model": "opencode_zen/space-bunny-free",
                    "messages": [{ "role": "user", "content": "hi" }]
                }))
                .unwrap(),
            ))
            .unwrap(),
    );
    let res_bearer = app.oneshot(bearer_req).await.unwrap();
    assert_eq!(res_bearer.status(), StatusCode::OK);
}

#[tokio::test]
async fn post_v1_messages_enforces_model_allowlist() {
    let key = "sr-restricted-key";
    let mut record = api_key_record("key_2");
    record.allowed_models = Some(vec!["opencode_zen/allowed-model".to_owned()]);
    let security = security_state(true, vec![(key.to_owned(), record)], vec![]);
    let (_upstream, state) = app_state_with_fake_upstream_and_security(security).await;
    let app = create_router(state);

    let body = serde_json::json!({
        "model": "opencode_zen/space-bunny-free",
        "messages": [{ "role": "user", "content": "hi" }]
    });

    let req = with_loopback_client(
        Request::builder()
            .method("POST")
            .uri("/v1/messages")
            .header(header::CONTENT_TYPE, "application/json")
            .header("x-api-key", key)
            .body(Body::from(serde_json::to_vec(&body).unwrap()))
            .unwrap(),
    );

    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::FORBIDDEN);
    let json = json_body(res).await;
    assert_eq!(json["type"], "error");
    assert_eq!(json["error"]["type"], "permission_error");
}

#[tokio::test]
async fn token_saver_compresses_the_translated_anthropic_request() {
    let (upstream, app) = test_app().await;
    let body = serde_json::json!({
        "model": "opencode_zen/space-bunny-free",
        "system": "policy",
        "messages": [
            {
                "role": "user",
                "content": "\u{1b}[31mhello\u{1b}[0m\n\n\n\nsame repeated line\nsame repeated line\nsame repeated line"
            }
        ],
        "max_tokens": 1024,
        "stream": false
    });

    let response = app
        .oneshot(message_request("/v1/messages", body))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let _ = json_body(response).await;

    let captured = upstream.last_chat_body();
    let messages = captured["messages"].as_array().expect("messages array");
    let system = messages[0]["content"].as_str().expect("system content");
    assert!(system.starts_with("policy"), "system: {system}");
    assert!(system.contains(TERSE_DIRECTIVE), "system: {system}");
    assert_eq!(
        messages[1]["content"],
        serde_json::json!("hello\n\nsame repeated line (x3)")
    );
}

#[tokio::test]
async fn mid_stream_failure_emits_an_error_event_and_logs_the_failure_status() {
    // Client-cancellation billing (server/TODO.md §6): an in-stream upstream
    // failure after partial output surfaces as an Anthropic `error` event
    // (Node's controller writes it and closes) and the request log carries the
    // failure status with zero usage — mirroring Node's
    // `does not bill a stream that errors after partial output without usage`.
    let test_db = TestDatabase::new().expect("test db");
    let database = test_db.connect().await.expect("db connect");
    let (_upstream, state) = app_state_with_fake_upstream().await;
    let app = create_router(state.with_database(database.clone()));
    let body = serde_json::json!({
        "model": "opencode_zen/space-bunny-error",
        "messages": [{ "role": "user", "content": "fail mid stream" }],
        "max_tokens": 1024,
        "stream": true
    });

    let response = app
        .oneshot(message_request("/v1/messages", body))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let stream_body = text_body(response).await;

    // Partial output first, then the error event — and the stream ends there:
    // no `message_stop` after a failure (Node closes right after the error).
    assert!(stream_body.contains("content_block_delta"), "{stream_body}");
    assert!(stream_body.contains("partial output"), "{stream_body}");
    assert!(stream_body.contains("event: error"), "{stream_body}");
    assert!(
        stream_body.contains("\"type\":\"api_error\""),
        "{stream_body}"
    );
    assert!(!stream_body.contains("message_stop"), "{stream_body}");

    let row = sqlx::query(
        "SELECT status_code, prompt_tokens, completion_tokens, total_tokens FROM request_logs",
    )
    .fetch_one(database.sqlite_pool().unwrap())
    .await
    .expect("stream log row");
    assert_eq!(
        sqlx::Row::try_get::<i64, _>(&row, "status_code").unwrap(),
        500
    );
    assert_eq!(
        sqlx::Row::try_get::<i64, _>(&row, "prompt_tokens").unwrap(),
        0
    );
    assert_eq!(
        sqlx::Row::try_get::<i64, _>(&row, "completion_tokens").unwrap(),
        0
    );
    assert_eq!(
        sqlx::Row::try_get::<i64, _>(&row, "total_tokens").unwrap(),
        0
    );
}
