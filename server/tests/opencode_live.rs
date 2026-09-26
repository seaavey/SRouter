//! Live smoke test against the real OpenCode Zen upstream. Ignored by default
//! because it reaches the network:
//!
//! ```bash
//! cargo test --test opencode_live -- --ignored --nocapture
//! ```
//!
//! Override the model under test with `SROUTER_LIVE_MODEL`; the default is the
//! model registered for `opencode_zen`.

use std::collections::HashMap;

use axum::{
    body::{Body, to_bytes},
    http::{Request, StatusCode, header},
};
use srouter_server::{APIConfig, AppState, app::create_router};
use tower::ServiceExt;

#[tokio::test]
#[ignore = "reaches the real OpenCode Zen upstream over the network"]
async fn opencode_zen_answers_a_chat_completion() {
    let environment = HashMap::from([("HOME".to_owned(), "/tmp/srouter-live-home".to_owned())]);
    let config = APIConfig::from_env_map(&environment).expect("configuration");
    let app = create_router(AppState::new(config).expect("application state"));

    let model = std::env::var("SROUTER_LIVE_MODEL")
        .unwrap_or_else(|_| "opencode_zen/space-bunny-free".to_owned());
    println!("model: {model}");

    let body = serde_json::json!({
        "model": model,
        "messages": [ { "role": "user", "content": "Reply with the single word: pong" } ],
        "stream": false
    });

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/chat/completions")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(serde_json::to_vec(&body).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();

    let status = response.status();
    let bytes = to_bytes(response.into_body(), 65536).await.unwrap();
    println!("status: {status}");
    println!("body: {}", String::from_utf8_lossy(&bytes));

    assert_eq!(status, StatusCode::OK);
}
