mod support;

use std::time::Duration;

use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode, header},
};
use futures_util::StreamExt;
use serde_json::Value;
use sqlx::postgres::PgPoolOptions;
use srouter_server::app::create_router;
use support::{
    TestDatabase, api_key_record, app_state_with_fake_upstream, json_request_with_headers,
    security_state, with_loopback_client,
};
use tower::ServiceExt;

static EVENT_TEST_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

fn app(state: srouter_server::AppState) -> Router {
    create_router(state)
}

fn get(uri: &str) -> Request<Body> {
    with_loopback_client(
        Request::builder()
            .uri(uri)
            .header("x-api-key", "logs-test-key")
            .body(Body::empty())
            .unwrap(),
    )
}

async fn json(response: axum::response::Response) -> Value {
    serde_json::from_slice(&to_bytes(response.into_body(), 65_536).await.unwrap()).unwrap()
}

async fn seed_log(database: &srouter_server::AppDatabase, id: &str, created_at: i64, status: i64) {
    let pool = database.sqlite_pool().unwrap();
    sqlx::query(
        "INSERT INTO request_logs (
            id, request_id, method, path, api_key_id, provider_id, model,
            prompt_tokens, completion_tokens, total_tokens, status_code, latency_ms,
            created_at
        ) VALUES (?, ?, 'POST', '/v1/chat/completions', NULL, 'opencode_zen', 'test-model',
            2, 3, 5, ?, 12, ?)",
    )
    .bind(id)
    .bind(id)
    .bind(status)
    .bind(created_at)
    .execute(pool)
    .await
    .unwrap();
}

async fn logs_state(database: &TestDatabase) -> srouter_server::AppState {
    let security = security_state(
        true,
        vec![("logs-test-key".to_owned(), api_key_record("key_1"))],
        vec![],
    );
    let (_upstream, mut state) = app_state_with_fake_upstream().await;
    state.security = security;
    state.database = Some(database.connect().await.unwrap());
    state
}

#[tokio::test]
async fn logs_list_supports_latest_order_pagination_and_status_filter() {
    let test_database = TestDatabase::new().unwrap();
    let state = logs_state(&test_database).await;
    let database = state.database.as_ref().unwrap();
    seed_log(database, "00000000-0000-4000-8000-000000000001", 100, 200).await;
    seed_log(database, "00000000-0000-4000-8000-000000000002", 200, 500).await;
    let app = app(state);

    let response = app.clone().oneshot(get("/v1/logs?limit=1")).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = json(response).await;
    assert_eq!(body["object"], "list");
    assert_eq!(
        body["data"][0]["id"],
        "00000000-0000-4000-8000-000000000002"
    );

    let response = app
        .oneshot(get("/v1/logs?page=1&limit=1&status=error"))
        .await
        .unwrap();
    let body = json(response).await;
    assert_eq!(
        body["pagination"],
        serde_json::json!({
            "page": 1, "limit": 1, "total": 1, "total_pages": 1
        })
    );
    assert_eq!(body["data"][0]["status_code"], 500);
}

#[tokio::test]
async fn log_detail_returns_snake_case_uuid_record_and_404_for_missing_id() {
    let test_database = TestDatabase::new().unwrap();
    let state = logs_state(&test_database).await;
    let database = state.database.as_ref().unwrap();
    let id = "00000000-0000-4000-8000-000000000003";
    seed_log(database, id, 300, 200).await;
    let app = app(state);

    let response = app
        .clone()
        .oneshot(get(&format!("/v1/logs/{id}")))
        .await
        .unwrap();
    let body = json(response).await;
    assert_eq!(body["id"], id);
    assert_eq!(body["request_id"], id);
    assert_eq!(body["method"], "POST");
    assert_eq!(body["path"], "/v1/chat/completions");
    assert!(body.get("statusCode").is_none());
    assert!(body["error_code"].is_null());

    let response = app
        .oneshot(get("/v1/logs/00000000-0000-4000-8000-000000000099"))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn logs_routes_require_api_key_authentication() {
    let test_database = TestDatabase::new().unwrap();
    let state = logs_state(&test_database).await;
    let response = app(state)
        .oneshot(
            Request::builder()
                .uri("/v1/logs")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn postgres_request_log_repository_fails_explicitly() {
    let pool = PgPoolOptions::new()
        .connect_lazy("postgres://unused:unused@127.0.0.1/unused")
        .unwrap();
    let database = srouter_server::AppDatabase::Postgres(pool);
    let error = srouter_server::infrastructure::database::request_logs::list_request_logs(
        &database, None, 50, None,
    )
    .await
    .unwrap_err();
    assert_eq!(error.status(), 500);
    assert!(error.message().contains("not supported for PostgreSQL"));
}

#[tokio::test]
async fn logs_events_send_connected_then_saved_request_and_headers() {
    let _guard = EVENT_TEST_LOCK.lock().await;
    let test_database = TestDatabase::new().unwrap();
    let (upstream, mut state) = app_state_with_fake_upstream().await;
    state.security = security_state(
        true,
        vec![("logs-test-key".to_owned(), api_key_record("key_1"))],
        vec![],
    );
    state.database = Some(test_database.connect().await.unwrap());
    let app = app(state);

    let response = app.clone().oneshot(get("/v1/logs/events")).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response.headers()[header::CONTENT_TYPE],
        "text/event-stream"
    );
    assert_eq!(
        response.headers()[header::CACHE_CONTROL],
        "no-cache, no-transform"
    );
    assert_eq!(response.headers()[header::CONNECTION], "keep-alive");
    assert_eq!(response.headers()["x-accel-buffering"], "no");
    let mut events = response.into_body().into_data_stream();

    let connected = tokio::time::timeout(Duration::from_secs(2), events.next())
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    assert_eq!(
        String::from_utf8(connected.to_vec()).unwrap(),
        "data: {\"type\":\"connected\"}\n\n"
    );

    let request = json_request_with_headers(
        "POST",
        "/v1/chat/completions",
        serde_json::json!({
            "model": "opencode_zen/space-bunny-free",
            "messages": [{ "role": "user", "content": "log event" }]
        }),
        &[("x-api-key", "logs-test-key")],
    );
    let response = app.oneshot(with_loopback_client(request)).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    drop(upstream);

    let mut saw_usage = false;
    let mut saw_log = false;
    let mut pending = String::new();
    while !saw_usage || !saw_log {
        let chunk = tokio::time::timeout(Duration::from_secs(2), events.next())
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        pending.push_str(&String::from_utf8(chunk.to_vec()).unwrap());
        while let Some((record, rest)) = pending.split_once("\n\n") {
            let record = record.to_owned();
            pending = rest.to_owned();
            let Some(data) = record.strip_prefix("data: ") else {
                continue;
            };
            let payload: Value = serde_json::from_str(data).unwrap();
            saw_usage |= payload["type"] == "usage.updated";
            if payload["type"] == "request.logged" {
                saw_log = true;
                assert!(payload["log"]["id"].as_str().unwrap().contains('-'));
                assert!(payload["log"]["request_id"].as_str().unwrap().contains('-'));
                assert_eq!(payload["log"]["method"], "POST");
                assert_eq!(payload["log"]["path"], "/v1/chat/completions");
            }
        }
    }
    assert!(saw_usage);
    assert!(saw_log);
}

#[tokio::test]
async fn event_stream_limit_releases_slot_when_client_disconnects() {
    let _guard = EVENT_TEST_LOCK.lock().await;
    let test_database = TestDatabase::new().unwrap();
    let state = logs_state(&test_database).await;
    let app = app(state);
    let mut responses = Vec::new();

    for _ in 0..16 {
        let response = app.clone().oneshot(get("/v1/logs/events")).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        responses.push(response);
    }
    let response = app.clone().oneshot(get("/v1/logs/events")).await.unwrap();
    assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);

    drop(responses.pop());
    let response = app.oneshot(get("/v1/logs/events")).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
}

#[tokio::test]
async fn event_stream_emits_25_second_heartbeat() {
    let _guard = EVENT_TEST_LOCK.lock().await;
    let test_database = TestDatabase::new().unwrap();
    let state = logs_state(&test_database).await;
    let response = app(state).oneshot(get("/v1/logs/events")).await.unwrap();
    let mut events = response.into_body().into_data_stream();
    let _connected = events.next().await.unwrap().unwrap();
    let heartbeat = loop {
        let chunk = tokio::time::timeout(Duration::from_secs(26), events.next())
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        if !chunk.is_empty() {
            break chunk;
        }
    };
    assert_eq!(String::from_utf8(heartbeat.to_vec()).unwrap(), ": ping\n\n");
}
