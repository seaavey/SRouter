mod support;

use std::sync::{Arc, Mutex};

use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode, Version, header},
};
use futures_util::{StreamExt, future::BoxFuture};
use srouter_server::app::create_router;
use srouter_server::features::api_keys::{
    APIKey, APIKeyRepository, CreateAPIKeyInput, CreatedAPIKey, UpdateAPIKeyInput,
};
use srouter_server::features::gateway::token_saver::TERSE_DIRECTIVE;
use srouter_server::{APIError, SecurityState};
use support::{
    FakeUpstream, FixtureAPIKeyStore, FixtureAdminSessionStore, TestDatabase, api_key_record,
    app_state_with_fake_upstream, app_state_with_fake_upstream_and_security, with_loopback_client,
};
use tower::ServiceExt;

async fn test_app() -> (FakeUpstream, Router) {
    let (upstream, state) = app_state_with_fake_upstream().await;

    (upstream, create_router(state))
}

fn chat_request(uri: &str, body: serde_json::Value) -> Request<Body> {
    with_loopback_client(
        Request::builder()
            .method("POST")
            .uri(uri)
            .version(Version::HTTP_11)
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(serde_json::to_vec(&body).unwrap()))
            .unwrap(),
    )
}

fn raw_request(uri: &str, body: String) -> Request<Body> {
    with_loopback_client(
        Request::builder()
            .method("POST")
            .uri(uri)
            .version(Version::HTTP_11)
            .header(header::CONTENT_TYPE, "application/json")
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
async fn post_v1_chat_completions_returns_the_upstream_completion() {
    let (_upstream, app) = test_app().await;
    let body = serde_json::json!({
        "model": "opencode_zen/space-bunny-free",
        "messages": [ { "role": "user", "content": "Hello SRouter" } ],
        "stream": false
    });

    let response = app
        .oneshot(chat_request("/v1/chat/completions", body))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let json = json_body(response).await;
    assert_eq!(
        json["choices"][0]["message"]["content"],
        "fake upstream reply"
    );
    // The adapter sends the resolved bare model id, not the prefixed one.
    assert_eq!(json["model"], "space-bunny-free");
}

#[tokio::test]
async fn post_v1_v1_compat_chat_completions_returns_the_upstream_completion() {
    let (_upstream, app) = test_app().await;
    let body = serde_json::json!({
        "model": "opencode/space-bunny-free",
        "messages": [
            { "role": "developer", "content": "Be concise" },
            { "role": "user", "content": "Hello SRouter" }
        ],
        "stream": false
    });

    let response = app
        .oneshot(chat_request("/v1/v1/chat/completions", body))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let json = json_body(response).await;
    assert_eq!(
        json["choices"][0]["message"]["content"],
        "fake upstream reply"
    );
}

#[tokio::test]
async fn post_root_chat_completions_is_not_mounted() {
    let (_upstream, app) = test_app().await;
    let body = serde_json::json!({
        "model": "opencode_zen/space-bunny-free",
        "messages": [ { "role": "user", "content": "Hello" } ],
        "stream": false
    });

    let response = app
        .oneshot(chat_request("/chat/completions", body))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn post_v1_chat_completions_streams_the_upstream_body() {
    let (_upstream, app) = test_app().await;
    let body = serde_json::json!({
        "model": "zen/space-bunny-free",
        "messages": [ { "role": "user", "content": "Hello SRouter stream" } ],
        "stream": true
    });

    let response = app
        .oneshot(chat_request("/v1/chat/completions", body))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response.headers()[header::CONTENT_TYPE],
        "text/event-stream"
    );
    assert_eq!(
        response.headers()[header::CACHE_CONTROL],
        "no-cache, no-transform"
    );
    assert_eq!(response.headers()[header::CONNECTION], "keep-alive");
    assert_eq!(response.headers()["x-accel-buffering"], "no");

    let text = text_body(response).await;

    assert!(text.contains("fake stream"));
    assert!(text.contains("[DONE]"));
}

#[tokio::test]
async fn post_v1_chat_completions_aggregates_fragmented_upstream_sse() {
    let (_upstream, app) = test_app().await;
    // Models other than space-bunny are aggregated from an upstream SSE
    // response; the fake splits `data:` lines across writes.
    let body = serde_json::json!({
        "model": "zen/fragmented-stream",
        "messages": [ { "role": "user", "content": "Hello fragmentation" } ],
        "stream": false
    });

    let response = app
        .oneshot(chat_request("/v1/chat/completions", body))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let json = json_body(response).await;
    assert_eq!(json["choices"][0]["message"]["content"], "fragmented reply");
    assert_eq!(json["id"], "chatcmpl-fragmented");
    assert_eq!(json["usage"]["completion_tokens"], 22);
}

#[tokio::test]
async fn post_v1_chat_completions_forwards_client_tools_through_the_upstream_gate() {
    let (_upstream, app) = test_app().await;
    // The executor pads client tool sets with the gate tools the upstream
    // requires; without that padding the fake (like the real upstream)
    // answers 403 FreeTierError.
    let body = serde_json::json!({
        "model": "zen/mimo-v2.6-flash-free",
        "messages": [ { "role": "user", "content": "Hello tools" } ],
        "stream": false,
        "tools": [ {
            "type": "function",
            "function": {
                "name": "web_search",
                "description": "Search the web",
                "parameters": { "type": "object", "properties": { "query": { "type": "string" } } }
            }
        } ],
        "tool_choice": "auto"
    });

    let response = app
        .oneshot(chat_request("/v1/chat/completions", body))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let json = json_body(response).await;
    // The request passed the upstream gate, so the fake's SSE turn was
    // aggregated into a completion instead of a 403 FreeTierError.
    assert_eq!(json["choices"][0]["message"]["content"], "fake stream");
}

#[tokio::test]
async fn post_v1_chat_completions_returns_aggregated_tool_calls() {
    let (_upstream, app) = test_app().await;
    // The non-stream path calls upstream with stream=true and reassembles the
    // SSE deltas; tool calls split across chunks must survive aggregation.
    let body = serde_json::json!({
        "model": "zen/tool-call-stream",
        "messages": [ { "role": "user", "content": "Weather?" } ],
        "stream": false,
        "tools": [ {
            "type": "function",
            "function": {
                "name": "lookup",
                "description": "Look up something",
                "parameters": { "type": "object", "properties": { "query": { "type": "string" } } }
            }
        } ],
        "tool_choice": "auto"
    });

    let response = app
        .oneshot(chat_request("/v1/chat/completions", body))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let json = json_body(response).await;
    let choice = &json["choices"][0];
    assert_eq!(choice["finish_reason"], "tool_calls");
    let call = &choice["message"]["tool_calls"][0];
    assert_eq!(call["id"], "call_lookup_1");
    assert_eq!(call["type"], "function");
    assert_eq!(call["function"]["name"], "lookup");
    assert_eq!(call["function"]["arguments"], r#"{"query": "weather"}"#);
}

#[tokio::test]
async fn post_v1_chat_completions_rejects_an_unregistered_model() {
    let (_upstream, app) = test_app().await;
    let body = serde_json::json!({
        "model": "anthropic/claude-sonnet-4",
        "messages": [ { "role": "user", "content": "Hello" } ],
        "stream": false
    });

    let response = app
        .oneshot(chat_request("/v1/chat/completions", body))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    let json = json_body(response).await;
    assert_eq!(json["error"]["type"], "invalid_request_error");
}

#[tokio::test]
async fn post_v1_chat_completions_rejects_an_empty_message_list() {
    let (_upstream, app) = test_app().await;
    let body = serde_json::json!({
        "model": "opencode_zen/space-bunny-free",
        "messages": [],
        "stream": false
    });

    let response = app
        .oneshot(chat_request("/v1/chat/completions", body))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let json = json_body(response).await;
    assert_eq!(json["error"]["type"], "invalid_request_error");
    assert_eq!(json["error"]["code"], "too_small");
    assert_eq!(json["error"]["param"], "messages");
}

#[tokio::test]
async fn empty_body_returns_400_with_invalid_json_code() {
    let (_upstream, app) = test_app().await;

    let response = app
        .oneshot(raw_request("/v1/chat/completions", String::new()))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let json = json_body(response).await;
    assert_eq!(json["error"]["type"], "invalid_request_error");
    assert_eq!(json["error"]["code"], "invalid_json");
    assert!(
        json["error"]["message"]
            .as_str()
            .unwrap()
            .contains("cannot be empty")
    );
}

#[tokio::test]
async fn malformed_json_returns_400_with_invalid_json_code() {
    let (_upstream, app) = test_app().await;

    let response = app
        .oneshot(raw_request(
            "/v1/chat/completions",
            "{ malformed json: true ".to_owned(),
        ))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let json = json_body(response).await;
    assert_eq!(json["error"]["type"], "invalid_request_error");
    assert_eq!(json["error"]["code"], "invalid_json");
    assert_eq!(
        json["error"]["message"].as_str().unwrap(),
        "Malformed JSON in request body"
    );
}

#[tokio::test]
async fn schema_invalid_body_returns_400_with_error_envelope() {
    let (_upstream, app) = test_app().await;

    let missing_model = app
        .clone()
        .oneshot(chat_request(
            "/v1/chat/completions",
            serde_json::json!({ "messages": [ { "role": "user", "content": "Hi" } ] }),
        ))
        .await
        .unwrap();
    assert_eq!(missing_model.status(), StatusCode::BAD_REQUEST);
    let json = json_body(missing_model).await;
    assert_eq!(json["error"]["type"], "invalid_request_error");
    assert_eq!(json["error"]["code"], "invalid_type");
    assert_eq!(json["error"]["param"], "model");
    assert_eq!(
        json["error"]["message"],
        "Missing required parameter 'model'"
    );

    let messages_not_an_array = app
        .oneshot(chat_request(
            "/v1/chat/completions",
            serde_json::json!({
                "model": "opencode_zen/space-bunny-free",
                "messages": "hello"
            }),
        ))
        .await
        .unwrap();
    assert_eq!(messages_not_an_array.status(), StatusCode::BAD_REQUEST);
    let json = json_body(messages_not_an_array).await;
    assert_eq!(json["error"]["type"], "invalid_request_error");
    assert_eq!(json["error"]["code"], "invalid_type");
}

#[tokio::test]
async fn oversized_content_length_returns_413_request_too_large() {
    let (_upstream, app) = test_app().await;
    let request = with_loopback_client(
        Request::builder()
            .method("POST")
            .uri("/v1/chat/completions")
            .version(Version::HTTP_11)
            .header(header::CONTENT_TYPE, "application/json")
            .header(header::CONTENT_LENGTH, "26214401")
            .body(Body::from("{}"))
            .unwrap(),
    );

    let response = app.oneshot(request).await.unwrap();

    assert_eq!(response.status(), StatusCode::PAYLOAD_TOO_LARGE);
    let json = json_body(response).await;
    assert_eq!(json["error"]["code"], "request_too_large");
    assert_eq!(json["error"]["message"], "Request body too large");
}

#[tokio::test]
async fn request_limits_match_the_frozen_zod_schema() {
    let (_upstream, app) = test_app().await;

    let base = || {
        serde_json::json!({
            "model": "opencode_zen/space-bunny-free",
            "messages": [ { "role": "user", "content": "Hello" } ],
            "stream": false
        })
    };
    let too_many_messages: Vec<serde_json::Value> = (0..1001)
        .map(|_| serde_json::json!({ "role": "user", "content": "x" }))
        .collect();
    let too_many_tools: Vec<serde_json::Value> = (0..129)
        .map(|_| serde_json::json!({ "type": "function", "function": { "name": "t" } }))
        .collect();

    let mut model_too_long = base();
    model_too_long["model"] = serde_json::json!("m".repeat(301));

    let mut messages_too_many = base();
    messages_too_many["messages"] = serde_json::json!(too_many_messages);

    let mut max_tokens_too_big = base();
    max_tokens_too_big["max_tokens"] = serde_json::json!(999_999_999);

    let mut n_too_big = base();
    n_too_big["n"] = serde_json::json!(100);

    let mut tools_too_many = base();
    tools_too_many["tools"] = serde_json::json!(too_many_tools);

    let cases = [
        (model_too_long, "model", "too_big"),
        (messages_too_many, "messages", "too_big"),
        (max_tokens_too_big, "max_tokens", "too_big"),
        (n_too_big, "n", "too_big"),
        (tools_too_many, "tools", "too_big"),
    ];

    for (body, param, code) in cases {
        let response = app
            .clone()
            .oneshot(chat_request("/v1/chat/completions", body))
            .await
            .unwrap();

        assert_eq!(
            response.status(),
            StatusCode::BAD_REQUEST,
            "expected 400 for param {param}"
        );
        let json = json_body(response).await;
        assert_eq!(json["error"]["type"], "invalid_request_error");
        assert_eq!(json["error"]["param"], param);
        assert_eq!(json["error"]["code"], code);
    }
}

#[tokio::test]
async fn known_request_fields_are_forwarded_and_unknown_fields_are_dropped() {
    let (_upstream, app) = test_app().await;
    let body = serde_json::json!({
        "model": "opencode_zen/space-bunny-free",
        "messages": [
            {
                "role": "developer",
                "content": [
                    { "type": "text", "text": "Be concise" },
                    { "type": "image_url", "image_url": { "url": "https://example.com/cat.png", "detail": "low" } }
                ]
            },
            {
                "role": "assistant",
                "content": null,
                "tool_calls": [
                    { "id": "call_1", "type": "function", "function": { "name": "lookup", "arguments": "{}" } }
                ]
            }
        ],
        "temperature": 0.7,
        "top_p": 0.9,
        "n": 1,
        "user": "tester",
        "prompt_cache_key": "cache-sess-1",
        "custom_field": "must be dropped"
    });

    let response = app
        .oneshot(chat_request("/v1/chat/completions", body))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let json = json_body(response).await;

    // The gateway's own response is a pass-through of the upstream body.
    assert_eq!(
        json["choices"][0]["message"]["content"],
        "fake upstream reply"
    );
    let echo = &json["echo"];
    assert_eq!(echo["model"], "space-bunny-free");
    assert_eq!(echo["temperature"], 0.7);
    assert_eq!(echo["top_p"], 0.9);
    assert_eq!(echo["n"], 1);
    assert_eq!(echo["user"], "tester");
    assert_eq!(echo["prompt_cache_key"], "cache-sess-1");
    // `developer` is normalized to `system` before the upstream call.
    assert_eq!(echo["messages"][0]["role"], "system");
    assert_eq!(echo["messages"][0]["content"][0]["type"], "text");
    assert_eq!(
        echo["messages"][0]["content"][1]["image_url"]["detail"],
        "low"
    );
    assert!(echo["messages"][1]["content"].is_null());
    assert_eq!(
        echo["messages"][1]["tool_calls"][0]["function"]["name"],
        "lookup"
    );
    // Fields outside the frozen schema never reach the provider.
    assert!(echo["custom_field"].is_null());
}

#[tokio::test]
async fn upstream_failure_is_reported_as_500_api_error() {
    let (_upstream, app) = test_app().await;
    let body = serde_json::json!({
        "model": "opencode_zen/upstream-fail",
        "messages": [ { "role": "user", "content": "Hello" } ],
        "stream": false
    });

    let response = app
        .oneshot(chat_request("/v1/chat/completions", body))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
    let json = json_body(response).await;
    assert_eq!(json["error"]["type"], "api_error");
    assert!(
        json["error"]["message"]
            .as_str()
            .unwrap()
            .contains("OpenAI Provider Error (401)")
    );
}

#[tokio::test]
async fn post_v1_chat_completions_logs_streaming_request() {
    let test_db = TestDatabase::new().expect("test db");
    let database = test_db.connect().await.expect("db connect");
    let (_upstream, state) = app_state_with_fake_upstream().await;
    let app = create_router(state.with_database(database.clone()));
    let body = serde_json::json!({
        "model": "opencode_zen/fragmented-stream",
        "messages": [{ "role": "user", "content": "log stream" }],
        "stream": true
    });

    let response = app
        .oneshot(chat_request("/v1/chat/completions", body))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let stream_body = text_body(response).await;
    assert!(stream_body.contains("fragmented reply"));

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
        "/v1/chat/completions"
    );
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM request_logs")
        .fetch_one(database.sqlite_pool().unwrap())
        .await
        .unwrap();
    assert_eq!(count, 1);
}

#[tokio::test]
async fn post_v1_chat_completions_logs_buffered_streaming_request() {
    let test_db = TestDatabase::new().expect("test db");
    let database = test_db.connect().await.expect("db connect");
    let (_upstream, state) = app_state_with_fake_upstream().await;
    let app = create_router(state.with_database(database.clone()));
    let body = serde_json::json!({
        "model": "opencode_zen/tool-call-stream",
        "messages": [{ "role": "user", "content": "log buffered stream" }],
        "stream": true
    });

    let response = app
        .oneshot(chat_request("/v1/chat/completions", body))
        .await
        .unwrap();
    let stream_body = text_body(response).await;
    assert!(stream_body.contains("tool_calls"));

    let row = sqlx::query(
        "SELECT status_code, prompt_tokens, completion_tokens, total_tokens FROM request_logs",
    )
    .fetch_one(database.sqlite_pool().unwrap())
    .await
    .expect("buffered stream log row");
    assert_eq!(
        sqlx::Row::try_get::<i64, _>(&row, "status_code").unwrap(),
        200
    );
    assert_eq!(
        sqlx::Row::try_get::<i64, _>(&row, "prompt_tokens").unwrap(),
        5
    );
    assert_eq!(
        sqlx::Row::try_get::<i64, _>(&row, "completion_tokens").unwrap(),
        6
    );
    assert_eq!(
        sqlx::Row::try_get::<i64, _>(&row, "total_tokens").unwrap(),
        11
    );
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM request_logs")
        .fetch_one(database.sqlite_pool().unwrap())
        .await
        .unwrap();
    assert_eq!(count, 1);
}

#[tokio::test]
async fn post_v1_chat_completions_logs_unresolved_streaming_model() {
    let test_db = TestDatabase::new().expect("test db");
    let database = test_db.connect().await.expect("db connect");
    let (_upstream, state) = app_state_with_fake_upstream().await;
    let app = create_router(state.with_database(database.clone()));
    let body = serde_json::json!({
        "model": "missing-provider/unknown-model",
        "messages": [{ "role": "user", "content": "log unresolved model" }],
        "stream": true
    });

    let response = app
        .oneshot(chat_request("/v1/chat/completions", body))
        .await
        .unwrap();
    let stream_body = text_body(response).await;
    assert!(stream_body.contains("No provider is registered for model"));

    let row = sqlx::query(
        "SELECT provider_id, model, resolved_model, status_code, error_message FROM request_logs",
    )
    .fetch_one(database.sqlite_pool().unwrap())
    .await
    .expect("unresolved stream log row");
    assert_eq!(
        sqlx::Row::try_get::<String, _>(&row, "provider_id").unwrap(),
        "missing-provider"
    );
    assert_eq!(
        sqlx::Row::try_get::<String, _>(&row, "model").unwrap(),
        "missing-provider/unknown-model"
    );
    assert!(
        sqlx::Row::try_get::<Option<String>, _>(&row, "resolved_model")
            .unwrap()
            .is_none()
    );
    assert_eq!(
        sqlx::Row::try_get::<i64, _>(&row, "status_code").unwrap(),
        404
    );
    assert!(
        sqlx::Row::try_get::<Option<String>, _>(&row, "error_message")
            .unwrap()
            .is_some()
    );
}

#[tokio::test]
async fn post_v1_chat_completions_logs_streaming_failure() {
    let test_db = TestDatabase::new().expect("test db");
    let database = test_db.connect().await.expect("db connect");
    let (_upstream, state) = app_state_with_fake_upstream().await;
    let app = create_router(state.with_database(database.clone()));
    let body = serde_json::json!({
        "model": "opencode_zen/upstream-fail",
        "messages": [{ "role": "user", "content": "log failure" }],
        "stream": true
    });

    let response = app
        .oneshot(chat_request("/v1/chat/completions", body))
        .await
        .unwrap();
    let stream_body = text_body(response).await;
    assert!(stream_body.contains("OpenAI Provider Stream Error (401)"));

    let row = sqlx::query("SELECT status_code, error_message FROM request_logs")
        .fetch_one(database.sqlite_pool().unwrap())
        .await
        .expect("failure log row");
    assert_eq!(
        sqlx::Row::try_get::<i64, _>(&row, "status_code").unwrap(),
        401
    );
    assert!(
        sqlx::Row::try_get::<Option<String>, _>(&row, "error_message")
            .unwrap()
            .is_some()
    );
}

#[tokio::test]
async fn stream_upstream_failure_emits_an_in_stream_error_event() {
    let (_upstream, app) = test_app().await;
    let body = serde_json::json!({
        "model": "opencode_zen/upstream-fail",
        "messages": [ { "role": "user", "content": "Hello" } ],
        "stream": true
    });

    let response = app
        .oneshot(chat_request("/v1/chat/completions", body))
        .await
        .unwrap();

    // The stream opens first; the failure is encoded as an SSE error event.
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response.headers()[header::CONTENT_TYPE],
        "text/event-stream"
    );

    let text = text_body(response).await;
    assert!(text.contains("data: {"));
    assert!(text.contains("OpenAI Provider Stream Error (401)"));
    assert!(text.contains("\"type\":\"api_error\""));
    assert!(!text.contains("[DONE]"));
}

#[tokio::test]
async fn stream_unknown_model_emits_a_404_error_event() {
    let (_upstream, app) = test_app().await;
    let body = serde_json::json!({
        "model": "anthropic/claude-sonnet-4",
        "messages": [ { "role": "user", "content": "Hello" } ],
        "stream": true
    });

    let response = app
        .oneshot(chat_request("/v1/chat/completions", body))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response.headers()[header::CONTENT_TYPE],
        "text/event-stream"
    );

    let text = text_body(response).await;
    assert!(text.contains("No provider is registered for model"));
    assert!(text.contains("\"type\":\"invalid_request_error\""));
    assert!(!text.contains("[DONE]"));
}

#[tokio::test]
async fn post_v1_chat_completions_forwards_cache_control_and_returns_cached_tokens() {
    let (_upstream, app) = test_app().await;
    let body = serde_json::json!({
        "model": "opencode_zen/space-bunny-free",
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": "Long prompt to cache",
                        "cache_control": { "type": "ephemeral" }
                    }
                ],
                "cache_control": { "type": "ephemeral" }
            }
        ],
        "prompt_cache_key": "cache-sess-ctx-1"
    });

    let response = app
        .oneshot(chat_request("/v1/chat/completions", body))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let json = json_body(response).await;

    // Upstream receives cache_control on message and content parts. The token
    // saver prepends a system message, so the client's user turn is at index 1.
    let echo = &json["echo"];
    assert_eq!(echo["prompt_cache_key"], "cache-sess-ctx-1");
    assert_eq!(echo["messages"][0]["role"], "system");
    assert_eq!(echo["messages"][0]["content"], TERSE_DIRECTIVE);
    assert_eq!(echo["messages"][1]["cache_control"]["type"], "ephemeral");
    assert_eq!(
        echo["messages"][1]["content"][0]["cache_control"]["type"],
        "ephemeral"
    );

    // Response usage contains normalized cached tokens details
    assert_eq!(json["usage"]["prompt_tokens"], 100);
    assert_eq!(json["usage"]["completion_tokens"], 20);
    assert_eq!(json["usage"]["total_tokens"], 120);
    assert_eq!(json["usage"]["prompt_tokens_details"]["cached_tokens"], 80);
}

#[tokio::test]
async fn post_v1_chat_completions_records_log_with_cached_tokens_in_database() {
    let test_db = support::TestDatabase::new().expect("test db");
    let database = test_db.connect().await.expect("db connect");

    let (upstream, state) = app_state_with_fake_upstream().await;
    let state = state.with_database(database.clone());
    let app = create_router(state);

    let body = serde_json::json!({
        "model": "opencode_zen/space-bunny-free",
        "messages": [ { "role": "user", "content": "Test DB request log" } ],
        "prompt_cache_key": "cache-db-key-1"
    });

    let response = app
        .oneshot(chat_request("/v1/chat/completions", body))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    // Verify request_logs row in SQLite database
    let pool = database.sqlite_pool().unwrap();
    let row = sqlx::query(
        "SELECT model, prompt_tokens, completion_tokens, total_tokens, cached_tokens, status_code FROM request_logs ORDER BY created_at DESC LIMIT 1"
    )
    .fetch_one(pool)
    .await
    .expect("request log row must exist");

    let model: String = sqlx::Row::try_get(&row, "model").unwrap();
    let prompt_tokens: i64 = sqlx::Row::try_get(&row, "prompt_tokens").unwrap();
    let completion_tokens: i64 = sqlx::Row::try_get(&row, "completion_tokens").unwrap();
    let total_tokens: i64 = sqlx::Row::try_get(&row, "total_tokens").unwrap();
    let cached_tokens: i64 = sqlx::Row::try_get(&row, "cached_tokens").unwrap();
    let status_code: i64 = sqlx::Row::try_get(&row, "status_code").unwrap();

    assert_eq!(model, "opencode_zen/space-bunny-free");
    assert_eq!(status_code, 200);
    assert_eq!(prompt_tokens, 100);
    assert_eq!(completion_tokens, 20);
    assert_eq!(total_tokens, 120);
    assert_eq!(cached_tokens, 80);

    drop(upstream);
}

#[tokio::test]
async fn post_v1_chat_completions_intercepts_web_search_when_not_provided_by_client() {
    let (upstream, state) = app_state_with_fake_upstream().await;
    let state = state.with_search(
        srouter_server::features::gateway::search::SearchService::with_mock(|query, _limit| {
            Some(
                srouter_server::features::gateway::search::WebSearchResponse {
                    query: query.to_owned(),
                    results: vec![srouter_server::features::gateway::search::WebSearchResult {
                        title: "Rust Async Book".to_owned(),
                        url: "https://rust-lang.github.io/async-book/".to_owned(),
                        snippet: "An introduction to async programming in Rust.".to_owned(),
                    }],
                    source: Some("mock_engine".to_owned()),
                },
            )
        }),
    );
    let app = create_router(state);

    let body = serde_json::json!({
        "model": "opencode_zen/space-bunny-search",
        "messages": [ { "role": "user", "content": "What is async in Rust?" } ],
        "stream": false
    });

    let response = app
        .oneshot(chat_request("/v1/chat/completions", body))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let json = json_body(response).await;

    // Upstream was re-called with tool results; grounded answer returned
    assert_eq!(
        json["choices"][0]["message"]["content"],
        "Grounded search response based on tool results"
    );
    assert_eq!(json["choices"][0]["finish_reason"], "stop");

    // Total tokens accumulated across both turns: 45 (turn 1) + 70 (turn 2) = 115
    assert_eq!(json["usage"]["prompt_tokens"], 80);
    assert_eq!(json["usage"]["completion_tokens"], 35);
    assert_eq!(json["usage"]["total_tokens"], 115);

    // Verify messages delivered to upstream in turn 2. The token saver prepends
    // a system message, so the follow-up turn carries four messages.
    let echo_messages = json["echo"]["messages"].as_array().unwrap();
    assert_eq!(echo_messages.len(), 4);
    assert_eq!(echo_messages[0]["role"], "system");
    assert_eq!(echo_messages[0]["content"], TERSE_DIRECTIVE);
    assert_eq!(echo_messages[1]["role"], "user");
    assert_eq!(echo_messages[2]["role"], "assistant");
    assert_eq!(echo_messages[3]["role"], "tool");
    assert!(
        echo_messages[3]["content"]
            .as_str()
            .unwrap()
            .contains("Rust Async Book")
    );

    drop(upstream);
}

#[tokio::test]
async fn post_v1_chat_completions_does_not_intercept_when_tool_is_provided_by_client() {
    let (upstream, state) = app_state_with_fake_upstream().await;
    let state = state.with_search(
        srouter_server::features::gateway::search::SearchService::with_mock(|query, _limit| {
            Some(
                srouter_server::features::gateway::search::WebSearchResponse {
                    query: query.to_owned(),
                    results: vec![],
                    source: Some("mock_engine".to_owned()),
                },
            )
        }),
    );
    let app = create_router(state);

    let body = serde_json::json!({
        "model": "opencode_zen/space-bunny-search",
        "messages": [ { "role": "user", "content": "What is async in Rust?" } ],
        "tools": [{
            "type": "function",
            "function": {
                "name": "web_search",
                "description": "Search the web"
            }
        }],
        "stream": false
    });

    let response = app
        .oneshot(chat_request("/v1/chat/completions", body))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let json = json_body(response).await;

    // Tool call returned directly to client without gateway interception
    assert_eq!(json["choices"][0]["finish_reason"], "tool_calls");
    assert_eq!(
        json["choices"][0]["message"]["tool_calls"][0]["function"]["name"],
        "web_search"
    );
    assert_eq!(json["usage"]["total_tokens"], 45);

    drop(upstream);
}

#[tokio::test]
async fn stream_chat_completions_intercepts_web_search_and_streams_final_answer() {
    let (upstream, state) = app_state_with_fake_upstream().await;
    let state = state.with_search(
        srouter_server::features::gateway::search::SearchService::with_mock(|query, _limit| {
            Some(
                srouter_server::features::gateway::search::WebSearchResponse {
                    query: query.to_owned(),
                    results: vec![srouter_server::features::gateway::search::WebSearchResult {
                        title: "Rust Async Book".to_owned(),
                        url: "https://rust-lang.github.io/async-book/".to_owned(),
                        snippet: "An introduction to async programming in Rust.".to_owned(),
                    }],
                    source: Some("mock_engine".to_owned()),
                },
            )
        }),
    );
    let app = create_router(state);

    let body = serde_json::json!({
        "model": "opencode_zen/space-bunny-search",
        "messages": [ { "role": "user", "content": "What is async in Rust?" } ],
        "stream": true
    });

    let response = app
        .oneshot(chat_request("/v1/chat/completions", body))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response.headers()[header::CONTENT_TYPE],
        "text/event-stream"
    );

    let text = text_body(response).await;
    // Grounded answer streamed from turn 2
    assert!(text.contains("Grounded streaming search response"));
    assert!(text.contains("[DONE]"));

    drop(upstream);
}

#[tokio::test]
async fn stream_chat_completions_does_not_intercept_when_tool_is_provided_by_client() {
    let (upstream, state) = app_state_with_fake_upstream().await;
    let state = state.with_search(
        srouter_server::features::gateway::search::SearchService::with_mock(|query, _limit| {
            Some(
                srouter_server::features::gateway::search::WebSearchResponse {
                    query: query.to_owned(),
                    results: vec![],
                    source: Some("mock_engine".to_owned()),
                },
            )
        }),
    );
    let app = create_router(state);

    let body = serde_json::json!({
        "model": "opencode_zen/space-bunny-search",
        "messages": [ { "role": "user", "content": "What is async in Rust?" } ],
        "tools": [{
            "type": "function",
            "function": {
                "name": "web_search",
                "description": "Search the web"
            }
        }],
        "stream": true
    });

    let response = app
        .oneshot(chat_request("/v1/chat/completions", body))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response.headers()[header::CONTENT_TYPE],
        "text/event-stream"
    );

    let text = text_body(response).await;
    // Tool calls stream yielded directly to client
    assert!(text.contains("web_search"));
    assert!(text.contains("call_search_stream_1"));
    assert!(text.contains("tool_calls"));
    assert!(text.contains("[DONE]"));

    drop(upstream);
}

#[tokio::test]
async fn token_saver_compresses_tool_output_and_appends_the_terse_directive() {
    let (upstream, app) = test_app().await;
    let noisy_tool_output =
        "\u{1b}[31mred\u{1b}[0m\n\n\n\nsame repeated line\nsame repeated line\nsame repeated line";
    let body = serde_json::json!({
        "model": "opencode_zen/space-bunny-free",
        "messages": [
            { "role": "system", "content": "policy" },
            { "role": "tool", "content": noisy_tool_output },
            { "role": "user", "content": "summarize" }
        ],
        "stream": false
    });

    let response = app
        .oneshot(chat_request("/v1/chat/completions", body))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    let captured = upstream.last_chat_body();
    let messages = captured["messages"].as_array().expect("messages array");
    assert_eq!(
        messages[0]["content"],
        serde_json::json!(format!("policy\n\n{TERSE_DIRECTIVE}"))
    );
    assert_eq!(
        messages[1]["content"],
        serde_json::json!("red\n\nsame repeated line (x3)")
    );
    assert_eq!(messages[2]["content"], serde_json::json!("summarize"));
}

#[tokio::test]
async fn token_saver_prepends_the_directive_and_leaves_clean_content_untouched() {
    let (upstream, app) = test_app().await;
    let body = serde_json::json!({
        "model": "opencode_zen/space-bunny-free",
        "messages": [
            { "role": "user", "content": "hello world\nsecond line" }
        ],
        "stream": false
    });

    let response = app
        .oneshot(chat_request("/v1/chat/completions", body))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    let captured = upstream.last_chat_body();
    let messages = captured["messages"].as_array().expect("messages array");
    assert_eq!(messages[0]["role"], serde_json::json!("system"));
    assert_eq!(messages[0]["content"], serde_json::json!(TERSE_DIRECTIVE));
    assert_eq!(
        messages[1]["content"],
        serde_json::json!("hello world\nsecond line")
    );
}

#[tokio::test]
async fn token_saver_compresses_streaming_requests_too() {
    let (upstream, app) = test_app().await;
    let body = serde_json::json!({
        "model": "opencode_zen/space-bunny-free",
        "messages": [
            { "role": "tool", "content": "\u{1b}[32mtool output\u{1b}[0m" }
        ],
        "stream": true
    });

    let response = app
        .oneshot(chat_request("/v1/chat/completions", body))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let _ = text_body(response).await;

    let captured = upstream.last_chat_body();
    assert_eq!(captured["stream"], serde_json::json!(true));
    let messages = captured["messages"].as_array().expect("messages array");
    assert_eq!(messages[0]["content"], serde_json::json!(TERSE_DIRECTIVE));
    assert_eq!(messages[1]["content"], serde_json::json!("tool output"));
}

/// What the recording API-key repository observed during a request.
#[derive(Default)]
struct UsageRecord {
    reservations: Vec<(String, i64)>,
    settlements: Vec<(String, i64, i64)>,
    increments: Vec<(String, i64, f64)>,
}

/// An `APIKeyRepository` that records the quota calls the gateway makes, so the
/// chat accounting can be asserted without a real database. Only the quota
/// methods are exercised; the CRUD surface is unused.
struct RecordingAPIKeyRepository {
    reserve_succeeds: bool,
    record: Mutex<UsageRecord>,
}

impl RecordingAPIKeyRepository {
    fn new(reserve_succeeds: bool) -> Self {
        Self {
            reserve_succeeds,
            record: Mutex::new(UsageRecord::default()),
        }
    }

    fn record(&self) -> std::sync::MutexGuard<'_, UsageRecord> {
        self.record.lock().expect("usage record")
    }
}

fn not_recorded() -> APIError {
    APIError::new(500, "recording repository: method not exercised")
}

impl APIKeyRepository for RecordingAPIKeyRepository {
    fn list(&self) -> BoxFuture<'_, Result<Vec<APIKey>, APIError>> {
        Box::pin(async { Err(not_recorded()) })
    }

    fn create(&self, _input: CreateAPIKeyInput) -> BoxFuture<'_, Result<CreatedAPIKey, APIError>> {
        Box::pin(async { Err(not_recorded()) })
    }

    fn update(
        &self,
        _id: &str,
        _patch: UpdateAPIKeyInput,
    ) -> BoxFuture<'_, Result<Option<APIKey>, APIError>> {
        Box::pin(async { Err(not_recorded()) })
    }

    fn add_credit(
        &self,
        _id: &str,
        _amount: f64,
    ) -> BoxFuture<'_, Result<Option<APIKey>, APIError>> {
        Box::pin(async { Err(not_recorded()) })
    }

    fn delete(&self, _id: &str) -> BoxFuture<'_, Result<bool, APIError>> {
        Box::pin(async { Err(not_recorded()) })
    }

    fn reserve_quota(
        &self,
        id: &str,
        reserved_tokens: i64,
    ) -> BoxFuture<'_, Result<bool, APIError>> {
        let id = id.to_owned();
        let succeeds = self.reserve_succeeds;

        Box::pin(async move {
            self.record().reservations.push((id, reserved_tokens));
            Ok(succeeds)
        })
    }

    fn settle_quota(
        &self,
        id: &str,
        reserved_tokens: i64,
        actual_tokens: i64,
    ) -> BoxFuture<'_, Result<(), APIError>> {
        let id = id.to_owned();

        Box::pin(async move {
            self.record()
                .settlements
                .push((id, reserved_tokens, actual_tokens));
            Ok(())
        })
    }

    fn increment_usage(
        &self,
        id: &str,
        tokens: i64,
        cost: f64,
    ) -> BoxFuture<'_, Result<(), APIError>> {
        let id = id.to_owned();

        Box::pin(async move {
            self.record().increments.push((id, tokens, cost));
            Ok(())
        })
    }
}

/// Router with a recording quota repository and one fixture key whose raw value
/// is `sr-live-quota-test`. `reserve_succeeds` decides whether the admission
/// reservation lands.
async fn keyed_app(
    reserve_succeeds: bool,
) -> (FakeUpstream, Arc<RecordingAPIKeyRepository>, Router) {
    let repository = Arc::new(RecordingAPIKeyRepository::new(reserve_succeeds));
    let security = SecurityState::with_repository(
        Arc::new(FixtureAPIKeyStore::new(
            false,
            vec![("sr-live-quota-test".to_owned(), api_key_record("key-1"))],
        )),
        Arc::new(FixtureAdminSessionStore::new(vec![])),
        repository.clone(),
    );
    let (upstream, state) = app_state_with_fake_upstream_and_security(security).await;

    (upstream, repository, create_router(state))
}

fn keyed_chat_request(body: serde_json::Value) -> Request<Body> {
    with_loopback_client(
        Request::builder()
            .method("POST")
            .uri("/v1/chat/completions")
            .version(Version::HTTP_11)
            .header(header::CONTENT_TYPE, "application/json")
            .header(header::AUTHORIZATION, "Bearer sr-live-quota-test")
            .body(Body::from(serde_json::to_vec(&body).unwrap()))
            .unwrap(),
    )
}

#[tokio::test]
async fn a_request_that_cannot_reserve_its_budget_is_rejected_before_the_upstream() {
    let (upstream, repository, app) = keyed_app(false).await;
    let body = serde_json::json!({
        "model": "opencode_zen/space-bunny-free",
        "messages": [ { "role": "user", "content": "Hello" } ],
        "stream": false,
        "max_tokens": 100
    });

    let response = app.oneshot(keyed_chat_request(body)).await.unwrap();

    assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);
    let json = json_body(response).await;
    assert_eq!(json["error"]["code"], "quota_exceeded");
    assert_eq!(
        json["error"]["message"],
        "Token quota exceeded. The requested budget is unavailable."
    );
    assert_eq!(upstream.chat_requests(), 0);
    assert_eq!(
        repository.record().reservations,
        vec![("key-1".to_owned(), 100)]
    );
}

#[tokio::test]
async fn a_completed_request_settles_the_reservation_to_the_real_tokens() {
    let (_upstream, repository, app) = keyed_app(true).await;
    let body = serde_json::json!({
        "model": "opencode_zen/space-bunny-free",
        "messages": [ { "role": "user", "content": "Hello" } ],
        "stream": false
    });

    let response = app.oneshot(keyed_chat_request(body)).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    let record = repository.record();
    // No `max_tokens` in the body, so the default 4096 budget is reserved and
    // settled to the fake upstream's 3 total tokens.
    assert_eq!(record.reservations, vec![("key-1".to_owned(), 4096)]);
    assert_eq!(record.settlements, vec![("key-1".to_owned(), 4096, 3)]);
    assert_eq!(record.increments, vec![("key-1".to_owned(), 0, 0.0)]);
}

#[tokio::test]
async fn an_upstream_failure_releases_the_reservation() {
    let (_upstream, repository, app) = keyed_app(true).await;
    let body = serde_json::json!({
        "model": "opencode_zen/upstream-fail",
        "messages": [ { "role": "user", "content": "Hello" } ],
        "stream": false
    });

    let response = app.oneshot(keyed_chat_request(body)).await.unwrap();
    assert_ne!(response.status(), StatusCode::OK);

    let record = repository.record();
    assert_eq!(record.reservations, vec![("key-1".to_owned(), 4096)]);
    assert_eq!(record.settlements, vec![("key-1".to_owned(), 4096, 0)]);
    assert!(record.increments.is_empty());
}

// Client-cancellation billing (server/TODO.md §6). The Node oracle is
// `apps/api/tests/api-keys-usage-deduction.test.ts`
// ("does not bill a stream that errors after partial output without usage"):
// a failure after partial output bills nothing; a completed stream settles to
// the usage it reported. A disconnect bills exactly the usage observed before
// the gateway cancelled the upstream (Node itself drains instead — probe16).

#[tokio::test]
async fn a_mid_stream_failure_after_partial_output_bills_nothing() {
    let (_upstream, repository, app) = keyed_app(true).await;
    let body = serde_json::json!({
        "model": "opencode_zen/space-bunny-error",
        "messages": [ { "role": "user", "content": "Hello" } ],
        "stream": true
    });

    let response = app.oneshot(keyed_chat_request(body)).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    // The client sees the partial output and then the in-stream failure
    // payload — the failure is never swallowed behind a normal `[DONE]`.
    let text = text_body(response).await;
    assert!(text.contains("partial output"), "text: {text}");
    assert!(text.contains("\"type\":\"api_error\""), "text: {text}");
    assert!(!text.contains("[DONE]"), "text: {text}");

    let record = repository.record();
    assert_eq!(record.reservations, vec![("key-1".to_owned(), 4096)]);
    // Released in full: zero usage billed, zero increments (Node parity).
    assert_eq!(record.settlements, vec![("key-1".to_owned(), 4096, 0)]);
    assert!(
        record.increments.is_empty(),
        "a failed stream must not bill usage: {:?}",
        record.increments
    );
}

#[tokio::test]
async fn a_client_disconnect_bills_only_the_observed_usage() {
    let (_upstream, repository, app) = keyed_app(true).await;
    let body = serde_json::json!({
        "model": "opencode_zen/space-bunny-hang",
        "messages": [ { "role": "user", "content": "Hello" } ],
        "stream": true
    });

    let response = app.oneshot(keyed_chat_request(body)).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    // The first chunk carries usage {11 prompt, 3 completion}; read it, then
    // disconnect by dropping the response body mid-stall.
    let mut frames = response.into_body().into_data_stream();
    let first = frames
        .next()
        .await
        .expect("first body frame")
        .expect("first body frame ok");
    let first = String::from_utf8(first.to_vec()).expect("utf-8 frame");
    assert!(first.contains("first chunk"), "frame: {first}");
    drop(frames);

    // The gateway settles the reservation to the usage it observed before the
    // disconnect — not to the upstream response it never waited for, and not
    // a full release: cancellation bills partial output.
    let settled = tokio::time::timeout(std::time::Duration::from_secs(10), async {
        loop {
            if repository.record().settlements == vec![("key-1".to_owned(), 4096, 14)] {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        }
    })
    .await;
    assert!(
        settled.is_ok(),
        "reservation never settled after the disconnect: {:?}",
        repository.record().settlements
    );
    let record = repository.record();
    assert_eq!(record.reservations, vec![("key-1".to_owned(), 4096)]);
    assert_eq!(record.settlements, vec![("key-1".to_owned(), 4096, 14)]);
    assert_eq!(record.increments, vec![("key-1".to_owned(), 0, 0.0)]);
}
