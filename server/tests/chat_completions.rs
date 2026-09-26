mod support;

use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode, Version, header},
};
use srouter_server::app::create_router;
use support::{FakeUpstream, app_state_with_fake_upstream, with_loopback_client};
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
    assert!(
        json["error"]["message"]
            .as_str()
            .unwrap()
            .contains("Malformed JSON")
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
