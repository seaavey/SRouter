//! Behavior tests for the fixed-window rate limit wired into the gateway. The
//! empty provider registry turns an allowed request into a `404`, which is how
//! these tests observe "the request passed the limiter".

mod support;

use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode, header},
    response::Response,
};
use srouter_server::SecurityState;
use srouter_server::app::create_router;
use srouter_server::features::admin_auth::hash_session_token;
use srouter_server::features::api_keys::APIKeyRecord;
use support::{
    api_key_record, empty_registry_state, json_request, json_request_with_headers, security_state,
    with_loopback_client, with_remote_client,
};
use tower::ServiceExt;

const KEY: &str = "sr-live-test";
const CHAT: &str = "/v1/chat/completions";
const REMOTE: &str = "203.0.113.7";

fn test_app(security: SecurityState) -> Router {
    create_router(empty_registry_state(security))
}

fn chat_body() -> serde_json::Value {
    serde_json::json!({
        "model": "does-not-exist",
        "messages": [ { "role": "user", "content": "hi" } ]
    })
}

fn keyed(rate_limit: u32) -> Vec<(String, APIKeyRecord)> {
    let mut record = api_key_record("key_1");
    record.rate_limit = rate_limit;

    vec![(KEY.to_owned(), record)]
}

fn keyed_request(uri: &str) -> Request<Body> {
    json_request_with_headers("POST", uri, chat_body(), &[("x-api-key", KEY)])
}

/// Authenticated raw-body request; used to prove the limiter rejects before
/// the handler ever parses the JSON.
fn raw_keyed_json_request(uri: &str, body: &str) -> Request<Body> {
    Request::builder()
        .method("POST")
        .uri(uri)
        .header(header::CONTENT_TYPE, "application/json")
        .header("x-api-key", KEY)
        .body(Body::from(body.to_owned()))
        .expect("request")
}

async fn json_body(response: Response) -> serde_json::Value {
    let bytes = to_bytes(response.into_body(), 65_536).await.unwrap();

    serde_json::from_slice(&bytes).unwrap()
}

#[tokio::test]
async fn requests_beyond_the_key_limit_return_429_with_retry_after() {
    let app = test_app(security_state(false, keyed(1), vec![]));

    let passed = app
        .clone()
        .oneshot(with_remote_client(keyed_request(CHAT), REMOTE))
        .await
        .unwrap();
    assert_eq!(passed.status(), StatusCode::NOT_FOUND);

    let blocked = app
        .clone()
        .oneshot(with_remote_client(keyed_request(CHAT), REMOTE))
        .await
        .unwrap();

    assert_eq!(blocked.status(), StatusCode::TOO_MANY_REQUESTS);
    let retry_after: u64 = blocked.headers()[header::RETRY_AFTER]
        .to_str()
        .expect("retry-after")
        .parse()
        .expect("retry-after seconds");
    assert!(
        (1..=60).contains(&retry_after),
        "retry-after {retry_after} outside 1..=60"
    );

    let json = json_body(blocked).await;
    assert_eq!(json["error"]["type"], "rate_limit_error");
    assert_eq!(json["error"]["code"], "rate_limit_exceeded");
    assert_eq!(
        json["error"]["message"],
        "Rate limit exceeded: this API key allows 1 request per minute."
    );
}

#[tokio::test]
async fn an_unlimited_key_is_never_rate_limited() {
    let app = test_app(security_state(false, keyed(0), vec![]));

    for _ in 0..5 {
        let response = app
            .clone()
            .oneshot(with_remote_client(keyed_request(CHAT), REMOTE))
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }
}

#[tokio::test]
async fn admin_session_and_anonymous_requests_are_not_rate_limited() {
    let anonymous = test_app(security_state(false, vec![], vec![]));
    for _ in 0..5 {
        let response = anonymous
            .clone()
            .oneshot(with_loopback_client(json_request(
                "POST",
                CHAT,
                chat_body(),
            )))
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    let sessions = vec![hash_session_token("admin-token")];
    let admin = test_app(security_state(true, vec![], sessions));
    for _ in 0..5 {
        let response = admin
            .clone()
            .oneshot(with_remote_client(
                json_request_with_headers(
                    "POST",
                    CHAT,
                    chat_body(),
                    &[("cookie", "srouter_admin_session=admin-token")],
                ),
                REMOTE,
            ))
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }
}

#[tokio::test]
async fn rate_limiting_runs_before_body_validation() {
    let app = test_app(security_state(false, keyed(1), vec![]));

    let first = app
        .clone()
        .oneshot(with_remote_client(
            raw_keyed_json_request(CHAT, "{not json"),
            REMOTE,
        ))
        .await
        .unwrap();
    assert_eq!(first.status(), StatusCode::BAD_REQUEST);

    // The malformed request already counted, so the next one is rejected
    // before the body is ever read.
    let second = app
        .clone()
        .oneshot(with_remote_client(
            raw_keyed_json_request(CHAT, "{not json"),
            REMOTE,
        ))
        .await
        .unwrap();

    assert_eq!(second.status(), StatusCode::TOO_MANY_REQUESTS);
    let json = json_body(second).await;
    assert_eq!(json["error"]["code"], "rate_limit_exceeded");
}

#[tokio::test]
async fn requests_without_connect_info_share_one_unknown_window() {
    let app = test_app(security_state(false, keyed(1), vec![]));

    // No ConnectInfo: the window key falls back to the literal `unknown`
    // address, so both requests must land in the same window.
    let first = app.clone().oneshot(keyed_request(CHAT)).await.unwrap();
    assert_eq!(first.status(), StatusCode::NOT_FOUND);

    let second = app.clone().oneshot(keyed_request(CHAT)).await.unwrap();
    assert_eq!(second.status(), StatusCode::TOO_MANY_REQUESTS);
}

#[tokio::test]
async fn an_unknown_key_is_rejected_without_touching_the_window() {
    let app = test_app(security_state(true, keyed(1), vec![]));

    // Layer ordering itself is proven by
    // `requests_beyond_the_key_limit_return_429_with_retry_after`: were the
    // limiter outermost it would never see a principal and nothing would ever
    // be counted. What this test adds is that a bad credential never reaches
    // the limiter state, even for a key that is rate limited.
    for _ in 0..3 {
        let response = app
            .clone()
            .oneshot(with_remote_client(
                json_request_with_headers(
                    "POST",
                    CHAT,
                    chat_body(),
                    &[("x-api-key", "sr-live-unknown")],
                ),
                REMOTE,
            ))
            .await
            .unwrap();

        // Unknown keys are rejected by auth and never reach the limiter.
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        let json = json_body(response).await;
        assert_eq!(json["error"]["code"], "invalid_api_key");
    }
}
