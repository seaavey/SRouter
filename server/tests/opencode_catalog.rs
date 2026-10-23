//! The OpenCode Zen catalog merges the live free-tier list onto the seed.

mod support;

use axum::{
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use srouter_server::app::create_router;
use support::{app_state_with_fake_upstream, with_loopback_client};
use tower::ServiceExt;

fn models_request() -> Request<Body> {
    with_loopback_client(
        Request::builder()
            .method("GET")
            .uri("/v1/models")
            .body(Body::empty())
            .unwrap(),
    )
}

async fn listed_ids(response: axum::response::Response) -> Vec<String> {
    let bytes = to_bytes(response.into_body(), 65_536).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();

    json["data"]
        .as_array()
        .unwrap()
        .iter()
        .map(|entry| entry["id"].as_str().unwrap().to_owned())
        .collect()
}

#[tokio::test]
async fn the_live_list_adds_a_free_model_and_keeps_the_other_tiers_out() {
    let (fake, state) = app_state_with_fake_upstream().await;
    fake.with(|state| {
        state.model_catalog = serde_json::json!({
            "object": "list",
            "data": [
                { "id": "beam-free" },
                { "id": "live-only-free" },
                { "id": "gpt-5.5" },
                { "id": "jev-1.13-free" }
            ]
        })
    });
    let app = create_router(state);

    let response = app.oneshot(models_request()).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let ids = listed_ids(response).await;

    assert!(
        ids.contains(&"zen/live-only-free".to_owned()),
        "a free model the seed does not hold must arrive from the live list: {ids:?}"
    );
    assert!(
        ids.contains(&"zen/flint-40b-free".to_owned()),
        "the seed must stay advertised: {ids:?}"
    );
    assert!(
        !ids.contains(&"zen/gpt-5.5".to_owned()),
        "a paid tier is not routable without a Zen subscription: {ids:?}"
    );
    assert!(
        !ids.contains(&"zen/jev-1.13-free".to_owned()),
        "`jev-1.13-free` answers ModelProtocolUnsupported on chat completions: {ids:?}"
    );
    assert!(
        !ids.contains(&"zen/space-bunny-free".to_owned()),
        "the retired model must not outlive the seed: {ids:?}"
    );
}
