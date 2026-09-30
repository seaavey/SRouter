//! Gateway tests for the `qoder` provider: signed upstream requests, the
//! envelope-to-OpenAI translation, and the model catalog. The upstream is the
//! fake Qoder gateway, so nothing here reaches the network.

mod support;

use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Method, Request, StatusCode, Uri},
    response::Response,
};
use futures_util::future::join_all;
use srouter_server::app::create_router;
use srouter_server::features::providers::OPENCODE_ZEN_MODELS;
use srouter_server::features::providers::ProviderAdapter;
use srouter_server::features::providers::qoder::{self};
use srouter_server::infrastructure::database::AppDatabase;
use support::{
    FAKE_QODER_ADVERTISED, FakeQoderUpstream, TestDatabase, api_key_record, connect_qoder,
    json_request, json_request_with_headers, qoder_catalog_body, qoder_registry, qoder_state,
    security_state, with_loopback_client, with_remote_client,
};
use tower::ServiceExt;

async fn app(database: &TestDatabase, fake: &FakeQoderUpstream) -> Router {
    create_router(qoder_state(
        database.connect().await.expect("temporary database"),
        srouter_server::SecurityState::unconfigured(),
        fake,
    ))
}

fn chat_request(body: serde_json::Value) -> Request<Body> {
    with_loopback_client(json_request("POST", "/v1/chat/completions", body))
}

fn models_request() -> Request<Body> {
    with_loopback_client(
        Request::builder()
            .method(Method::GET)
            .uri(Uri::from_static("/v1/models"))
            .body(Body::empty())
            .unwrap(),
    )
}

async fn body_text(response: Response) -> String {
    let bytes = to_bytes(response.into_body(), 1_048_576).await.unwrap();

    String::from_utf8(bytes.to_vec()).expect("utf8 body")
}

/// The `id` values a `/v1/models` body advertises.
async fn catalog_ids(response: Response) -> Vec<String> {
    let body: serde_json::Value =
        serde_json::from_slice(&to_bytes(response.into_body(), 65_536).await.unwrap()).unwrap();

    body["data"]
        .as_array()
        .expect("model list")
        .iter()
        .filter_map(|entry| entry["id"].as_str().map(str::to_owned))
        .collect()
}

/// The signed body of the most recent chat request, decoded back to JSON.
fn sent_body(fake: &FakeQoderUpstream) -> serde_json::Value {
    let decoded = qoder::cosy::decode_body(&fake.last_encoded_body()).expect("body decodes");

    serde_json::from_slice(&decoded).expect("body is json")
}

/// The qoder adapter out of a registry that can read `database`.
fn qoder_executor(database: Option<AppDatabase>, fake: &FakeQoderUpstream) -> ProviderAdapter {
    let providers = qoder_registry(database, fake);

    match providers.resolve("qd/auto").expect("resolves").adapter {
        ProviderAdapter::Qoder(executor) => ProviderAdapter::Qoder(executor),
        _ => panic!("the registry must hold the qoder adapter"),
    }
}

#[tokio::test]
async fn a_streaming_chat_translates_the_envelope_into_openai_frames() {
    let database = TestDatabase::new().unwrap();
    connect_qoder(&database).await;
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
    let sent = sent_body(&fake);

    assert_eq!(sent["system"], "be brief");
    assert_eq!(sent["messages"][0]["role"], "user");
    assert_eq!(sent["model_config"]["key"], "auto");
    assert_eq!(sent["parameters"]["max_tokens"], 32_768);
    assert_eq!(sent["chat_context"]["text"], "hi");
}

#[tokio::test]
async fn a_fragmented_stream_is_reassembled_into_complete_frames() {
    let database = TestDatabase::new().unwrap();
    connect_qoder(&database).await;
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
    connect_qoder(&database).await;
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
    assert_eq!(
        fake.model_list_requests(),
        0,
        "a catalog fetch without credentials must not reach the network"
    );
}

#[tokio::test]
async fn the_catalog_advertises_only_what_upstream_returned() {
    let database = TestDatabase::new().unwrap();
    connect_qoder(&database).await;
    let fake = FakeQoderUpstream::start().await;
    fake.with(|state| state.model_catalog = qoder_catalog_body());
    let app = app(&database, &fake).await;

    let response = app.oneshot(models_request()).await.unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let ids = catalog_ids(response).await;
    let expected: Vec<String> = FAKE_QODER_ADVERTISED
        .iter()
        .map(|id| format!("qd/{id}"))
        .collect();
    let qd: Vec<&String> = ids.iter().filter(|id| id.starts_with("qd/")).collect();

    assert_eq!(qd, expected.iter().collect::<Vec<_>>(), "{ids:?}");
    assert!(ids.contains(&"zen/space-bunny-free".to_owned()));
    assert_eq!(
        fake.model_list_requests(),
        1,
        "the request that had nothing to serve waited for its own fetch"
    );
}

#[tokio::test]
async fn a_friendly_id_asks_upstream_for_the_key_it_names() {
    let database = TestDatabase::new().unwrap();
    connect_qoder(&database).await;
    let fake = FakeQoderUpstream::start().await;
    fake.with(|state| state.model_catalog = qoder_catalog_body());
    let app = app(&database, &fake).await;

    // A catalog name, a raw key and a static alias all reach the same upstream
    // models, each signed for the key the id names.
    for (model, key, reasoning) in [
        ("qd/qwen3.7-max", "qmodel_latest", true),
        ("qd/qmodel_latest", "qmodel_latest", true),
        ("qd/qwen-plus", "qmodel", false),
        ("qd/qmodel", "qmodel", false),
        ("qd/qwen3.7-plus", "qmodel", false),
    ] {
        let response = app
            .clone()
            .oneshot(chat_request(serde_json::json!({
                "model": model,
                "messages": [{"role": "user", "content": "hi"}]
            })))
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK, "{model}");
        assert_eq!(fake.last_model_key(), key, "{model}");
        assert_eq!(
            sent_body(&fake)["model_config"]["key"],
            serde_json::json!(key),
            "{model}"
        );
        assert_eq!(
            sent_body(&fake)["model_config"]["is_reasoning"],
            serde_json::json!(reasoning),
            "{model} asks with the settings of its own key"
        );
    }
}

#[tokio::test]
async fn an_allowlist_entry_under_one_name_serves_every_name() {
    const KEY: &str = "sr-fixture-key";

    let database = TestDatabase::new().unwrap();
    connect_qoder(&database).await;
    let fake = FakeQoderUpstream::start().await;
    fake.with(|state| state.model_catalog = qoder_catalog_body());

    let mut record = api_key_record("key_1");
    record.allowed_models = Some(vec![String::from("qd/qwen3.7-max")]);
    let app = create_router(qoder_state(
        database.connect().await.expect("temporary database"),
        security_state(false, vec![(String::from(KEY), record)], vec![]),
        &fake,
    ));

    for (model, expected) in [
        ("qd/qwen3.7-max", StatusCode::OK),
        ("qd/qmodel_latest", StatusCode::OK),
        ("qd/auto", StatusCode::FORBIDDEN),
    ] {
        let response = app
            .clone()
            .oneshot(with_remote_client(
                json_request_with_headers(
                    "POST",
                    "/v1/chat/completions",
                    serde_json::json!({
                        "model": model,
                        "messages": [{"role": "user", "content": "hi"}]
                    }),
                    &[("x-api-key", KEY)],
                ),
                "203.0.113.7",
            ))
            .await
            .unwrap();

        assert_eq!(response.status(), expected, "{model}");
    }

    assert_eq!(
        fake.chat_requests(),
        2,
        "only the two names of the allowed model reached the upstream"
    );
}

#[tokio::test]
async fn no_qoder_model_is_advertised_before_a_fetch_lands() {
    let database = TestDatabase::new().unwrap();
    connect_qoder(&database).await;
    let fake = FakeQoderUpstream::start().await;
    fake.with(|state| state.model_catalog = serde_json::json!({ "chat": [] }));
    let app = app(&database, &fake).await;

    let ids = catalog_ids(app.oneshot(models_request()).await.unwrap()).await;
    let qd_count = ids.iter().filter(|id| id.starts_with("qd/")).count();

    assert_eq!(qd_count, 0, "{ids:?}");
    assert_eq!(
        ids.len(),
        OPENCODE_ZEN_MODELS.len(),
        "the other driver must still be there, or this passes for the wrong reason"
    );
}

#[tokio::test]
async fn the_messages_route_answers_from_the_qoder_stream() {
    let database = TestDatabase::new().unwrap();
    connect_qoder(&database).await;
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
async fn the_live_catalog_replaces_the_empty_snapshot_and_stops_refreshing_within_the_ttl() {
    let database = TestDatabase::new().unwrap();
    connect_qoder(&database).await;
    let fake = FakeQoderUpstream::start().await;
    fake.with(|state| {
        state.model_catalog = serde_json::json!({
            "chat": [
                {"key": "brand-new-model", "enable": true, "display_name": "Nova Max",
                 "is_reasoning": false, "max_output_tokens": 4096},
                {"key": "turned-off", "enable": false}
            ]
        })
    });

    let ProviderAdapter::Qoder(executor) = qoder_executor(
        Some(database.connect().await.expect("temporary database")),
        &fake,
    ) else {
        unreachable!("the registry holds the qoder adapter");
    };

    assert!(
        executor.models().is_empty(),
        "nothing is advertised before the first fetch"
    );

    executor.refresh_catalog().await.expect("catalog refreshes");

    assert_eq!(fake.model_list_requests(), 1);
    assert_eq!(
        fake.model_list_body_length(),
        "0",
        "a signed GET carries an empty body"
    );
    assert_eq!(fake.model_list_sig_path(), "/api/v2/model/list");
    assert_eq!(
        executor.models(),
        vec!["brand-new-model", "nova-max"],
        "the key is advertised beside the name upstream gave it"
    );
    assert!(
        !executor.models().contains(&"turned-off".to_owned()),
        "disabled entries are dropped"
    );

    // Filled and fresh: the due check is synchronous, so nothing is spawned.
    executor.maybe_refresh(false).await;
    assert_eq!(
        fake.model_list_requests(),
        1,
        "a fresh catalog is not fetched again inside the ttl"
    );

    // Forced on a filled snapshot still runs off the request path, and the
    // replace re-derives the names from the rows that came in.
    fake.with(|state| {
        state.model_catalog = serde_json::json!({
            "chat": [{"key": "brand-new-model", "enable": true, "display_name": "Nova Plus"}]
        })
    });
    executor.maybe_refresh(true).await;
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    assert_eq!(
        fake.model_list_requests(),
        2,
        "a forced refresh goes through"
    );
    assert_eq!(
        executor.models(),
        vec!["brand-new-model", "nova-plus"],
        "a replaced snapshot drops the name the upstream stopped using"
    );
}

#[tokio::test]
async fn a_failed_fetch_keeps_the_last_good_snapshot() {
    let database = TestDatabase::new().unwrap();
    connect_qoder(&database).await;
    let fake = FakeQoderUpstream::start().await;
    fake.with(|state| state.model_catalog = qoder_catalog_body());

    let ProviderAdapter::Qoder(executor) = qoder_executor(
        Some(database.connect().await.expect("temporary database")),
        &fake,
    ) else {
        unreachable!("the registry holds the qoder adapter");
    };

    executor.refresh_catalog().await.expect("first fetch lands");
    let previous = executor.models();
    assert_eq!(previous.len(), FAKE_QODER_ADVERTISED.len());

    fake.with(|state| state.model_catalog = serde_json::json!({"error": "no catalog"}));
    executor.refresh_catalog().await.expect("nothing to parse");

    assert_eq!(
        executor.models(),
        previous,
        "a failed fetch must not empty a snapshot that already landed"
    );
}

#[tokio::test]
async fn a_fetch_that_never_succeeded_leaves_no_models() {
    let database = TestDatabase::new().unwrap();
    connect_qoder(&database).await;
    let fake = FakeQoderUpstream::start().await;
    fake.with(|state| state.model_catalog = serde_json::json!({"error": "no catalog"}));

    let ProviderAdapter::Qoder(executor) = qoder_executor(
        Some(database.connect().await.expect("temporary database")),
        &fake,
    ) else {
        unreachable!("the registry holds the qoder adapter");
    };

    executor.refresh_catalog().await.expect("nothing to parse");

    assert!(
        executor.models().is_empty(),
        "an id upstream never confirmed is never advertised"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn thundering_herd_shares_one_fetch() {
    let database = TestDatabase::new().unwrap();
    connect_qoder(&database).await;
    let fake = FakeQoderUpstream::start().await;
    fake.with(|state| {
        state.model_catalog = qoder_catalog_body();
        state.slow_model_list = true;
    });
    let app = app(&database, &fake).await;

    let responses = join_all(
        (0..8)
            .map(|_| {
                let app = app.clone();
                async move { app.oneshot(models_request()).await.unwrap() }
            })
            .collect::<Vec<_>>(),
    )
    .await;

    let bodies = join_all(responses.into_iter().map(catalog_ids).collect::<Vec<_>>()).await;
    for ids in &bodies {
        assert_eq!(
            ids.iter().filter(|id| id.starts_with("qd/")).count(),
            FAKE_QODER_ADVERTISED.len(),
            "every concurrent request must end up with the filled catalog: {ids:?}"
        );
    }
    assert_eq!(
        fake.model_list_requests(),
        1,
        "the waiters must share the one fetch instead of each starting a GET"
    );
}

#[tokio::test]
async fn a_chat_with_an_empty_snapshot_fetches_the_real_config_first() {
    let database = TestDatabase::new().unwrap();
    connect_qoder(&database).await;
    let fake = FakeQoderUpstream::start().await;
    fake.with(|state| state.model_catalog = qoder_catalog_body());
    let app = app(&database, &fake).await;
    let request = chat_request(serde_json::json!({
        "model": "qd/qwen3.7-max",
        "messages": [{"role": "user", "content": "hi"}],
        "stream": false
    }));

    let response = app.oneshot(request).await.unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        fake.model_list_requests(),
        1,
        "the chat filled the catalog before signing"
    );

    let sent = sent_body(&fake);
    assert_eq!(
        sent["model_config"]["key"], "qmodel_latest",
        "the alias landed on the advertised key"
    );
    assert_eq!(sent["model_config"]["max_output_tokens"], 4096);
    assert_eq!(sent["model_config"]["is_reasoning"], true);
    assert_eq!(
        sent["parameters"]["max_tokens"], 4096,
        "the upstream row is used, not the fallback"
    );
}

#[tokio::test]
async fn an_unknown_key_still_chats_with_the_default_config() {
    let database = TestDatabase::new().unwrap();
    connect_qoder(&database).await;
    let fake = FakeQoderUpstream::start().await;
    fake.with(|state| state.model_catalog = qoder_catalog_body());
    let app = app(&database, &fake).await;
    let request = chat_request(serde_json::json!({
        "model": "qd/not-in-the-catalog",
        "messages": [{"role": "user", "content": "hi"}],
        "stream": false
    }));

    let response = app.oneshot(request).await.unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let sent = sent_body(&fake);
    assert_eq!(sent["model_config"]["key"], "not-in-the-catalog");
    assert_eq!(sent["model_config"]["max_output_tokens"], 32_768);
    assert_eq!(sent["model_config"]["is_reasoning"], false);
}

#[tokio::test]
async fn a_bare_model_id_resolves_once_the_catalog_advertises_it() {
    let database = TestDatabase::new().unwrap();
    connect_qoder(&database).await;
    let fake = FakeQoderUpstream::start().await;
    fake.with(|state| state.model_catalog = qoder_catalog_body());
    let providers = qoder_registry(
        Some(database.connect().await.expect("temporary database")),
        &fake,
    );

    assert!(
        providers.resolve("auto").is_none(),
        "a bare id needs an advertised model to resolve"
    );

    let ProviderAdapter::Qoder(executor) = providers
        .resolve("qd/auto")
        .expect("a prefix resolves without a catalog entry")
        .adapter
    else {
        unreachable!("the registry holds the qoder adapter");
    };
    executor.refresh_catalog().await.expect("catalog refreshes");

    assert_eq!(
        providers.resolve("auto").expect("bare id").adapter.id(),
        "qoder",
        "the fetch filled the very catalog the registry serves from"
    );
}
