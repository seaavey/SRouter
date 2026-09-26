//! Behavior tests for API-key model allowlists on the chat gateway. The empty
//! provider registry turns an allowed request into a `404`; only the fake
//! upstream case is expected to return `200`.

mod support;

use axum::{
    Router,
    body::to_bytes,
    http::{Request, StatusCode},
    response::Response,
};
use srouter_server::SecurityState;
use srouter_server::app::create_router;
use srouter_server::features::admin_auth::hash_session_token;
use srouter_server::features::api_keys::APIKeyRecord;
use support::{
    api_key_record, app_state_with_fake_upstream_and_security, empty_registry_state,
    json_request_with_headers, security_state, with_remote_client,
};
use tower::ServiceExt;

const KEY: &str = "sr-live-test";
const CHAT: &str = "/v1/chat/completions";
const REMOTE: &str = "203.0.113.7";

fn test_app(security: SecurityState) -> Router {
    create_router(empty_registry_state(security))
}

fn chat_body(model: &str) -> serde_json::Value {
    serde_json::json!({
        "model": model,
        "messages": [ { "role": "user", "content": "hi" } ]
    })
}

fn allowed(models: Option<Vec<&str>>) -> Vec<(String, APIKeyRecord)> {
    let mut record = api_key_record("key_1");
    record.allowed_models = models.map(|list| list.into_iter().map(str::to_owned).collect());

    vec![(KEY.to_owned(), record)]
}

fn keyed_request(model: &str) -> Request<axum::body::Body> {
    json_request_with_headers("POST", CHAT, chat_body(model), &[("x-api-key", KEY)])
}

async fn json_body(response: Response) -> serde_json::Value {
    let bytes = to_bytes(response.into_body(), 65_536).await.unwrap();

    serde_json::from_slice(&bytes).unwrap()
}

#[tokio::test]
async fn a_disallowed_model_returns_403_model_not_allowed() {
    let security = security_state(false, allowed(Some(vec!["gpt-4o"])), vec![]);
    let app = test_app(security);

    let response = app
        .oneshot(with_remote_client(keyed_request("does-not-exist"), REMOTE))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    let json = json_body(response).await;
    assert_eq!(json["error"]["type"], "permission_error");
    assert_eq!(json["error"]["code"], "model_not_allowed");
    assert_eq!(
        json["error"]["message"],
        "Model 'does-not-exist' is not allowed for this API key"
    );
}

#[tokio::test]
async fn an_allowed_model_reaches_the_provider() {
    let security = security_state(false, allowed(Some(vec!["space-bunny-free"])), vec![]);
    let (upstream, state) = app_state_with_fake_upstream_and_security(security).await;
    let app = create_router(state);

    let response = app
        .oneshot(with_remote_client(
            keyed_request("opencode_zen/space-bunny-free"),
            REMOTE,
        ))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let json = json_body(response).await;
    assert_eq!(
        json["choices"][0]["message"]["content"],
        "fake upstream reply"
    );
    drop(upstream);
}

#[tokio::test]
async fn an_admin_session_is_not_restricted() {
    let sessions = vec![hash_session_token("admin-token")];
    let security = security_state(true, allowed(Some(vec!["gpt-4o"])), sessions);
    let app = test_app(security);

    let response = app
        .oneshot(with_remote_client(
            json_request_with_headers(
                "POST",
                CHAT,
                chat_body("does-not-exist"),
                &[("cookie", "srouter_admin_session=admin-token")],
            ),
            REMOTE,
        ))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn an_unrestricted_key_is_not_restricted() {
    let app = test_app(security_state(false, allowed(None), vec![]));

    let response = app
        .oneshot(with_remote_client(keyed_request("does-not-exist"), REMOTE))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn invalid_json_fails_before_the_model_check() {
    let app = test_app(security_state(false, allowed(Some(vec!["gpt-4o"])), vec![]));
    let request = json_request_with_headers(
        "POST",
        CHAT,
        serde_json::json!({ "model": "does-not-exist" }),
        &[("x-api-key", KEY)],
    );

    let response = app
        .oneshot(with_remote_client(request, REMOTE))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let json = json_body(response).await;
    assert_eq!(json["error"]["code"], "invalid_type");
}
