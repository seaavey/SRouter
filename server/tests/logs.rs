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
    .execute(&pool)
    .await
    .unwrap();
}

async fn seed_complete_log(
    database: &srouter_server::AppDatabase,
    id: &str,
    created_at: i64,
    status: i64,
) {
    sqlx::query(
        "INSERT INTO request_logs (
            id, request_id, method, path, api_key_id, provider_id, model,
            prompt_tokens, completion_tokens, total_tokens, cached_tokens,
            cache_creation_tokens, reasoning_tokens, estimated_cost, fallback_occurred,
            fallback_path, fallback_reason, resolved_model, status_code, latency_ms, created_at
        ) VALUES (?, ?, 'POST', '/v1/chat/completions', NULL, 'opencode_zen', 'test-model',
            2, 3, 5, 7, 8, 9, 0.1234, 1, 'fallback-a', 'fallback-test',
            'resolved-test-model', ?, 12, ?)",
    )
    .bind(id)
    .bind(id)
    .bind(status)
    .bind(created_at)
    .execute(&database.sqlite_pool().unwrap())
    .await
    .unwrap();
}

struct AnalyticsSeed<'a> {
    id: &'a str,
    created_at: i64,
    status: i64,
    provider_id: &'a str,
    model: &'a str,
    prompt_tokens: i64,
    completion_tokens: i64,
    latency_ms: i64,
}

async fn seed_analytics_log(database: &srouter_server::AppDatabase, row: AnalyticsSeed<'_>) {
    let pool = database.sqlite_pool().unwrap();
    sqlx::query(
        "INSERT INTO request_logs (
            id, request_id, method, path, api_key_id, provider_id, model,
            prompt_tokens, completion_tokens, total_tokens, status_code, latency_ms,
            created_at
        ) VALUES (?, ?, 'POST', '/v1/chat/completions', NULL, ?, ?,
            ?, ?, ?, ?, ?, ?)",
    )
    .bind(row.id)
    .bind(row.id)
    .bind(row.provider_id)
    .bind(row.model)
    .bind(row.prompt_tokens)
    .bind(row.completion_tokens)
    .bind(row.prompt_tokens + row.completion_tokens)
    .bind(row.status)
    .bind(row.latency_ms)
    .bind(row.created_at)
    .execute(&pool)
    .await
    .unwrap();
}

fn current_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
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
    seed_complete_log(database, "00000000-0000-4000-8000-000000000002", 200, 500).await;
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
    assert_eq!(body["data"][0]["cached_tokens"], 7);
    assert_eq!(body["data"][0]["cache_creation_tokens"], 8);
    assert_eq!(body["data"][0]["reasoning_tokens"], 9);
    assert_eq!(body["data"][0]["estimated_cost"], 0.1234);
    assert_eq!(body["data"][0]["costs"]["total"], 0.1234);
    assert_eq!(body["data"][0]["resolved_model"], "resolved-test-model");
    assert_eq!(body["data"][0]["created_at"], 200);
}

#[tokio::test]
async fn log_detail_returns_snake_case_uuid_record_and_404_for_missing_id() {
    let test_database = TestDatabase::new().unwrap();
    let state = logs_state(&test_database).await;
    let database = state.database.as_ref().unwrap();
    let id = "00000000-0000-4000-8000-000000000003";
    seed_complete_log(database, id, 300, 200).await;
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
async fn logs_stats_aggregate_usage_and_by_model() {
    let test_database = TestDatabase::new().unwrap();
    let state = logs_state(&test_database).await;
    let database = state.database.as_ref().unwrap();
    seed_log(database, "00000000-0000-4000-8000-00000000000a", 100, 200).await;
    seed_log(database, "00000000-0000-4000-8000-00000000000b", 200, 500).await;
    sqlx::query("UPDATE request_logs SET estimated_cost = 0.1234 WHERE id = ?")
        .bind("00000000-0000-4000-8000-00000000000a")
        .execute(&database.sqlite_pool().unwrap())
        .await
        .unwrap();
    let app = app(state);

    let response = app.oneshot(get("/v1/logs/stats")).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = json(response).await;
    assert_eq!(body["object"], "usage");
    assert_eq!(body["total_requests"], 2);
    assert_eq!(body["total_success_requests"], 1);
    assert_eq!(body["total_tokens"], 10);
    assert_eq!(body["total_prompt_tokens"], 4);
    assert_eq!(body["total_completion_tokens"], 6);
    assert_eq!(body["total_input_tokens"], 4);
    assert_eq!(body["total_output_tokens"], 6);
    assert_eq!(body["estimated"], true);
    assert_eq!(body["cost_label"], "$0.1234");
    assert_eq!(body["by_model"][0]["model"], "test-model");
    assert_eq!(body["by_model"][0]["total_requests"], 2);
    assert_eq!(body["by_model"][0]["total_input_tokens"], 4);
    assert_eq!(body["by_model"][0]["total_output_tokens"], 6);
    assert_eq!(body["by_model"][0]["total_cached_tokens"], 0);
}

#[tokio::test]
async fn logs_analytics_report_has_the_frozen_shape_and_defaults_to_24h() {
    let test_database = TestDatabase::new().unwrap();
    let state = logs_state(&test_database).await;
    let app = app(state);

    let response = app
        .clone()
        .oneshot(get("/v1/logs/analytics?window=1h"))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = json(response).await;
    assert_eq!(body["object"], "analytics");
    assert_eq!(body["window"], "1h");
    assert_eq!(body["bucket_size_ms"], 60_000);
    // Node fills buckets up to (exclusive) `Date.now()`, so the partial current
    // bucket is included whenever now is off a bucket boundary: 60 or 61.
    let hour_buckets = body["buckets"].as_array().unwrap().len();
    assert!(
        (60..=61).contains(&hour_buckets),
        "unexpected 1h bucket count: {hour_buckets}"
    );
    assert!(body["generated_at"].is_number());
    assert!(body["requests_per_second"].is_number());
    assert!(body["total_requests"].is_number());
    assert!(body["error_rate"].is_number());
    assert!(body["p95_latency_ms"].is_number());
    assert!(body["top_models"].is_array());
    assert!(body["providers"].is_array());

    let response = app.oneshot(get("/v1/logs/analytics")).await.unwrap();
    let body = json(response).await;
    assert_eq!(body["window"], "24h");
    assert_eq!(body["bucket_size_ms"], 3_600_000);
    let day_buckets = body["buckets"].as_array().unwrap().len();
    assert!(
        (24..=25).contains(&day_buckets),
        "unexpected 24h bucket count: {day_buckets}"
    );
}

#[tokio::test]
async fn logs_analytics_rejects_an_unknown_window() {
    let test_database = TestDatabase::new().unwrap();
    let state = logs_state(&test_database).await;
    let response = app(state)
        .oneshot(get("/v1/logs/analytics?window=bad"))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let body = json(response).await;
    assert_eq!(body["error"]["message"], "Invalid window parameter");
    assert_eq!(body["error"]["code"], "invalid_request");
}

#[tokio::test]
async fn logs_analytics_bucket_aggregates_and_orders_top_models() {
    let test_database = TestDatabase::new().unwrap();
    let state = logs_state(&test_database).await;
    let database = state.database.as_ref().unwrap();
    // An aligned, two-minutes-ago bucket stays inside the 1h window and out of
    // the current minute, so "now" drifting mid-test cannot move it.
    let bucket_start = (current_ms() / 60_000) * 60_000 - 120_000;
    for (index, (provider, model, status, latency)) in [
        ("openai", "analytics-test-model-a", 200, 100),
        ("openai", "analytics-test-model-a", 200, 150),
        ("anthropic", "analytics-test-model-b", 500, 2_000),
    ]
    .into_iter()
    .enumerate()
    {
        seed_analytics_log(
            database,
            AnalyticsSeed {
                id: &format!("00000000-0000-4000-8000-00000000001{index}"),
                created_at: bucket_start + 1_000,
                status,
                provider_id: provider,
                model,
                prompt_tokens: 10,
                completion_tokens: 20,
                latency_ms: latency,
            },
        )
        .await;
    }
    let app = app(state);

    let response = app
        .oneshot(get("/v1/logs/analytics?window=1h"))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = json(response).await;

    assert!(body["total_requests"].as_i64().unwrap() >= 3);
    assert!(body["error_rate"].as_f64().unwrap() > 0.0);

    let buckets = body["buckets"].as_array().unwrap();
    let seeded = buckets
        .iter()
        .find(|bucket| bucket["bucket_start"].as_i64() == Some(bucket_start))
        .expect("seeded bucket should be present in the report");
    assert_eq!(seeded["total_requests"], 3);
    assert_eq!(seeded["success_requests"], 2);
    assert_eq!(seeded["error_requests"], 1);
    assert_eq!(seeded["prompt_tokens"], 30);
    assert_eq!(seeded["completion_tokens"], 60);
    assert_eq!(seeded["cached_tokens"], 0);

    let top_models = body["top_models"].as_array().unwrap();
    let first = &top_models[0];
    assert_eq!(first["model"], "analytics-test-model-a");
    assert_eq!(first["total_requests"], 2);

    let providers: Vec<&str> = body["providers"]
        .as_array()
        .unwrap()
        .iter()
        .map(|slice| slice["provider_id"].as_str().unwrap())
        .collect();
    assert!(providers.contains(&"openai"));
    assert!(providers.contains(&"anthropic"));
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
        pending.push_str(core::str::from_utf8(&chunk).unwrap());
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

#[tokio::test]
async fn request_log_records_real_user_request_with_cost_breakdown() {
    let test_database = TestDatabase::new().unwrap();
    let state = logs_state(&test_database).await;
    let database = state.database.as_ref().unwrap();

    let usage = srouter_server::protocol::usage::UsageBreakdown {
        prompt_tokens: 10_000,
        completion_tokens: 2_000,
        total_tokens: 12_000,
        cached_tokens: 3_000,
        cache_creation_tokens: 1_000,
        reasoning_tokens: 0,
    };

    let estimated_cost = srouter_server::features::catalog::estimate_cost("gpt-4o", &usage)
        .expect("model gpt-4o should be priced");
    assert!(estimated_cost > 0.0);

    let log_id = srouter_server::infrastructure::database::request_logs::insert_request_log(
        database,
        srouter_server::infrastructure::database::request_logs::RequestLogInput {
            request_id: "00000000-0000-4000-8000-000000000055",
            method: "POST",
            path: "/v1/chat/completions",
            api_key_id: None,
            ip_address: Some("198.51.100.1"),
            user_agent: Some("curl/8.0"),
            provider_id: "openai",
            model: "gpt-4o",
            status_code: 200,
            latency_ms: 150,
            usage: &usage,
            estimated_cost,
            resolved_model: Some("openai/gpt-4o"),
            error_code: None,
            error_message: None,
            created_at: 1_000,
        },
    )
    .await
    .expect("insert log");

    let app = app(state);
    let response = app
        .oneshot(get(&format!("/v1/logs/{log_id}")))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = json(response).await;

    // 1. Identity & Routing
    assert_eq!(body["id"], log_id);
    assert_eq!(body["method"], "POST");
    assert_eq!(body["path"], "/v1/chat/completions");
    assert_eq!(body["status_code"], 200);
    assert_eq!(body["model"], "gpt-4o");
    assert_eq!(body["resolved_model"], "openai/gpt-4o");
    assert_eq!(body["ip_address"], "198.51.100.1");

    // 2. Tokens
    assert_eq!(body["prompt_tokens"], 10_000);
    assert_eq!(body["completion_tokens"], 2_000);
    assert_eq!(body["total_tokens"], 12_000);
    assert_eq!(body["cached_tokens"], 3_000);
    assert_eq!(body["cache_creation_tokens"], 1_000);

    // 3. Costs: top-level + detailed breakdown
    assert_eq!(body["estimated_cost"], estimated_cost);
    let costs = &body["costs"];
    assert!(costs.is_object());
    let input_cost = costs["input"].as_f64().unwrap();
    let output_cost = costs["output"].as_f64().unwrap();
    let cache_cost = costs["cache"].as_f64().unwrap();
    let total_cost = costs["total"].as_f64().unwrap();

    assert!(input_cost > 0.0);
    assert!(output_cost > 0.0);
    assert!(cache_cost > 0.0);
    assert!((total_cost - estimated_cost).abs() < 1e-6);
    assert!(((input_cost + output_cost + cache_cost) - total_cost).abs() < 1e-6);
}
