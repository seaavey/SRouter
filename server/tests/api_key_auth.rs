//! Behavior tests for the API-key/admin-session auth middleware. Every request
//! carries an injected peer address, and the empty provider registry turns a
//! request that passed auth into a deterministic `404`.

mod support;

use axum::{Router, body::to_bytes, http::StatusCode, response::Response};
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
const DISABLED_KEY: &str = "sr-live-disabled";
const CHAT: &str = "/v1/chat/completions";
const REMOTE: &str = "203.0.113.7";

const REMOTE_MISSING_MESSAGE: &str = "Remote/public requests require a valid SRouter API Key. Please provide your key via 'Authorization: Bearer ***' or 'x-api-key'.";
const LOOPBACK_MISSING_MESSAGE: &str = "Missing SRouter API Key. Please provide a valid key via 'Authorization: Bearer ***' header or disable 'Require API Key' in Settings.";

fn test_app(security: SecurityState) -> Router {
    create_router(empty_registry_state(security))
}

fn chat_body() -> serde_json::Value {
    serde_json::json!({
        "model": "does-not-exist",
        "messages": [ { "role": "user", "content": "hi" } ]
    })
}

fn keyed(record: APIKeyRecord) -> Vec<(String, APIKeyRecord)> {
    vec![(KEY.to_owned(), record)]
}

async fn json_body(response: Response) -> serde_json::Value {
    let bytes = to_bytes(response.into_body(), 65_536).await.unwrap();

    serde_json::from_slice(&bytes).unwrap()
}

async fn assert_error(
    response: Response,
    status: StatusCode,
    error_type: &str,
    code: &str,
    message: &str,
) {
    assert_eq!(response.status(), status);
    let json = json_body(response).await;

    assert_eq!(json["error"]["type"], error_type);
    assert_eq!(json["error"]["code"], code);
    assert_eq!(json["error"]["message"], message);
}

#[tokio::test]
async fn anonymous_loopback_requests_pass_when_the_requirement_is_off() {
    let app = test_app(security_state(false, vec![], vec![]));
    let response = app
        .oneshot(with_loopback_client(json_request(
            "POST",
            CHAT,
            chat_body(),
        )))
        .await
        .unwrap();

    // 404 means the request reached the handler; auth let it through.
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn loopback_requests_need_a_key_when_the_requirement_is_on() {
    let app = test_app(security_state(true, vec![], vec![]));
    let response = app
        .oneshot(with_loopback_client(json_request(
            "POST",
            CHAT,
            chat_body(),
        )))
        .await
        .unwrap();

    assert_error(
        response,
        StatusCode::UNAUTHORIZED,
        "invalid_request_error",
        "missing_api_key",
        LOOPBACK_MISSING_MESSAGE,
    )
    .await;
}

#[tokio::test]
async fn remote_requests_need_a_key_even_when_the_requirement_is_off() {
    let app = test_app(security_state(false, vec![], vec![]));
    let response = app
        .oneshot(with_remote_client(
            json_request("POST", CHAT, chat_body()),
            REMOTE,
        ))
        .await
        .unwrap();

    assert_error(
        response,
        StatusCode::UNAUTHORIZED,
        "invalid_request_error",
        "missing_api_key",
        REMOTE_MISSING_MESSAGE,
    )
    .await;
}

#[tokio::test]
async fn a_valid_key_passes_and_identifies_the_principal() {
    let app = test_app(security_state(
        false,
        keyed(api_key_record("key_1")),
        vec![],
    ));
    let response = app
        .oneshot(with_remote_client(
            json_request_with_headers("POST", CHAT, chat_body(), &[("x-api-key", KEY)]),
            REMOTE,
        ))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn a_bearer_authorization_value_is_accepted() {
    let app = test_app(security_state(true, keyed(api_key_record("key_1")), vec![]));
    let response = app
        .oneshot(with_remote_client(
            json_request_with_headers(
                "POST",
                CHAT,
                chat_body(),
                &[("authorization", &format!("Bearer {KEY}"))],
            ),
            REMOTE,
        ))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn an_unknown_key_returns_invalid_api_key_when_required() {
    let app = test_app(security_state(true, vec![], vec![]));
    let response = app
        .oneshot(with_loopback_client(json_request_with_headers(
            "POST",
            CHAT,
            chat_body(),
            &[("x-api-key", "sr-live-unknown")],
        )))
        .await
        .unwrap();

    assert_error(
        response,
        StatusCode::UNAUTHORIZED,
        "invalid_request_error",
        "invalid_api_key",
        "Invalid SRouter API Key",
    )
    .await;
}

#[tokio::test]
async fn an_unknown_key_passes_anonymously_when_not_required_and_loopback() {
    let app = test_app(security_state(false, vec![], vec![]));
    let response = app
        .oneshot(with_loopback_client(json_request_with_headers(
            "POST",
            CHAT,
            chat_body(),
            &[("x-api-key", "sr-live-unknown")],
        )))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn a_disabled_key_returns_api_key_disabled() {
    let mut record = api_key_record("key_1");
    record.enabled = false;

    let app = test_app(security_state(false, keyed(record), vec![]));
    let response = app
        .oneshot(with_loopback_client(json_request_with_headers(
            "POST",
            CHAT,
            chat_body(),
            &[("x-api-key", KEY)],
        )))
        .await
        .unwrap();

    assert_error(
        response,
        StatusCode::UNAUTHORIZED,
        "invalid_request_error",
        "api_key_disabled",
        "The provided SRouter API Key is disabled",
    )
    .await;
}

#[tokio::test]
async fn exhausted_credit_returns_402_insufficient_credit() {
    let mut record = api_key_record("key_1");
    record.credit_limit = 10.99;
    record.usage_cost = 10.99;

    let app = test_app(security_state(false, keyed(record), vec![]));
    let response = app
        .oneshot(with_remote_client(
            json_request_with_headers("POST", CHAT, chat_body(), &[("x-api-key", KEY)]),
            REMOTE,
        ))
        .await
        .unwrap();

    assert_error(
        response,
        StatusCode::PAYMENT_REQUIRED,
        "insufficient_quota",
        "insufficient_credit",
        "Insufficient credit balance. Your credit limit has been reached.",
    )
    .await;
}

#[tokio::test]
async fn exhausted_quota_returns_429_quota_exceeded() {
    let mut record = api_key_record("key_1");
    record.quota_limit = 1_500_000.0;
    record.usage_tokens = 1_500_000.0;

    let app = test_app(security_state(false, keyed(record), vec![]));
    let response = app
        .oneshot(with_remote_client(
            json_request_with_headers("POST", CHAT, chat_body(), &[("x-api-key", KEY)]),
            REMOTE,
        ))
        .await
        .unwrap();

    assert_error(
        response,
        StatusCode::TOO_MANY_REQUESTS,
        "insufficient_quota",
        "quota_exceeded",
        "Token quota exceeded. Your lifetime token limit has been reached.",
    )
    .await;
}

#[tokio::test]
async fn credit_is_checked_before_quota() {
    let mut record = api_key_record("key_1");
    record.credit_limit = 5.0;
    record.usage_cost = 5.0;
    record.quota_limit = 10.0;
    record.usage_tokens = 10.0;

    let app = test_app(security_state(false, keyed(record), vec![]));
    let response = app
        .oneshot(with_loopback_client(json_request_with_headers(
            "POST",
            CHAT,
            chat_body(),
            &[("x-api-key", KEY)],
        )))
        .await
        .unwrap();

    assert_error(
        response,
        StatusCode::PAYMENT_REQUIRED,
        "insufficient_quota",
        "insufficient_credit",
        "Insufficient credit balance. Your credit limit has been reached.",
    )
    .await;
}

#[tokio::test]
async fn a_valid_admin_session_cookie_passes_without_a_key() {
    let sessions = vec![hash_session_token("admin-token")];
    let app = test_app(security_state(true, vec![], sessions));
    let response = app
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

#[tokio::test]
async fn an_unknown_admin_session_cookie_does_not_pass() {
    let sessions = vec![hash_session_token("admin-token")];
    let app = test_app(security_state(true, vec![], sessions));
    let response = app
        .oneshot(with_remote_client(
            json_request_with_headers(
                "POST",
                CHAT,
                chat_body(),
                &[("cookie", "srouter_admin_session=stolen-token")],
            ),
            REMOTE,
        ))
        .await
        .unwrap();

    assert_error(
        response,
        StatusCode::UNAUTHORIZED,
        "invalid_request_error",
        "missing_api_key",
        REMOTE_MISSING_MESSAGE,
    )
    .await;
}

#[tokio::test]
async fn x_api_key_wins_over_the_authorization_header() {
    let mut disabled = api_key_record("key_2");
    disabled.enabled = false;

    let keys = vec![
        (KEY.to_owned(), api_key_record("key_1")),
        (DISABLED_KEY.to_owned(), disabled),
    ];
    let app = test_app(security_state(false, keys, vec![]));
    let response = app
        .oneshot(with_remote_client(
            json_request_with_headers(
                "POST",
                CHAT,
                chat_body(),
                &[
                    ("x-api-key", KEY),
                    ("authorization", &format!("Bearer {DISABLED_KEY}")),
                ],
            ),
            REMOTE,
        ))
        .await
        .unwrap();

    // A `401 api_key_disabled` here would mean Authorization was consulted first.
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn a_bare_authorization_value_is_treated_as_a_key() {
    let app = test_app(security_state(true, keyed(api_key_record("key_1")), vec![]));
    let response = app
        .oneshot(with_remote_client(
            json_request_with_headers("POST", CHAT, chat_body(), &[("authorization", KEY)]),
            REMOTE,
        ))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn whitespace_only_credentials_are_treated_as_missing() {
    let app = test_app(security_state(true, keyed(api_key_record("key_1")), vec![]));
    let response = app
        .oneshot(with_remote_client(
            json_request_with_headers(
                "POST",
                CHAT,
                chat_body(),
                &[
                    ("x-api-key", "   "),
                    ("authorization", &format!("Bearer {KEY}")),
                ],
            ),
            REMOTE,
        ))
        .await
        .unwrap();

    // Node treats a truthy but blank `x-api-key` as no credential at all and
    // never falls back to Authorization.
    assert_error(
        response,
        StatusCode::UNAUTHORIZED,
        "invalid_request_error",
        "missing_api_key",
        REMOTE_MISSING_MESSAGE,
    )
    .await;
}

#[tokio::test]
async fn spoofed_client_headers_do_not_change_the_decision() {
    let app = test_app(security_state(false, vec![], vec![]));
    let response = app
        .oneshot(with_remote_client(
            json_request_with_headers(
                "POST",
                CHAT,
                chat_body(),
                &[
                    ("host", "localhost"),
                    ("x-forwarded-for", "127.0.0.1"),
                    ("x-srouter-client", "playground"),
                ],
            ),
            REMOTE,
        ))
        .await
        .unwrap();

    assert_error(
        response,
        StatusCode::UNAUTHORIZED,
        "invalid_request_error",
        "missing_api_key",
        REMOTE_MISSING_MESSAGE,
    )
    .await;
}

#[tokio::test]
async fn the_v1_v1_alias_is_protected_too() {
    let app = test_app(security_state(false, vec![], vec![]));
    let response = app
        .oneshot(with_remote_client(
            json_request("POST", "/v1/v1/chat/completions", chat_body()),
            REMOTE,
        ))
        .await
        .unwrap();

    assert_error(
        response,
        StatusCode::UNAUTHORIZED,
        "invalid_request_error",
        "missing_api_key",
        REMOTE_MISSING_MESSAGE,
    )
    .await;
}

#[tokio::test]
async fn rejections_keep_the_frozen_security_headers() {
    let app = test_app(security_state(true, vec![], vec![]));
    let response = app
        .oneshot(with_remote_client(
            json_request("POST", CHAT, chat_body()),
            REMOTE,
        ))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(response.headers()["x-powered-by"], "Seaavey");
    assert_eq!(response.headers()["x-version"], env!("CARGO_PKG_VERSION"));
    assert_eq!(response.headers()["x-content-type-options"], "nosniff");
}
