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
use std::net::SocketAddr;

use axum::{
    body::{Body, to_bytes},
    extract::ConnectInfo,
    http::{Request, StatusCode, header},
};
use srouter_server::features::providers::opencode::executor::OpenCodeExecutor;
use srouter_server::features::providers::{OPENCODE_ZEN_MODELS, opencode};
use srouter_server::{APIConfig, AppState, app::create_router};
use tower::ServiceExt;

/// Proves the boot-time catalog path end to end: the live list is fetched, the
/// free-tier filter applies, and the seed is merged rather than replaced.
#[tokio::test]
#[ignore = "reaches the real OpenCode Zen upstream over the network"]
async fn opencode_zen_catalog_merges_the_live_free_tier_list() {
    let adapter = opencode::adapter(None).expect("opencode_zen adapter");
    let executor = adapter
        .downcast_ref::<OpenCodeExecutor>()
        .expect("the adapter is the opencode executor");

    executor
        .refresh_catalog()
        .await
        .expect("live catalog fetch");
    let models = executor.models();

    println!("models: {models:?}");
    assert!(
        OPENCODE_ZEN_MODELS
            .iter()
            .all(|seed| models.contains(&seed.id.to_owned())),
        "the seed must survive the merge: {models:?}"
    );
    assert!(
        !models.contains(&"jev-1.13-free".to_owned()),
        "`jev-1.13-free` is not a chat-completions model: {models:?}"
    );
}

#[tokio::test]
#[ignore = "reaches the real OpenCode Zen upstream over the network"]
async fn opencode_zen_answers_a_chat_completion() {
    let environment = HashMap::from([("HOME".to_owned(), "/tmp/srouter-live-home".to_owned())]);
    let config = APIConfig::from_env_map(&environment).expect("configuration");
    let app = create_router(AppState::new(config).expect("application state"));

    let model = std::env::var("SROUTER_LIVE_MODEL")
        .unwrap_or_else(|_| "opencode_zen/flint-40b-free".to_owned());
    println!("model: {model}");

    let body = serde_json::json!({
        "model": model,
        "messages": [ { "role": "user", "content": "Reply with the single word: pong" } ],
        "stream": false
    });

    let mut request = Request::builder()
        .method("POST")
        .uri("/v1/chat/completions")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(serde_json::to_vec(&body).unwrap()))
        .unwrap();
    // The gateway only bypasses API-key enforcement for loopback peers.
    request
        .extensions_mut()
        .insert(ConnectInfo(SocketAddr::from(([127, 0, 0, 1], 40_000))));

    let response = app.oneshot(request).await.unwrap();

    let status = response.status();
    let bytes = to_bytes(response.into_body(), 65536).await.unwrap();
    println!("status: {status}");
    println!("body: {}", String::from_utf8_lossy(&bytes));

    assert_eq!(status, StatusCode::OK);
}
