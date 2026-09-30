//! Gateway tests for the `qoder` provider: signed upstream requests, the
//! envelope-to-OpenAI translation, and the model catalog. The upstream is the
//! fake Qoder gateway, so nothing here reaches the network.

mod support;

use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode},
    response::Response,
};
use srouter_server::app::create_router;
use srouter_server::features::providers::ProviderAdapter;
use srouter_server::features::providers::qoder::{self};
use srouter_server::infrastructure::database::providers::{
    QoderConnectionWrite, upsert_qoder_connection,
};
use support::{
    FakeQoderUpstream, TestDatabase, json_request, qoder_registry, qoder_state,
    with_loopback_client,
};
use tower::ServiceExt;

/// Writes the connection every chat test authenticates with.
async fn connect(database: &TestDatabase) {
    let app_database = database.connect().await.expect("temporary database");

    upsert_qoder_connection(
        &app_database,
        &QoderConnectionWrite {
            id: "qoder_1".to_owned(),
            name: "Qoder (Seaavey Dev)".to_owned(),
            account_name: "Seaavey Dev".to_owned(),
            access_token: "dt-fixture-token".to_owned(),
            refresh_token: Some("rt-fixture-token".to_owned()),
            token_expires_at: Some(srouter_server::clock::now_ms() + 86_400_000),
            user_id: "user-fixture".to_owned(),
            email: "seaavey@example.com".to_owned(),
            organization_id: "org-fixture".to_owned(),
        },
    )
    .await
    .expect("connection stored");
}

async fn app(database: &TestDatabase, fake: &FakeQoderUpstream) -> Router {
    let app_database = database.connect().await.expect("temporary database");

    create_router(qoder_state(
        app_database,
        srouter_server::SecurityState::unconfigured(),
        fake,
    ))
}

fn chat_request(body: serde_json::Value) -> Request<Body> {
    with_loopback_client(json_request("POST", "/v1/chat/completions", body))
}

async fn body_text(response: Response) -> String {
    let bytes = to_bytes(response.into_body(), 1_048_576).await.unwrap();

    String::from_utf8(bytes.to_vec()).expect("utf8 body")
}

#[tokio::test]
async fn a_streaming_chat_translates_the_envelope_into_openai_frames() {
    let database = TestDatabase::new().unwrap();
    connect(&database).await;
    let fake = FakeQoderUpstream::start().await;
    let app = app(&database, &fake).await;
    let request = chat_request(serde_json::json!({
        "model": "qd/auto",
        "messages": [
            {"role": "system", "content": "be brief"},
            {"role": "user", "content": "hi"}
        ],
        "stream": true
    }));

    let response = app.oneshot(request).await.unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = body_text(response).await;
    assert!(body.contains(r#"data: {"#), "chunks are openai framed");
    assert!(
        body.ends_with("data: [DONE]\n\n"),
        "the gateway forwards provider bytes, so the terminator is added here: {:?}",
        &body[body.len().saturating_sub(40)..]
    );
    assert!(body.contains(r#""model":"auto""#), "chunks carry the model");

    // The request that reached the upstream was signed and encoded.
    assert_eq!(fake.chat_requests(), 1);
    assert_eq!(fake.last_model_key(), "auto");
    assert_eq!(
        fake.last_sig_path(),
        "/api/v2/service/pro/sse/agent_chat_generation"
    );

    let encoded = fake.last_encoded_body();
    assert!(
        !encoded.contains('{'),
        "the body never travels as plain json"
    );
    let sent = qoder::cosy::decode_body(&encoded).expect("body decodes");
    let sent: serde_json::Value = serde_json::from_slice(&sent).expect("body is json");

    assert_eq!(sent["system"], "be brief");
    assert_eq!(sent["messages"][0]["role"], "user");
    assert_eq!(sent["model_config"]["key"], "auto");
    assert_eq!(sent["parameters"]["max_tokens"], 32_768);
    assert_eq!(sent["chat_context"]["text"], "hi");
}

#[tokio::test]
async fn a_fragmented_stream_is_reassembled_into_complete_frames() {
    let database = TestDatabase::new().unwrap();
    connect(&database).await;
    let fake = FakeQoderUpstream::start().await;
    fake.with(|state| state.fragment_chat = true);
    let app = app(&database, &fake).await;
    let request = chat_request(serde_json::json!({
        "model": "qoder/lite",
        "messages": [{"role": "user", "content": "hi"}],
        "stream": true
    }));

    let response = app.oneshot(request).await.unwrap();
    let status = response.status();
    let body = body_text(response).await;

    assert_eq!(status, StatusCode::OK);
    assert!(
        body.contains(r#""content":"Hello""#),
        "the split frame is reassembled: {body:?}"
    );
    assert!(body.contains(r#""content":" world""#));
    assert!(body.ends_with("data: [DONE]\n\n"));
    assert_eq!(fake.last_model_key(), "lite");
}

#[tokio::test]
async fn a_buffered_chat_aggregates_the_stream_into_one_completion() {
    let database = TestDatabase::new().unwrap();
    connect(&database).await;
    let fake = FakeQoderUpstream::start().await;
    let app = app(&database, &fake).await;
    let request = chat_request(serde_json::json!({
        "model": "qd/auto",
        "messages": [{"role": "user", "content": "hi"}],
        "stream": false
    }));

    let response = app.oneshot(request).await.unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), 65_536).await.unwrap();
    let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();

    assert_eq!(body["object"], "chat.completion");
    assert_eq!(body["model"], "auto");
    assert_eq!(body["choices"][0]["message"]["content"], "Hello world");
    assert_eq!(body["choices"][0]["finish_reason"], "stop");
    assert_eq!(body["usage"]["total_tokens"], 12);
    assert_eq!(fake.chat_requests(), 1);
}

#[tokio::test]
async fn a_chat_without_a_connection_is_refused() {
    let database = TestDatabase::new().unwrap();
    let fake = FakeQoderUpstream::start().await;
    let app = app(&database, &fake).await;
    let request = chat_request(serde_json::json!({
        "model": "qd/auto",
        "messages": [{"role": "user", "content": "hi"}]
    }));

    let response = app.oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 65_536).await.unwrap();
    let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();

    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(body["error"]["type"], "authentication_error");
    assert_eq!(
        fake.chat_requests(),
        0,
        "no upstream call without credentials"
    );
}

#[tokio::test]
async fn the_catalog_advertises_the_qoder_models() {
    let database = TestDatabase::new().unwrap();
    let fake = FakeQoderUpstream::start().await;
    let app = app(&database, &fake).await;
    let request = with_loopback_client(
        Request::builder()
            .method("GET")
            .uri("/v1/models")
            .body(Body::empty())
            .unwrap(),
    );

    let response = app.oneshot(request).await.unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), 65_536).await.unwrap();
    let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    let ids: Vec<&str> = body["data"]
        .as_array()
        .expect("model list")
        .iter()
        .filter_map(|entry| entry["id"].as_str())
        .collect();

    assert!(ids.contains(&"qd/auto"), "{ids:?}");
    assert!(ids.contains(&"qd/qmodel_latest"), "{ids:?}");
    assert!(ids.contains(&"zen/space-bunny-free"), "{ids:?}");
}

#[tokio::test]
async fn the_messages_route_answers_from_the_qoder_stream() {
    let database = TestDatabase::new().unwrap();
    connect(&database).await;
    let fake = FakeQoderUpstream::start().await;
    let app = app(&database, &fake).await;
    let request = with_loopback_client(json_request(
        "POST",
        "/v1/messages",
        serde_json::json!({
            "model": "qd/auto",
            "max_tokens": 256,
            "messages": [{"role": "user", "content": "hi"}]
        }),
    ));

    let response = app.oneshot(request).await.unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = body_text(response).await;
    assert!(
        body.contains("Hello world"),
        "the anthropic route reads the translated chunks: {body:?}"
    );
    assert!(body.contains(r#""message""#), "{body:?}");
}

#[tokio::test]
async fn the_live_catalog_replaces_the_seed_and_stops_refreshing_within_the_ttl() {
    let database = TestDatabase::new().unwrap();
    connect(&database).await;
    let fake = FakeQoderUpstream::start().await;
    fake.with(|state| {
        state.model_catalog = serde_json::json!({
            "chat": [
                {"key": "brand-new-model", "enable": true, "is_reasoning": false, "max_output_tokens": 4096},
                {"key": "turned-off", "enable": false}
            ]
        })
    });

    let providers = qoder_registry(
        Some(database.connect().await.expect("temporary database")),
        &fake,
    );
    let executor = match providers.resolve("qd/auto").expect("resolves").adapter {
        ProviderAdapter::Qoder(executor) => executor,
        _ => panic!("the registry must hold the qoder adapter"),
    };

    assert!(
        executor.models().contains(&"auto".to_owned()),
        "the seed answers before the first fetch"
    );

    executor.refresh_catalog().await.expect("catalog refreshes");

    assert_eq!(fake.model_list_requests(), 1);
    assert_eq!(
        fake.model_list_body_length(),
        "0",
        "a signed GET carries an empty body"
    );
    assert_eq!(fake.model_list_sig_path(), "/api/v2/model/list");
    assert_eq!(executor.models(), vec!["brand-new-model".to_owned()]);
    assert!(
        !executor.models().contains(&"turned-off".to_owned()),
        "disabled entries are dropped"
    );

    executor.maybe_refresh(false);
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    assert_eq!(
        fake.model_list_requests(),
        1,
        "a fresh catalog is not fetched again inside the ttl"
    );

    executor.maybe_refresh(true);
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    assert_eq!(
        fake.model_list_requests(),
        2,
        "a forced refresh goes through"
    );
}

#[tokio::test]
async fn a_failed_catalog_fetch_keeps_the_previous_snapshot() {
    let database = TestDatabase::new().unwrap();
    connect(&database).await;
    let fake = FakeQoderUpstream::start().await;
    fake.with(|state| state.model_catalog = serde_json::json!({"error": "no catalog"}));

    let providers = qoder_registry(
        Some(database.connect().await.expect("temporary database")),
        &fake,
    );
    let executor = match providers.resolve("qd/auto").expect("resolves").adapter {
        ProviderAdapter::Qoder(executor) => executor,
        _ => panic!("the registry must hold the qoder adapter"),
    };

    executor.refresh_catalog().await.expect("nothing to parse");

    assert_eq!(executor.models().len(), qoder::QODER_MODELS.len());
    assert!(executor.models().contains(&"auto".to_owned()));
}
