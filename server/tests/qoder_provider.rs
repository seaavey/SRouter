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
use srouter_server::features::gateway::token_saver::TERSE_DIRECTIVE;
use srouter_server::features::providers::OPENCODE_ZEN_MODELS;
use srouter_server::features::providers::qoder::{self, QoderExecutor};
use srouter_server::infrastructure::database::AppDatabase;
use support::{
    FAKE_QODER_ADVERTISED, FakeQoderUpstream, TestDatabase, api_key_record, connect_qoder,
    connect_second_qoder, json_request, json_request_with_headers, qoder_catalog_body,
    qoder_registry, qoder_state, security_state, with_loopback_client, with_remote_client,
};
use tower::ServiceExt;

async fn app(database: &TestDatabase, fake: &FakeQoderUpstream) -> Router {
    create_router(qoder_state(
        database.connect().await.expect("temporary database"),
        srouter_server::SecurityState::unconfigured(),
        fake,
    ))
}

const SESSION_TOKEN: &str = "test-session-token";

/// The same app with a fixture admin session and API-key auth switched off, so
/// one router can serve both loopback chats and an admin-only write.
async fn admin_app(database: &TestDatabase, fake: &FakeQoderUpstream) -> Router {
    let security = support::security_state(
        false,
        vec![],
        vec![srouter_server::features::admin_auth::hash_session_token(
            SESSION_TOKEN,
        )],
    );

    create_router(qoder_state(
        database.connect().await.expect("temporary database"),
        security,
        fake,
    ))
}

/// A mutation carrying the fixture admin-session cookie, the way the providers
/// suite drives the admin-guarded routes.
fn admin_request(method: &str, uri: &str, body: serde_json::Value) -> Request<Body> {
    let cookie = format!("srouter_admin_session={SESSION_TOKEN}");

    json_request_with_headers(method, uri, body, &[("cookie", cookie.as_str())])
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

/// The JSON body of a response.
async fn json_body(response: Response) -> serde_json::Value {
    let bytes = to_bytes(response.into_body(), 65_536).await.unwrap();

    serde_json::from_slice(&bytes).expect("json body")
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

/// The qoder driver out of a registry that can read `database`.
fn qoder_executor(database: Option<AppDatabase>, fake: &FakeQoderUpstream) -> QoderExecutor {
    let providers = qoder_registry(database, fake);
    let adapter = providers.resolve("qd/auto").expect("resolves").adapter;

    adapter
        .downcast_ref::<QoderExecutor>()
        .expect("the registry must hold the qoder adapter")
        .clone()
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

    assert_eq!(sent["system"], format!("be brief\n\n{TERSE_DIRECTIVE}"));
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

    let executor = qoder_executor(
        Some(database.connect().await.expect("temporary database")),
        &fake,
    );

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
    // The forced refresh runs off the request path, and the upstream request
    // counter ticks before the executor rewrites its snapshot, so wait for the
    // catalog a client would actually read instead of racing the write.
    let expected = vec!["brand-new-model".to_owned(), "nova-plus".to_owned()];
    for _ in 0..200 {
        if executor.models() == expected {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    assert_eq!(
        fake.model_list_requests(),
        2,
        "a forced refresh goes through"
    );
    assert_eq!(
        executor.models(),
        expected,
        "a replaced snapshot drops the name the upstream stopped using"
    );
}

#[tokio::test]
async fn removing_a_qoder_connection_clears_its_registry_catalog() {
    let database = TestDatabase::new().unwrap();
    connect_qoder(&database).await;
    let fake = FakeQoderUpstream::start().await;
    fake.with(|state| state.model_catalog = qoder_catalog_body());
    let app = app(&database, &fake).await;
    let before = catalog_ids(app.clone().oneshot(models_request()).await.unwrap()).await;
    assert!(before.iter().any(|id| id == "qd/qmodel"));

    let app_database = database.connect().await.expect("temporary database");
    sqlx::query("DELETE FROM providers WHERE id = 'qoder_1'")
        .execute(&app_database.sqlite_pool().unwrap())
        .await
        .unwrap();

    let after = catalog_ids(
        app.oneshot(with_loopback_client(
            Request::builder()
                .method(Method::GET)
                .uri("/v1/models?force=true")
                .body(Body::empty())
                .unwrap(),
        ))
        .await
        .unwrap(),
    )
    .await;

    assert!(after.iter().all(|id| !id.starts_with("qd/")));
    assert_eq!(fake.model_list_requests(), 1);
}

#[tokio::test]
async fn a_failed_fetch_keeps_the_last_good_snapshot() {
    let database = TestDatabase::new().unwrap();
    connect_qoder(&database).await;
    let fake = FakeQoderUpstream::start().await;
    fake.with(|state| state.model_catalog = qoder_catalog_body());

    let executor = qoder_executor(
        Some(database.connect().await.expect("temporary database")),
        &fake,
    );

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

    let executor = qoder_executor(
        Some(database.connect().await.expect("temporary database")),
        &fake,
    );

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

    let executor = providers
        .resolve("qd/auto")
        .expect("a prefix resolves without a catalog entry")
        .adapter
        .downcast_ref::<QoderExecutor>()
        .expect("the registry holds the qoder adapter")
        .clone();
    executor.refresh_catalog().await.expect("catalog refreshes");

    assert_eq!(
        providers.resolve("auto").expect("bare id").adapter.id(),
        "qoder",
        "the fetch filled the very catalog the registry serves from"
    );
}

/// Two connected accounts with the first chat answered `429`: the same request
/// must succeed through the second account, and the rate-limited one must be
/// skipped by the next request until its cooldown lapses.
#[tokio::test]
async fn a_rate_limited_account_fails_over_to_the_next_one() {
    let database = TestDatabase::new().unwrap();
    connect_qoder(&database).await;
    connect_second_qoder(&database).await;
    let fake = FakeQoderUpstream::start().await;
    fake.with(|state| state.rate_limited_chats = 1);
    let app = app(&database, &fake).await;

    let response = app
        .clone()
        .oneshot(chat_request(serde_json::json!({
            "model": "qd/auto",
            "messages": [{ "role": "user", "content": "hi" }]
        })))
        .await
        .unwrap();

    assert_eq!(
        response.status(),
        StatusCode::OK,
        "the client never sees the upstream 429"
    );
    let _ = body_text(response).await;

    // The COSY signature makes the header differ per request even for one
    // account, so the decoded `session_id` is what names the account.
    let sessions = fake.with(|state| state.chat_bodies.clone());
    assert_eq!(sessions.len(), 2, "the request was tried twice");
    let first = session_id(&sessions[0]);
    let second = session_id(&sessions[1]);
    assert_ne!(first, second, "the second attempt used a different account");

    // The rate-limited account stays cooling, so the next request goes straight
    // to the surviving one.
    let response = app
        .oneshot(chat_request(serde_json::json!({
            "model": "qd/auto",
            "messages": [{ "role": "user", "content": "again" }]
        })))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    let sessions = fake.with(|state| state.chat_bodies.clone());
    assert_eq!(sessions.len(), 3, "the cooling account was skipped");
    assert_eq!(
        session_id(&sessions[2]),
        second,
        "the surviving account served the follow-up"
    );
}

/// With every account rate limited the request surfaces the upstream error
/// instead of looping forever.
#[tokio::test]
async fn an_all_rate_limited_provider_reports_the_last_error() {
    let database = TestDatabase::new().unwrap();
    connect_qoder(&database).await;
    connect_second_qoder(&database).await;
    let fake = FakeQoderUpstream::start().await;
    fake.with(|state| state.rate_limited_chats = 4);
    let app = app(&database, &fake).await;

    let response = app
        .oneshot(chat_request(serde_json::json!({
            "model": "qd/auto",
            "messages": [{ "role": "user", "content": "hi" }]
        })))
        .await
        .unwrap();

    // A buffered request surfaces the provider failure as the gateway's error
    // envelope, so the upstream 429 is what the client reads.
    assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
    let body = body_text(response).await;
    assert!(
        body.contains("429"),
        "the upstream rate limit is reported, got: {body}"
    );
    assert_eq!(
        fake.chat_requests(),
        2,
        "the loop is bounded by the account count, not unbounded"
    );
}

/// Two connected accounts: with the flag on consecutive requests reach both
/// accounts and wrap, with it off every request is pinned to one account. Which
/// one of the two a disabled flag picks is pinned by the rotator unit tests
/// (`rotation.rs::a_disabled_flag_pins_the_newest_ready_connection`); here the
/// flag itself must reach the executor.
#[tokio::test]
async fn rotation_reaches_each_account_and_the_flag_pins_one() {
    let database = TestDatabase::new().unwrap();
    connect_qoder(&database).await;
    connect_second_qoder(&database).await;
    let fake = FakeQoderUpstream::start().await;
    let app = admin_app(&database, &fake).await;

    let mut rotated = Vec::new();
    for _ in 0..4 {
        rotated.push(chat_one(&app, &fake).await);
    }

    let accounts: Vec<String> = rotated.iter().map(|body| session_id(body)).collect();
    assert_ne!(accounts[0], accounts[1], "rotation alternates accounts");
    assert_eq!(accounts[0], accounts[2], "the walk wraps around");
    assert_eq!(accounts[1], accounts[3]);

    let disable = admin_request(
        "PATCH",
        "/v1/providers/qoder/round-robin",
        serde_json::json!({ "enabled": false }),
    );
    let response = app.clone().oneshot(disable).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = json_body(response).await;
    assert_eq!(body["roundRobin"], serde_json::json!(false));

    let mut pinned: Option<String> = None;
    for _ in 0..3 {
        let body = chat_one(&app, &fake).await;
        let session = session_id(&body);
        match &pinned {
            None => pinned = Some(session),
            Some(expected) => assert_eq!(
                &session, expected,
                "with rotation off every request must use the same account"
            ),
        }
    }
    let pinned = pinned.expect("three requests ran");
    assert!(
        accounts.contains(&pinned),
        "the pinned account is one of the two connected ones"
    );

    // The flag is live rather than sticky: turning it back on resumes rotation.
    let enable = admin_request(
        "PATCH",
        "/v1/providers/qoder/round-robin",
        serde_json::json!({ "enabled": true }),
    );
    let response = app.clone().oneshot(enable).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let first = session_id(&chat_one(&app, &fake).await);
    let second = session_id(&chat_one(&app, &fake).await);
    assert_ne!(first, second, "rotation resumes once the flag is back on");
}

/// One chat round trip, returning the signed body the fake upstream received.
async fn chat_one(app: &Router, fake: &FakeQoderUpstream) -> String {
    let response = app
        .clone()
        .oneshot(chat_request(serde_json::json!({
            "model": "qd/auto",
            "messages": [{ "role": "user", "content": "hi" }]
        })))
        .await
        .expect("request");
    assert_eq!(response.status(), StatusCode::OK);
    let _ = body_text(response).await;

    fake.with(|state| state.chat_bodies.last().cloned().expect("one chat body"))
}

/// The account name inside a signed chat body. The COSY `session_id` is derived
/// from the account's `user_id`, so it names the connection without exposing a
/// token (and unlike the `Authorization` header it does not change per request,
/// because every request gets its own signature).
fn session_id(encoded_body: &str) -> String {
    let decoded = qoder::cosy::decode_body(encoded_body).expect("body decodes");
    let body: serde_json::Value = serde_json::from_slice(&decoded).expect("body is json");

    body["session_id"].as_str().expect("session id").to_owned()
}
