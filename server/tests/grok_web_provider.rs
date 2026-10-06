//! HTTP-level checks for the grok-web provider against a local fake: the
//! `x-userid` page probe and the `session.create` WebSocket protocol.

mod support;

use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode, Version, header},
};
use srouter_server::SecurityState;
use srouter_server::app::create_router;
use srouter_server::features::admin_auth::hash_session_token;
use srouter_server::features::gateway::token_saver::TERSE_DIRECTIVE;
use srouter_server::infrastructure::database::providers::{
    GrokWebConnectionWrite, load_grok_web_credentials, upsert_grok_web_connection,
};
use support::{
    FakeGrokUpstream, TestDatabase, connect_grok_web, grok_web_registry, grok_web_state,
    json_request_with_headers, sqlx_security_state, test_config, with_loopback_client,
};
use tower::ServiceExt;

const SESSION_TOKEN: &str = "test-session-token";

async fn app(database: &TestDatabase, fake: &FakeGrokUpstream) -> Router {
    let database = database.connect().await.expect("temporary database");
    let state = srouter_server::AppState::with_security(
        test_config(),
        grok_web_registry(Some(database.clone()), fake),
        SecurityState::unconfigured(),
    )
    .with_database(database);
    create_router(state)
}

async fn connect_app(database: &TestDatabase, fake: &FakeGrokUpstream) -> Router {
    let security = sqlx_security_state(database, vec![hash_session_token(SESSION_TOKEN)]).await;
    let database = database.connect().await.expect("temporary database");
    create_router(grok_web_state(database, security, fake))
}

fn chat_request(body: serde_json::Value) -> Request<Body> {
    with_loopback_client(
        Request::builder()
            .method("POST")
            .uri("/v1/chat/completions")
            .version(Version::HTTP_11)
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(serde_json::to_vec(&body).expect("request JSON")))
            .expect("request"),
    )
}

fn chat_body(model: &str, stream: bool) -> serde_json::Value {
    serde_json::json!({
        "model": model,
        "messages": [{ "role": "user", "content": "Hello" }],
        "max_tokens": 1024,
        "stream": stream
    })
}

async fn text_body(response: axum::response::Response) -> String {
    let bytes = to_bytes(response.into_body(), 65_536)
        .await
        .expect("response body");
    String::from_utf8(bytes.to_vec()).expect("response text")
}

async fn json_body(response: axum::response::Response) -> serde_json::Value {
    let bytes = to_bytes(response.into_body(), 65_536)
        .await
        .expect("response body");
    serde_json::from_slice(&bytes).expect("response JSON")
}

#[tokio::test]
async fn non_stream_chat_translates_the_ws_exchange_into_a_completion() {
    let database = TestDatabase::new().expect("temporary database");
    connect_grok_web(&database).await;
    let fake = FakeGrokUpstream::start().await;
    let app = app(&database, &fake).await;

    let response = app
        .oneshot(chat_request(chat_body("grok-web/fast", false)))
        .await
        .expect("gateway response");
    assert_eq!(response.status(), StatusCode::OK);
    let body = json_body(response).await;

    assert_eq!(body["object"], "chat.completion");
    assert_eq!(body["model"], "fast");
    assert_eq!(body["choices"][0]["message"]["content"], "Hello world");
    assert_eq!(body["choices"][0]["finish_reason"], "stop");
    assert!(body["usage"]["total_tokens"].as_i64().unwrap_or(0) > 0);

    // The protocol facts travel through: model, prompt, handshake headers.
    let (model, prompt, query, origin, cookie) = fake.with(|state| {
        (
            state.last_model.clone(),
            state.last_prompt.clone(),
            state.last_ws_query.clone(),
            state.last_ws_origin.clone(),
            state.last_ws_cookie.clone(),
        )
    });
    assert_eq!(model, "fast");
    assert_eq!(prompt, format!("system: {TERSE_DIRECTIVE}\n\nHello"));
    assert_eq!(query, "uid=fake-uid-1234");
    assert_eq!(origin, "https://grok.com");
    assert!(cookie.contains("sso=fixture-valid"));
    assert!(cookie.contains("x-userid=fake-uid-1234"));

    let capabilities = fake.with(|state| state.session_capabilities.clone());
    let capabilities = capabilities.expect("session.create recorded");
    assert_eq!(capabilities["use_chunk"], true);
    assert_eq!(capabilities["enable_image_generation"], false);
}

#[tokio::test]
async fn stream_chat_emits_role_chunks_and_a_single_done() {
    let database = TestDatabase::new().expect("temporary database");
    connect_grok_web(&database).await;
    let fake = FakeGrokUpstream::start().await;
    let app = app(&database, &fake).await;

    let response = app
        .oneshot(chat_request(chat_body("grok-web/fast", true)))
        .await
        .expect("gateway response");
    assert_eq!(response.status(), StatusCode::OK);
    let body = text_body(response).await;

    assert!(body.contains("\"role\":\"assistant\""));
    assert!(body.contains("Hello"));
    assert!(body.contains(" world"));
    assert!(body.contains("\"finish_reason\":\"stop\""));
    assert_eq!(body.matches("data: [DONE]").count(), 1);
}

#[tokio::test]
async fn history_and_system_messages_reach_the_upstream_flattened() {
    let database = TestDatabase::new().expect("temporary database");
    connect_grok_web(&database).await;
    let fake = FakeGrokUpstream::start().await;
    let app = app(&database, &fake).await;

    let body = serde_json::json!({
        "model": "grok-web/fast",
        "messages": [
            { "role": "system", "content": "Be brief." },
            { "role": "user", "content": "First" },
            { "role": "assistant", "content": "Sure" },
            { "role": "user", "content": "Second" }
        ],
        "stream": false
    });
    let response = app
        .oneshot(chat_request(body))
        .await
        .expect("gateway response");
    assert_eq!(response.status(), StatusCode::OK);

    let prompt = fake.with(|state| state.last_prompt.clone());
    assert_eq!(
        prompt,
        format!(
            "system: Be brief.\n\n{TERSE_DIRECTIVE}\n\nuser: First\n\nassistant: Sure\n\nSecond"
        )
    );
}

#[tokio::test]
async fn without_a_connection_chat_is_unauthorized() {
    let database = TestDatabase::new().expect("temporary database");
    let fake = FakeGrokUpstream::start().await;
    let app = app(&database, &fake).await;

    let response = app
        .oneshot(chat_request(chat_body("grok-web/fast", false)))
        .await
        .expect("gateway response");
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    let body = json_body(response).await;
    assert!(
        body["error"]["message"]
            .as_str()
            .unwrap_or_default()
            .contains("Grok Web connection"),
        "body: {body}"
    );
    assert_eq!(
        fake.page_requests(),
        0,
        "no probe without stored credentials"
    );
}

#[tokio::test]
async fn an_expired_cookie_fails_the_page_probe_with_401() {
    let database = TestDatabase::new().expect("temporary database");
    let app_database = database.connect().await.expect("temporary database");
    upsert_grok_web_connection(
        &app_database,
        &GrokWebConnectionWrite {
            id: "grok-web_stale".to_owned(),
            name: "Grok Web".to_owned(),
            sso: "expired".to_owned(),
        },
    )
    .await
    .expect("connection stored");

    let fake = FakeGrokUpstream::start().await;
    let app = app(&database, &fake).await;

    let response = app
        .oneshot(chat_request(chat_body("grok-web/fast", false)))
        .await
        .expect("gateway response");
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    let body = json_body(response).await;
    assert!(
        body["error"]["message"]
            .as_str()
            .unwrap_or_default()
            .contains("invalid or has expired"),
        "body: {body}"
    );
    assert_eq!(fake.ws_connections(), 0, "WebSocket never opened");
}

#[tokio::test]
async fn a_probe_without_the_uid_cookie_is_unauthorized() {
    let database = TestDatabase::new().expect("temporary database");
    connect_grok_web(&database).await;
    let fake = FakeGrokUpstream::start().await;
    fake.with(|state| state.page_mode = "no_uid".to_owned());
    let app = app(&database, &fake).await;

    let response = app
        .oneshot(chat_request(chat_body("grok-web/fast", false)))
        .await
        .expect("gateway response");
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    let body = json_body(response).await;
    assert!(
        body["error"]["message"]
            .as_str()
            .unwrap_or_default()
            .contains("did not issue a user id"),
        "body: {body}"
    );
}

#[tokio::test]
async fn a_failing_page_probe_surfaces_as_500() {
    let database = TestDatabase::new().expect("temporary database");
    connect_grok_web(&database).await;
    let fake = FakeGrokUpstream::start().await;
    fake.with(|state| state.page_mode = "error".to_owned());
    let app = app(&database, &fake).await;

    let response = app
        .oneshot(chat_request(chat_body("grok-web/fast", false)))
        .await
        .expect("gateway response");
    assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
    let body = json_body(response).await;
    assert!(
        body["error"]["message"]
            .as_str()
            .unwrap_or_default()
            .contains("session probe failed (503)"),
        "body: {body}"
    );
}

#[tokio::test]
async fn a_rejected_websocket_handshake_is_unauthorized() {
    let database = TestDatabase::new().expect("temporary database");
    connect_grok_web(&database).await;
    let fake = FakeGrokUpstream::start().await;
    fake.with(|state| state.ws_mode = "reject".to_owned());
    let app = app(&database, &fake).await;

    let response = app
        .oneshot(chat_request(chat_body("grok-web/fast", false)))
        .await
        .expect("gateway response");
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    let body = json_body(response).await;
    assert!(
        body["error"]["message"]
            .as_str()
            .unwrap_or_default()
            .contains("invalid or has expired"),
        "body: {body}"
    );
}

#[tokio::test]
async fn an_upstream_stream_error_maps_to_a_500_completion_error() {
    let database = TestDatabase::new().expect("temporary database");
    connect_grok_web(&database).await;
    let fake = FakeGrokUpstream::start().await;
    fake.with(|state| state.ws_mode = "stream_error".to_owned());
    let app = app(&database, &fake).await;

    let response = app
        .oneshot(chat_request(chat_body("grok-web/fast", false)))
        .await
        .expect("gateway response");
    assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
    let body = json_body(response).await;
    assert!(
        body["error"]["message"]
            .as_str()
            .unwrap_or_default()
            .contains("stream_error"),
        "body: {body}"
    );
}

#[tokio::test]
async fn a_stream_error_becomes_an_in_stream_error_event() {
    let database = TestDatabase::new().expect("temporary database");
    connect_grok_web(&database).await;
    let fake = FakeGrokUpstream::start().await;
    fake.with(|state| state.ws_mode = "stream_error".to_owned());
    let app = app(&database, &fake).await;

    let response = app
        .oneshot(chat_request(chat_body("grok-web/fast", true)))
        .await
        .expect("gateway response");
    assert_eq!(response.status(), StatusCode::OK);
    let body = text_body(response).await;
    assert!(body.contains("stream_error"), "body: {body}");
    assert!(!body.contains("[DONE]"), "stream must not claim success");
}

#[tokio::test]
async fn an_upstream_that_never_finishes_maps_to_an_error() {
    let database = TestDatabase::new().expect("temporary database");
    connect_grok_web(&database).await;
    let fake = FakeGrokUpstream::start().await;
    fake.with(|state| state.ws_mode = "no_done".to_owned());
    let app = app(&database, &fake).await;

    let response = app
        .oneshot(chat_request(chat_body("grok-web/fast", false)))
        .await
        .expect("gateway response");
    assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
    let body = json_body(response).await;
    assert!(
        body["error"]["message"]
            .as_str()
            .unwrap_or_default()
            .contains("ended before the response completed"),
        "body: {body}"
    );
}

#[tokio::test]
async fn an_unknown_model_is_rejected_before_any_upstream_contact() {
    let database = TestDatabase::new().expect("temporary database");
    let fake = FakeGrokUpstream::start().await;
    let app = app(&database, &fake).await;

    let response = app
        .oneshot(chat_request(chat_body("grok-web/grok-9", false)))
        .await
        .expect("gateway response");
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    assert_eq!(fake.page_requests(), 0);
    assert_eq!(fake.ws_connections(), 0);
}

#[tokio::test]
async fn empty_content_is_rejected_before_any_upstream_contact() {
    let database = TestDatabase::new().expect("temporary database");
    connect_grok_web(&database).await;
    let fake = FakeGrokUpstream::start().await;
    let app = app(&database, &fake).await;

    let body = serde_json::json!({
        "model": "grok-web/fast",
        "messages": [{ "role": "user", "content": "" }],
        "stream": false
    });
    let response = app
        .oneshot(chat_request(body))
        .await
        .expect("gateway response");
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let body = json_body(response).await;
    assert!(
        body["error"]["message"]
            .as_str()
            .unwrap_or_default()
            .contains("Empty query"),
        "body: {body}"
    );
    assert_eq!(fake.page_requests(), 0);
}

#[tokio::test]
async fn image_parts_are_rejected_before_any_upstream_contact() {
    let database = TestDatabase::new().expect("temporary database");
    connect_grok_web(&database).await;
    let fake = FakeGrokUpstream::start().await;
    let app = app(&database, &fake).await;

    let body = serde_json::json!({
        "model": "grok-web/fast",
        "messages": [{
            "role": "user",
            "content": [
                { "type": "text", "text": "look" },
                { "type": "image_url", "image_url": { "url": "data:image/png;base64,AAAA" } }
            ]
        }],
        "stream": false
    });
    let response = app
        .oneshot(chat_request(body))
        .await
        .expect("gateway response");
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let body = json_body(response).await;
    assert!(
        body["error"]["message"]
            .as_str()
            .unwrap_or_default()
            .contains("text content only"),
        "body: {body}"
    );
    assert_eq!(fake.page_requests(), 0);
}

#[tokio::test]
async fn models_are_advertised_only_while_a_connection_exists() {
    let fake = FakeGrokUpstream::start().await;

    // No connection: the provider contributes nothing to the catalog.
    let database = TestDatabase::new().expect("temporary database");
    let router = app(&database, &fake).await;
    let cookie = format!("srouter_admin_session={SESSION_TOKEN}");
    let response = router
        .oneshot(with_loopback_client(
            Request::builder()
                .method("GET")
                .uri("/v1/models")
                .header("cookie", &cookie)
                .body(Body::empty())
                .expect("request"),
        ))
        .await
        .expect("gateway response");
    assert_eq!(response.status(), StatusCode::OK);
    let body = json_body(response).await;
    let ids: Vec<&str> = body["data"]
        .as_array()
        .expect("model list")
        .iter()
        .filter_map(|entry| entry["id"].as_str())
        .collect();
    assert!(
        !ids.iter().any(|id| id.starts_with("grok-web/")),
        "unexpected grok models: {ids:?}"
    );

    // With a connection the static menu appears under the alias prefix.
    connect_grok_web(&database).await;
    let router = app(&database, &fake).await;
    let cookie = format!("srouter_admin_session={SESSION_TOKEN}");
    let response = router
        .oneshot(with_loopback_client(
            Request::builder()
                .method("GET")
                .uri("/v1/models")
                .header("cookie", &cookie)
                .body(Body::empty())
                .expect("request"),
        ))
        .await
        .expect("gateway response");
    assert_eq!(response.status(), StatusCode::OK);
    let body = json_body(response).await;
    let ids: Vec<&str> = body["data"]
        .as_array()
        .expect("model list")
        .iter()
        .filter_map(|entry| entry["id"].as_str())
        .collect();
    for expected in [
        "grok-web/fast",
        "grok-web/build",
        "grok-web/auto",
        "grok-web/expert",
        "grok-web/heavy",
    ] {
        assert!(ids.contains(&expected), "missing {expected} in {ids:?}");
    }

    let db = database.connect().await.expect("temporary database");
    sqlx::query("DELETE FROM providers WHERE provider_id = 'grok-web'")
        .execute(&db.sqlite_pool().unwrap())
        .await
        .unwrap();
    let router = app(&database, &fake).await;
    let response = router
        .oneshot(with_loopback_client(
            Request::builder()
                .method("GET")
                .uri("/v1/models")
                .header("cookie", &cookie)
                .body(Body::empty())
                .expect("models request"),
        ))
        .await
        .expect("models response");
    let ids: Vec<String> = json_body(response).await["data"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|model| model["id"].as_str().map(str::to_owned))
        .collect();
    assert!(ids.iter().all(|id| !id.starts_with("grok-web/")));
}

#[tokio::test]
async fn connect_stores_a_cookie_that_the_probe_accepts() {
    let database = TestDatabase::new().expect("temporary database");
    let fake = FakeGrokUpstream::start().await;
    let app = connect_app(&database, &fake).await;

    let cookie = format!("srouter_admin_session={SESSION_TOKEN}");
    let response = app
        .clone()
        .oneshot(json_request_with_headers(
            "POST",
            "/v1/auth/grok-web/connect",
            serde_json::json!({ "cookie": "sso=fixture-valid" }),
            &[("cookie", &cookie)],
        ))
        .await
        .expect("gateway response");
    assert_eq!(response.status(), StatusCode::CREATED);
    let body = json_body(response).await;
    assert_eq!(body["provider_id"], "grok-web");
    assert_eq!(body["category"], "api_key");
    assert_eq!(body["enabled"], true);
    assert_eq!(fake.page_requests(), 1);
    assert!(fake.with(|state| state.last_page_cookie.contains("sso=fixture-valid")));

    let app_database = database.connect().await.expect("temporary database");
    let stored = load_grok_web_credentials(&app_database)
        .await
        .expect("credentials read")
        .into_iter()
        .next()
        .expect("connection stored");
    assert_eq!(stored.sso, "fixture-valid", "sso= prefix must be stripped");
}

/// Connect request builder for the non-JSON body shapes: raw text or a
/// multipart form.
fn connect_request(content_type: &str, body: &str, headers: &[(&str, &str)]) -> Request<Body> {
    let mut builder = Request::builder()
        .method("POST")
        .uri("/v1/auth/grok-web/connect")
        .header(header::CONTENT_TYPE, content_type);
    for (name, value) in headers {
        builder = builder.header(*name, *value);
    }

    builder.body(Body::from(body.to_owned())).expect("request")
}

#[tokio::test]
async fn connect_accepts_a_raw_text_cookie_line() {
    let database = TestDatabase::new().expect("temporary database");
    let fake = FakeGrokUpstream::start().await;
    let app = connect_app(&database, &fake).await;

    let cookie = format!("srouter_admin_session={SESSION_TOKEN}");
    let response = app
        .oneshot(connect_request(
            "text/plain",
            "sso=fixture-valid; sso_csrf=ignored",
            &[("cookie", &cookie)],
        ))
        .await
        .expect("gateway response");
    assert_eq!(response.status(), StatusCode::CREATED);

    let app_database = database.connect().await.expect("temporary database");
    let stored = load_grok_web_credentials(&app_database)
        .await
        .expect("credentials read")
        .into_iter()
        .next()
        .expect("connection stored");
    assert_eq!(stored.sso, "fixture-valid", "only the sso pair is stored");
    assert!(fake.with(|state| state.last_page_cookie.contains("sso=fixture-valid")));
}

#[tokio::test]
async fn connect_accepts_an_uploaded_cookie_file() {
    let database = TestDatabase::new().expect("temporary database");
    let fake = FakeGrokUpstream::start().await;
    let app = connect_app(&database, &fake).await;

    let boundary = "srouter-cookie-boundary";
    let body = format!(
        "--{boundary}\r\n\
         Content-Disposition: form-data; name=\"file\"; filename=\"cookies.txt\"\r\n\
         Content-Type: text/plain\r\n\
         \r\n\
         grok.com\tTRUE\t/\tTRUE\t1790000000\tsso\tfixture-valid\r\n\
         --{boundary}--\r\n"
    );
    let cookie = format!("srouter_admin_session={SESSION_TOKEN}");
    let content_type = format!("multipart/form-data; boundary={boundary}");
    let response = app
        .oneshot(connect_request(
            &content_type,
            &body,
            &[("cookie", &cookie)],
        ))
        .await
        .expect("gateway response");
    assert_eq!(response.status(), StatusCode::CREATED);

    let app_database = database.connect().await.expect("temporary database");
    let stored = load_grok_web_credentials(&app_database)
        .await
        .expect("credentials read")
        .into_iter()
        .next()
        .expect("connection stored");
    assert_eq!(stored.sso, "fixture-valid", "the cookies.txt row is parsed");
    assert!(fake.with(|state| state.last_page_cookie.contains("sso=fixture-valid")));
}

#[tokio::test]
async fn connect_rejects_a_multipart_form_without_a_cookie() {
    let database = TestDatabase::new().expect("temporary database");
    let fake = FakeGrokUpstream::start().await;
    let app = connect_app(&database, &fake).await;

    let boundary = "srouter-cookie-boundary";
    let body = format!(
        "--{boundary}\r\n\
         Content-Disposition: form-data; name=\"note\"\r\n\
         \r\n\
         no cookie here\r\n\
         --{boundary}--\r\n"
    );
    let cookie = format!("srouter_admin_session={SESSION_TOKEN}");
    let content_type = format!("multipart/form-data; boundary={boundary}");
    let response = app
        .oneshot(connect_request(
            &content_type,
            &body,
            &[("cookie", &cookie)],
        ))
        .await
        .expect("gateway response");
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert_eq!(fake.page_requests(), 0);

    let app_database = database.connect().await.expect("temporary database");
    assert!(
        load_grok_web_credentials(&app_database)
            .await
            .expect("credentials read")
            .is_empty(),
        "a form without a cookie must not be stored"
    );
}

#[tokio::test]
async fn connect_rejects_a_cookie_value_with_control_characters() {
    let database = TestDatabase::new().expect("temporary database");
    let fake = FakeGrokUpstream::start().await;
    let app = connect_app(&database, &fake).await;

    let cookie = format!("srouter_admin_session={SESSION_TOKEN}");
    let response = app
        .oneshot(connect_request(
            "text/plain",
            "sso=fixture\u{1}-valid",
            &[("cookie", &cookie)],
        ))
        .await
        .expect("gateway response");
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert_eq!(fake.page_requests(), 0, "validation runs before the probe");

    let app_database = database.connect().await.expect("temporary database");
    assert!(
        load_grok_web_credentials(&app_database)
            .await
            .expect("credentials read")
            .is_empty(),
        "a cookie value with control characters must not be stored"
    );
}

#[tokio::test]
async fn connect_rejects_an_oversized_cookie_value() {
    let database = TestDatabase::new().expect("temporary database");
    let fake = FakeGrokUpstream::start().await;
    let app = connect_app(&database, &fake).await;

    // Under the 64 KiB body limit but past the 8 KiB value cap, so this
    // exercises the value cap rather than the body cap.
    let body = format!("sso={}", "a".repeat(9_000));
    let cookie = format!("srouter_admin_session={SESSION_TOKEN}");
    let response = app
        .oneshot(connect_request("text/plain", &body, &[("cookie", &cookie)]))
        .await
        .expect("gateway response");
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert_eq!(fake.page_requests(), 0, "validation runs before the probe");

    let app_database = database.connect().await.expect("temporary database");
    assert!(
        load_grok_web_credentials(&app_database)
            .await
            .expect("credentials read")
            .is_empty(),
        "an oversized cookie value must not be stored"
    );
}

#[tokio::test]
async fn connect_rejects_a_cookie_the_probe_refuses() {
    let database = TestDatabase::new().expect("temporary database");
    let fake = FakeGrokUpstream::start().await;
    let app = connect_app(&database, &fake).await;

    let cookie = format!("srouter_admin_session={SESSION_TOKEN}");
    let response = app
        .oneshot(json_request_with_headers(
            "POST",
            "/v1/auth/grok-web/connect",
            serde_json::json!({ "cookie": "sso=expired" }),
            &[("cookie", &cookie)],
        ))
        .await
        .expect("gateway response");
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);

    let app_database = database.connect().await.expect("temporary database");
    assert!(
        load_grok_web_credentials(&app_database)
            .await
            .expect("credentials read")
            .is_empty(),
        "an invalid cookie must not be stored"
    );
}

#[tokio::test]
async fn connect_rejects_a_body_without_a_cookie() {
    let database = TestDatabase::new().expect("temporary database");
    let fake = FakeGrokUpstream::start().await;
    let app = connect_app(&database, &fake).await;

    let cookie = format!("srouter_admin_session={SESSION_TOKEN}");
    let response = app
        .oneshot(json_request_with_headers(
            "POST",
            "/v1/auth/grok-web/connect",
            serde_json::json!({}),
            &[("cookie", &cookie)],
        ))
        .await
        .expect("gateway response");
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert_eq!(fake.page_requests(), 0);
}

#[tokio::test]
async fn connect_requires_an_admin_session() {
    let database = TestDatabase::new().expect("temporary database");
    let fake = FakeGrokUpstream::start().await;
    let app = connect_app(&database, &fake).await;

    let response = app
        .oneshot(json_request_with_headers(
            "POST",
            "/v1/auth/grok-web/connect",
            serde_json::json!({ "cookie": "sso=fixture-valid" }),
            &[],
        ))
        .await
        .expect("gateway response");
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(fake.page_requests(), 0);
}

fn chat_body_with_tools(
    model: &str,
    stream: bool,
    tool_choice: serde_json::Value,
) -> serde_json::Value {
    serde_json::json!({
        "model": model,
        "messages": [{ "role": "user", "content": "Weather in Jakarta?" }],
        "tools": [{
            "type": "function",
            "function": {
                "name": "get_weather",
                "description": "Get current weather for a city",
                "parameters": {
                    "type": "object",
                    "properties": { "city": { "type": "string" } },
                    "required": ["city"]
                }
            }
        }],
        "tool_choice": tool_choice,
        "stream": stream
    })
}

#[tokio::test]
async fn non_stream_chat_emits_tool_calls_for_a_tool_envelope() {
    let database = TestDatabase::new().expect("temporary database");
    connect_grok_web(&database).await;
    let fake = FakeGrokUpstream::start().await;
    fake.with(|state| state.ws_mode = "tool_json".to_owned());
    let app = app(&database, &fake).await;

    let response = app
        .oneshot(chat_request(chat_body_with_tools(
            "grok-web/fast",
            false,
            serde_json::json!("auto"),
        )))
        .await
        .expect("gateway response");
    assert_eq!(response.status(), StatusCode::OK);
    let body = json_body(response).await;

    assert_eq!(body["choices"][0]["finish_reason"], "tool_calls");
    assert!(body["choices"][0]["message"]["content"].is_null());
    let call = &body["choices"][0]["message"]["tool_calls"][0];
    assert_eq!(call["type"], "function");
    assert_eq!(call["function"]["name"], "get_weather");
    assert_eq!(call["function"]["arguments"], r#"{"city":"Jakarta"}"#);
    assert!(
        call["id"].as_str().unwrap_or_default().starts_with("call_"),
        "call: {call}"
    );

    // The emulated contract reached the upstream prompt.
    let prompt = fake.with(|state| state.last_prompt.clone());
    assert!(prompt.contains("get_weather"), "prompt: {prompt}");
    assert!(prompt.contains("tool_calls"), "prompt: {prompt}");
}

#[tokio::test]
async fn stream_chat_emits_tool_calls_for_a_tool_envelope() {
    let database = TestDatabase::new().expect("temporary database");
    connect_grok_web(&database).await;
    let fake = FakeGrokUpstream::start().await;
    fake.with(|state| state.ws_mode = "tool_json".to_owned());
    let app = app(&database, &fake).await;

    let response = app
        .oneshot(chat_request(chat_body_with_tools(
            "grok-web/fast",
            true,
            serde_json::json!("auto"),
        )))
        .await
        .expect("gateway response");
    assert_eq!(response.status(), StatusCode::OK);
    let body = text_body(response).await;

    let frames: Vec<serde_json::Value> = body
        .lines()
        .filter_map(|line| line.strip_prefix("data: "))
        .filter(|data| *data != "[DONE]")
        .map(|data| serde_json::from_str(data).expect("frame json"))
        .collect();

    assert!(
        frames.iter().any(|frame| {
            frame["choices"][0]["delta"]["tool_calls"][0]["function"]["name"] == "get_weather"
        }),
        "a tool-call delta must be emitted: {body}"
    );
    assert!(
        frames
            .iter()
            .any(|frame| frame["choices"][0]["finish_reason"] == "tool_calls"),
        "the finish reason must be tool_calls: {body}"
    );
    assert!(
        !frames.iter().any(|frame| {
            frame["choices"][0]["delta"]["content"]
                .as_str()
                .is_some_and(|content| content.contains("tool_calls"))
        }),
        "the envelope must not leak as content: {body}"
    );
    assert_eq!(body.matches("data: [DONE]").count(), 1);
}

#[tokio::test]
async fn tool_choice_none_keeps_the_tool_contract_out_of_the_prompt() {
    let database = TestDatabase::new().expect("temporary database");
    connect_grok_web(&database).await;
    let fake = FakeGrokUpstream::start().await;
    let app = app(&database, &fake).await;

    let response = app
        .oneshot(chat_request(chat_body_with_tools(
            "grok-web/fast",
            false,
            serde_json::json!("none"),
        )))
        .await
        .expect("gateway response");
    assert_eq!(response.status(), StatusCode::OK);
    let body = json_body(response).await;

    assert_eq!(body["choices"][0]["finish_reason"], "stop");
    assert_eq!(body["choices"][0]["message"]["content"], "Hello world");

    let prompt = fake.with(|state| state.last_prompt.clone());
    assert!(
        !prompt.contains("get_weather"),
        "no tool contract without an active tool: {prompt}"
    );
}
