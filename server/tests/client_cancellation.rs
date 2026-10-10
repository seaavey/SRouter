//! Client-cancellation semantics for streamed gateway responses
//! (`server/TODO.md` §6): a disconnect cancels the upstream request, and the
//! gateway never buffers the complete stream before responding. Node's own
//! behavior (probe16) drains the upstream after a disconnect — the plan
//! (`2026-09-24-srouter-api-rust-migration.md`, "Verify client disconnect
//! cancels the upstream request and that the server does not buffer the
//! complete stream") makes prompt cancellation the Rust build's requirement.

mod support;

use axum::{
    Router,
    body::Body,
    http::{Request, StatusCode, Version, header},
};
use futures_util::StreamExt;
use srouter_server::app::create_router;
use support::{FakeUpstream, app_state_with_fake_upstream, with_loopback_client};
use tower::ServiceExt;

async fn test_app() -> (FakeUpstream, Router) {
    let (upstream, state) = app_state_with_fake_upstream().await;

    (upstream, create_router(state))
}

fn stream_request(uri: &str, body: serde_json::Value) -> Request<Body> {
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

fn hang_body() -> serde_json::Value {
    serde_json::json!({
        "model": "opencode_zen/space-bunny-hang",
        "messages": [{ "role": "user", "content": "Stream early" }],
        "stream": true
    })
}

/// Reads response frames until `needle` shows up, or fails after ten seconds.
/// The `space-bunny-hang` fake stalls for 600 s after its first chunk, so a
/// gateway that buffered the full response could never satisfy this.
async fn read_until(response: axum::response::Response, needle: &str) -> String {
    let mut frames = response.into_body().into_data_stream();
    let mut received = String::new();
    tokio::time::timeout(std::time::Duration::from_secs(10), async {
        while let Some(frame) = frames.next().await {
            let frame = frame.expect("body frame");
            received.push_str(core::str::from_utf8(&frame).expect("utf-8 frame"));
            if received.contains(needle) {
                break;
            }
        }
    })
    .await
    .unwrap_or_else(|_| panic!("`{needle}` not delivered while the upstream was still stalled"));
    received
}

#[tokio::test]
async fn stream_delivers_events_before_the_upstream_completes() {
    let (upstream, app) = test_app().await;

    let response = app
        .oneshot(stream_request("/v1/chat/completions", hang_body()))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    // The chunk reaches the client while the upstream is still inside its
    // 600-second stall: the response is a live stream, not a buffered replay.
    let received = read_until(response, "first chunk").await;
    assert!(
        received.contains("data:"),
        "SSE frames expected: {received}"
    );

    // The fake never produced its second chunk, so nothing could have waited
    // for the complete upstream response.
    assert_eq!(upstream.with(|state| state.stream_chunks_sent), 1);
    assert!(!upstream.with(|state| state.stream_finished));
}

#[tokio::test]
async fn client_disconnect_cancels_the_upstream_request() {
    let (upstream, app) = test_app().await;

    let response = app
        .oneshot(stream_request("/v1/messages", {
            let mut body = hang_body();
            body["max_tokens"] = serde_json::json!(1024);
            body
        }))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    // Get the partial output on the wire, then leave: dropping the body closes
    // the mpsc receiver the gateway task selects on.
    read_until(response, "first chunk").await;

    let cancelled = tokio::time::timeout(std::time::Duration::from_secs(10), async {
        loop {
            if upstream.with(|state| state.stream_cancelled) {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        }
    })
    .await;
    assert!(
        cancelled.is_ok(),
        "upstream body was not dropped after the client disconnected — the gateway sat out the stall"
    );
    // Dropped during the stall, before the fake's second chunk (600 s away).
    assert_eq!(upstream.with(|state| state.stream_chunks_sent), 1);
    assert!(!upstream.with(|state| state.stream_finished));
}
