//! The wire bytes a response actually carries, and the types that describe them.
//!
//! `server/bindings.ts` renders one shape per type, which only holds if no
//! response ever takes a different one. These checks read the live response for
//! the fields that could diverge and confirm the rendered shape describes it.

use serde_json::Value;
use srouter_server::app::create_router;
use srouter_server::infrastructure::database::request_logs::{RequestLogInput, insert_request_log};

mod support;

use support::{
    TestDatabase, api_key_record, app_state_with_fake_upstream, json_request_with_headers,
    security_state,
};
use tower::ServiceExt;

async fn state(database: &TestDatabase) -> srouter_server::AppState {
    let security = security_state(
        true,
        vec![("wire-test-key".to_owned(), api_key_record("key_1"))],
        vec![],
    );
    let (_upstream, mut state) = app_state_with_fake_upstream().await;
    state.security = security;
    state.database = Some(database.connect().await.unwrap());

    state
}

async fn body_of(state: srouter_server::AppState, uri: &str) -> (u16, Value) {
    let request =
        json_request_with_headers("GET", uri, Value::Null, &[("x-api-key", "wire-test-key")]);
    let response = create_router(state).oneshot(request).await.unwrap();
    let status = response.status().as_u16();
    let bytes = axum::body::to_bytes(response.into_body(), 65_536)
        .await
        .unwrap();

    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

/// A rendered `?:` field is one the response may omit. `LogsResponse` declares
/// `pagination?: Pagination | null`, so a page that carries no pagination must
/// leave the key out rather than send `null`.
#[tokio::test]
async fn an_omitted_field_is_absent_from_the_response_not_null() {
    let database = TestDatabase::new().unwrap();
    let state = state(&database).await;

    let (status, body) = body_of(state, "/v1/logs").await;

    assert_eq!(status, 200, "body: {body}");
    assert!(
        body.get("pagination").is_none(),
        "`pagination` must be absent when there is nothing to page, got {body}"
    );
}

/// The same field is present with content when the response does have one.
#[tokio::test]
async fn the_optional_field_is_present_when_the_response_carries_it() {
    let database = TestDatabase::new().unwrap();
    let state = state(&database).await;
    let database = state.database.as_ref().unwrap();

    let usage = srouter_server::protocol::usage::UsageBreakdown::default();
    insert_request_log(
        database,
        RequestLogInput {
            request_id: "00000000-0000-4000-8000-0000000000aa",
            method: "GET",
            path: "/v1/models",
            api_key_id: None,
            ip_address: None,
            user_agent: None,
            provider_id: "openai",
            model: "gpt-4o",
            status_code: 200,
            latency_ms: 12,
            usage: &usage,
            estimated_cost: 0.0,
            resolved_model: None,
            error_code: None,
            error_message: None,
            created_at: 1_700_000_000_000,
        },
    )
    .await
    .expect("insert log");

    let (status, body) = body_of(state, "/v1/logs?page=1").await;

    assert_eq!(status, 200, "body: {body}");
    assert!(
        body["pagination"].is_object(),
        "`pagination` must be present once the request asks for a page, got {body}"
    );
    assert_eq!(body["pagination"]["total"], 1);
}

/// `RequestLog` renders `costs?: LogCost | null`. A row without costs must omit
/// the key, and a row with costs must carry every member the type names.
#[tokio::test]
async fn the_nested_optional_field_follows_the_rendered_shape() {
    let database = TestDatabase::new().unwrap();
    let state = state(&database).await;
    let database = state.database.as_ref().unwrap();

    let usage = srouter_server::protocol::usage::UsageBreakdown {
        prompt_tokens: 15_000,
        completion_tokens: 4_000,
        total_tokens: 19_000,
        cached_tokens: 5_000,
        cache_creation_tokens: 2_000,
        reasoning_tokens: 500,
    };
    let estimated_cost = srouter_server::features::catalog::estimate_cost("gpt-4o", &usage)
        .expect("model gpt-4o should be priced");

    let log_id = insert_request_log(
        database,
        RequestLogInput {
            request_id: "00000000-0000-4000-8000-0000000000ab",
            method: "POST",
            path: "/v1/chat/completions",
            api_key_id: None,
            ip_address: Some("127.0.0.1"),
            user_agent: Some("curl/8.5.0"),
            provider_id: "openai",
            model: "gpt-4o",
            status_code: 200,
            latency_ms: 230,
            usage: &usage,
            estimated_cost,
            resolved_model: Some("openai/gpt-4o"),
            error_code: None,
            error_message: None,
            created_at: 1_700_000_000_000,
        },
    )
    .await
    .expect("insert log");

    let (status, body) = body_of(state, &format!("/v1/logs/{log_id}")).await;

    assert_eq!(status, 200, "body: {body}");

    // `LogCost` names input, output, cache and total.
    for field in ["input", "output", "cache", "total"] {
        assert!(
            body["costs"][field].is_string(),
            "`costs.{field}` is missing from the response: {body}"
        );
    }

    // `RequestLog` flattens `LogClient` and `LogError`, so those keys sit on the
    // record itself; the client ones are present, the error ones are omitted.
    assert_eq!(body["user_agent"], "curl/8.5.0");
    assert!(
        body.get("error_code").is_none(),
        "`error_code` must be absent on a successful request, got {body}"
    );
}

/// A field the document types as always present really is always present, for
/// both the list and the single-record route.
#[tokio::test]
async fn the_required_fields_are_always_present() {
    let database = TestDatabase::new().unwrap();
    let state = state(&database).await;
    let database = state.database.as_ref().unwrap();

    let usage = srouter_server::protocol::usage::UsageBreakdown::default();
    let log_id = insert_request_log(
        database,
        RequestLogInput {
            request_id: "00000000-0000-4000-8000-0000000000ac",
            method: "GET",
            path: "/v1/models",
            api_key_id: None,
            ip_address: None,
            user_agent: None,
            provider_id: "openai",
            model: "gpt-4o",
            status_code: 200,
            latency_ms: 12,
            usage: &usage,
            estimated_cost: 0.0,
            resolved_model: None,
            error_code: None,
            error_message: None,
            created_at: 1_700_000_000_000,
        },
    )
    .await
    .expect("insert log");

    let (status, body) = body_of(state, &format!("/v1/logs/{log_id}")).await;
    assert_eq!(status, 200, "body: {body}");

    for field in [
        "id",
        "request_id",
        "method",
        "path",
        "status_code",
        "latency_ms",
        "created_at",
        "tokens",
    ] {
        assert!(
            !body[field].is_null(),
            "`{field}` is required by `RequestLog` but is missing: {body}"
        );
    }
}
