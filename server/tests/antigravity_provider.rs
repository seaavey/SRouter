//! Gateway tests for the `antigravity` provider: the gated static catalog, the
//! CloudCode IDE envelope, the Gemini SSE translation, the pro cascade, the
//! credits retry, and the lazy Google token refresh. The upstream is the fake
//! Antigravity host, so nothing here reaches the network.

mod support;

use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode, Version, header},
    response::Response,
};
use srouter_server::SecurityState;
use srouter_server::app::create_router;
use srouter_server::features::providers::antigravity::translate::is_valid_ide_request_id;
use srouter_server::infrastructure::database::providers::{
    AntigravityConnectionWrite, load_antigravity_credentials, upsert_antigravity_connection,
};
use support::{
    FakeAntigravityUpstream, TestDatabase, antigravity_state, connect_antigravity,
    with_loopback_client,
};
use tower::ServiceExt;

async fn app(database: &TestDatabase, fake: &FakeAntigravityUpstream) -> Router {
    create_router(antigravity_state(
        database.connect().await.expect("temporary database"),
        SecurityState::unconfigured(),
        fake,
    ))
}

fn post(uri: &str, body: serde_json::Value) -> Request<Body> {
    with_loopback_client(
        Request::builder()
            .method("POST")
            .uri(uri)
            .version(Version::HTTP_11)
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(serde_json::to_vec(&body).expect("request JSON")))
            .expect("request"),
    )
}

fn models_request() -> Request<Body> {
    with_loopback_client(
        Request::builder()
            .method("GET")
            .uri("/v1/models")
            .version(Version::HTTP_11)
            .body(Body::empty())
            .expect("models request"),
    )
}

fn chat_body(model: &str, stream: bool) -> serde_json::Value {
    serde_json::json!({
        "model": model,
        "messages": [{ "role": "user", "content": "Hello" }],
        "stream": stream
    })
}

async fn text_body(response: Response) -> String {
    let bytes = to_bytes(response.into_body(), 1_048_576)
        .await
        .expect("response body");

    String::from_utf8(bytes.to_vec()).expect("response text")
}

async fn json_body(response: Response) -> serde_json::Value {
    let bytes = to_bytes(response.into_body(), 1_048_576)
        .await
        .expect("response body");

    serde_json::from_slice(&bytes).expect("response JSON")
}

/// The `id` values a `/v1/models` body advertises.
async fn catalog_ids(response: Response) -> Vec<String> {
    json_body(response).await["data"]
        .as_array()
        .expect("model list")
        .iter()
        .filter_map(|entry| entry["id"].as_str().map(str::to_owned))
        .collect()
}

#[tokio::test]
async fn the_catalog_is_gated_on_the_connection() {
    let database = TestDatabase::new().expect("temporary database");
    let fake = FakeAntigravityUpstream::start().await;
    let app = app(&database, &fake).await;

    // No connection: no Antigravity ids, and a chat is refused before the network.
    let ids = catalog_ids(
        app.clone()
            .oneshot(models_request())
            .await
            .expect("models response"),
    )
    .await;
    assert!(
        !ids.iter().any(|id| id.starts_with("antigravity/")),
        "{ids:?}"
    );

    let refused = app
        .clone()
        .oneshot(post(
            "/v1/chat/completions",
            chat_body("antigravity/gemini-3.7-flash-high", false),
        ))
        .await
        .expect("gateway response");
    assert_eq!(refused.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(
        json_body(refused).await["error"]["message"],
        "No active Antigravity connection found. Connect the Antigravity account in the Providers tab."
    );
    assert_eq!(fake.chat_requests(), 0);

    // A connection flips the static 17-id catalog on.
    connect_antigravity(&database).await;
    let ids = catalog_ids(
        app.clone()
            .oneshot(models_request())
            .await
            .expect("models response"),
    )
    .await;
    let advertised: Vec<&String> = ids
        .iter()
        .filter(|id| id.starts_with("antigravity/"))
        .collect();
    assert_eq!(advertised.len(), 17, "{ids:?}");
    assert!(ids.contains(&"antigravity/gemini-3.7-flash-high".to_owned()));

    // Removing the connection flips it back off.
    let app_database = database.connect().await.expect("temporary database");
    sqlx::query("DELETE FROM providers WHERE id = 'antigravity_fixture'")
        .execute(app_database.sqlite_pool().unwrap())
        .await
        .expect("connection deleted");

    let ids = catalog_ids(
        app.oneshot(models_request())
            .await
            .expect("models response"),
    )
    .await;
    assert!(
        !ids.iter().any(|id| id.starts_with("antigravity/")),
        "{ids:?}"
    );
}

#[tokio::test]
async fn the_request_carries_the_envelope_headers_and_generation_config() {
    let database = TestDatabase::new().expect("temporary database");
    connect_antigravity(&database).await;
    let fake = FakeAntigravityUpstream::start().await;
    let app = app(&database, &fake).await;

    let response = app
        .oneshot(post(
            "/v1/chat/completions",
            serde_json::json!({
                "model": "antigravity/gemini-3.7-flash-high",
                "messages": [{ "role": "user", "content": "Hello" }],
                "max_tokens": 200000,
                "top_p": 0.5,
                "stream": false
            }),
        ))
        .await
        .expect("gateway response");
    assert_eq!(response.status(), StatusCode::OK);
    let _ = json_body(response).await;

    let envelope = fake.with(|state| state.last_chat_body.clone());
    assert_eq!(envelope["project"], "cloudcode-project-1");
    assert_eq!(envelope["model"], "gemini-3.7-flash-tiered");
    assert_eq!(envelope["userAgent"], "antigravity");
    assert_eq!(envelope["requestType"], "agent");
    assert!(envelope.get("enabledCreditTypes").is_none());
    let request_id = envelope["requestId"].as_str().expect("request id");
    assert!(is_valid_ide_request_id(request_id), "{request_id}");

    let config = &envelope["request"]["generationConfig"];
    assert_eq!(config["maxOutputTokens"], 65536, "clamped to the flash cap");
    assert_eq!(config["topK"], 40);
    assert_eq!(config["topP"], 0.5);

    assert_eq!(
        fake.with(|state| state.last_authorization.clone()),
        "Bearer ya29.fixture-access"
    );
    assert_eq!(
        fake.with(|state| state.last_user_agent.clone()),
        "antigravity/ide/2.1.1 darwin/arm64"
    );
    assert_eq!(
        fake.with(|state| state.last_goog_api_client.clone()),
        "gl-node/18.0.0 gd/1.0.0"
    );
    assert_eq!(fake.with(|state| state.last_chat_query.clone()), "alt=sse");

    // D5: the resolved project id is persisted, and the lookup runs once.
    assert_eq!(fake.code_assist_requests(), 1);
    assert_eq!(
        fake.with(|state| state.last_code_assist_authorization.clone()),
        "Bearer ya29.fixture-access"
    );
    let app_database = database.connect().await.expect("temporary database");
    let credentials = load_antigravity_credentials(&app_database)
        .await
        .expect("credentials read")
        .expect("a connection was stored");
    assert_eq!(
        credentials.project_id.as_deref(),
        Some("cloudcode-project-1")
    );
}

#[tokio::test]
async fn the_request_maps_tools_and_contents() {
    let database = TestDatabase::new().expect("temporary database");
    connect_antigravity(&database).await;
    let fake = FakeAntigravityUpstream::start().await;
    let app = app(&database, &fake).await;

    let response = app
        .oneshot(post(
            "/v1/chat/completions",
            serde_json::json!({
                "model": "antigravity/gemini-3.7-flash-high",
                "messages": [
                    { "role": "user", "content": "What is the weather in Tokyo?" },
                    {
                        "role": "assistant",
                        "content": null,
                        "tool_calls": [{
                            "id": "call_weather_1",
                            "type": "function",
                            "function": { "name": "get_weather", "arguments": "{\"location\":\"Tokyo\"}" }
                        }]
                    },
                    {
                        "role": "tool",
                        "tool_call_id": "call_weather_1",
                        "content": "{\"temperature\":\"22C\",\"condition\":\"Sunny\"}"
                    }
                ],
                "tools": [{
                    "type": "function",
                    "function": {
                        "name": "get_weather",
                        "description": "Get weather",
                        "parameters": {
                            "type": "object",
                            "additionalProperties": false,
                            "properties": { "location": { "type": "string", "format": "date-time" } },
                            "required": ["location"]
                        }
                    }
                }],
                "stream": false
            }),
        ))
        .await
        .expect("gateway response");
    assert_eq!(response.status(), StatusCode::OK);
    let _ = json_body(response).await;

    let envelope = fake.with(|state| state.last_chat_body.clone());
    let request = &envelope["request"];

    let declarations = request["tools"][0]["functionDeclarations"]
        .as_array()
        .expect("functionDeclarations");
    assert_eq!(declarations.len(), 1);
    assert_eq!(declarations[0]["name"], "get_weather");
    assert_eq!(declarations[0]["description"], "Get weather");
    assert!(
        declarations[0]["parameters"]
            .get("additionalProperties")
            .is_none(),
        "the schema cleanup drops additionalProperties"
    );
    assert!(
        declarations[0]["parameters"]["properties"]["location"]
            .get("format")
            .is_none(),
        "the schema cleanup drops format"
    );
    assert_eq!(
        request["toolConfig"],
        serde_json::json!({ "functionCallingConfig": { "mode": "VALIDATED" } })
    );

    let contents = request["contents"].as_array().expect("contents");
    assert_eq!(contents.len(), 3);
    assert_eq!(contents[0]["role"], "user");
    assert!(
        contents[0]["parts"]
            .as_array()
            .expect("user parts")
            .iter()
            .any(|part| part["text"] == "What is the weather in Tokyo?"),
        "{}",
        contents[0]
    );
    assert_eq!(contents[1]["role"], "model");
    assert_eq!(
        contents[1]["parts"][0]["functionCall"]["name"],
        "get_weather"
    );
    assert_eq!(
        contents[1]["parts"][0]["functionCall"]["args"],
        serde_json::json!({ "location": "Tokyo" })
    );
    assert_eq!(
        contents[1]["parts"][0]["thought_signature"],
        "skip_thought_signature_validator"
    );
    assert_eq!(contents[2]["role"], "user");
    assert_eq!(
        contents[2]["parts"][0]["functionResponse"]["name"],
        "get_weather"
    );
    assert_eq!(
        contents[2]["parts"][0]["functionResponse"]["response"],
        serde_json::json!({ "temperature": "22C", "condition": "Sunny" })
    );
}

#[tokio::test]
async fn the_stream_re_frames_gemini_frames_and_terminates_once() {
    let database = TestDatabase::new().expect("temporary database");
    connect_antigravity(&database).await;
    let fake = FakeAntigravityUpstream::start().await;
    let app = app(&database, &fake).await;

    let response = app
        .oneshot(post(
            "/v1/chat/completions",
            chat_body("antigravity/gemini-3.7-flash-high", true),
        ))
        .await
        .expect("gateway response");
    assert_eq!(response.status(), StatusCode::OK);
    let body = text_body(response).await;

    assert!(body.contains(r#""content":"Hello""#), "{body}");
    assert!(body.contains(r#""content":" world""#), "{body}");
    assert!(body.contains(r#""finish_reason":"stop""#), "{body}");
    assert_eq!(
        body.matches("data: [DONE]").count(),
        1,
        "exactly one terminator: {body}"
    );
}

#[tokio::test]
async fn the_non_stream_aggregates_content_finish_and_usage() {
    let database = TestDatabase::new().expect("temporary database");
    connect_antigravity(&database).await;
    let fake = FakeAntigravityUpstream::start().await;
    let app = app(&database, &fake).await;

    let response = app
        .oneshot(post(
            "/v1/chat/completions",
            chat_body("antigravity/gemini-3.7-flash-high", false),
        ))
        .await
        .expect("gateway response");
    assert_eq!(response.status(), StatusCode::OK);
    let body = json_body(response).await;

    assert_eq!(body["object"], "chat.completion");
    assert_eq!(body["model"], "gemini-3.7-flash-high");
    assert_eq!(body["choices"][0]["message"]["content"], "Hello world");
    assert_eq!(body["choices"][0]["finish_reason"], "stop");
    assert_eq!(body["usage"]["total_tokens"], 12);
}

#[tokio::test]
async fn a_400_walks_the_pro_cascade() {
    let database = TestDatabase::new().expect("temporary database");
    connect_antigravity(&database).await;
    let fake = FakeAntigravityUpstream::start().await;
    fake.with(|state| state.chat_mode = "cascade_400".to_owned());
    let app = app(&database, &fake).await;

    let response = app
        .oneshot(post(
            "/v1/chat/completions",
            chat_body("antigravity/gemini-3.1-pro-high", false),
        ))
        .await
        .expect("gateway response");
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        fake.with(|state| state.requested_models.clone()),
        vec![
            "gemini-pro-agent".to_owned(),
            "gemini-pro-agent".to_owned(),
            "gemini-3-pro".to_owned()
        ],
        "the Node double-parse re-sends gemini-pro-agent, then the chain ends on gemini-3-pro"
    );
}

#[tokio::test]
async fn a_429_gets_one_google_one_ai_retry() {
    let database = TestDatabase::new().expect("temporary database");
    connect_antigravity(&database).await;
    let fake = FakeAntigravityUpstream::start().await;
    fake.with(|state| state.chat_mode = "quota_429".to_owned());
    let app = app(&database, &fake).await;

    let response = app
        .oneshot(post(
            "/v1/chat/completions",
            chat_body("antigravity/gemini-3.7-flash-high", false),
        ))
        .await
        .expect("gateway response");
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(fake.chat_requests(), 2);
    assert_eq!(
        fake.with(|state| state.credit_types.clone()),
        vec![
            serde_json::Value::Null,
            serde_json::json!(["GOOGLE_ONE_AI"])
        ]
    );
}

#[tokio::test]
async fn expired_credentials_refresh_against_the_fake_and_persist() {
    let database = TestDatabase::new().expect("temporary database");
    let app_database = database.connect().await.expect("temporary database");
    upsert_antigravity_connection(
        &app_database,
        &AntigravityConnectionWrite {
            id: "antigravity_expired".to_owned(),
            name: "Expired".to_owned(),
            access_token: "ya29.stale".to_owned(),
            refresh_token: Some("1//old-refresh".to_owned()),
            expires_at: Some(srouter_server::clock::now_ms() - 1_000),
            project_id: Some("project-x".to_owned()),
        },
    )
    .await
    .expect("connection stored");

    let fake = FakeAntigravityUpstream::start().await;
    let app = app(&database, &fake).await;

    let response = app
        .oneshot(post(
            "/v1/chat/completions",
            chat_body("antigravity/gemini-3.7-flash-high", false),
        ))
        .await
        .expect("gateway response");
    assert_eq!(response.status(), StatusCode::OK);

    assert_eq!(fake.token_requests(), 1);
    let form = fake.with(|state| state.last_token_form.clone());
    assert!(form.contains("grant_type=refresh_token"), "{form}");
    assert!(form.contains("refresh_token=1%2F%2Fold-refresh"), "{form}");
    assert!(
        form.contains("client_secret="),
        "the refresh grant requires the embedded client secret too: {form}"
    );
    assert_eq!(
        fake.with(|state| state.last_authorization.clone()),
        "Bearer ya29.refreshed",
        "the request is signed with the rotated token"
    );

    let credentials = load_antigravity_credentials(&app_database)
        .await
        .expect("credentials read")
        .expect("the connection is still stored");
    assert_eq!(credentials.access_token, "ya29.refreshed");
    assert_eq!(
        credentials.refresh_token.as_deref(),
        Some("1//rotated-refresh")
    );
}

#[tokio::test]
async fn a_transient_project_lookup_uses_a_generated_fallback_without_persisting_it() {
    let database = TestDatabase::new().expect("temporary database");
    connect_antigravity(&database).await;
    let fake = FakeAntigravityUpstream::start().await;
    // An empty `cloudaicompanionProject` makes `loadCodeAssist` resolve nothing.
    fake.with(|state| state.project_id = String::new());
    let app = app(&database, &fake).await;

    let response = app
        .oneshot(post(
            "/v1/chat/completions",
            chat_body("antigravity/gemini-3.7-flash-high", false),
        ))
        .await
        .expect("gateway response");
    assert_eq!(response.status(), StatusCode::OK);

    assert!(fake.code_assist_requests() >= 1);
    let project = fake.with(|state| state.last_chat_body["project"].clone());
    let project = project.as_str().expect("the fallback project is a string");
    let parts: Vec<&str> = project.split('-').collect();
    assert_eq!(
        parts.len(),
        3,
        "the fallback keeps the {{adj}}-{{noun}}-{{hex}} shape: {project}"
    );
    assert!(!parts[0].is_empty(), "{project}");
    assert_eq!(parts[2].len(), 5, "{project}");

    let app_database = database.connect().await.expect("temporary database");
    let credentials = load_antigravity_credentials(&app_database)
        .await
        .expect("credentials read")
        .expect("the connection is still stored");
    assert_eq!(
        credentials.project_id, None,
        "a generated fallback must not be pinned to the connection"
    );
}
