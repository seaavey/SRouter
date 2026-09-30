//! Request-log persistence and API response mapping.

use std::collections::HashMap;
use std::sync::OnceLock;

use serde::Serialize;
use sqlx::{Row, SqlitePool};
use uuid::Uuid;

use crate::clock::now_ms;
use crate::constants;
use crate::error::APIError;
use crate::features::gateway::usage::UsageBreakdown;
use crate::infrastructure::database::AppDatabase;

#[derive(Clone, Debug, Serialize)]
pub struct RequestLog {
    pub id: Uuid,
    pub request_id: Uuid,
    pub user_id: Option<Uuid>,
    pub api_key_id: Option<Uuid>,
    pub method: String,
    pub path: String,
    pub status_code: i16,
    pub ip_address: Option<String>,
    pub user_agent: Option<String>,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub input_tokens: Option<i64>,
    pub output_tokens: Option<i64>,
    pub total_tokens: Option<i64>,
    pub latency_ms: i64,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
}

#[derive(Debug)]
pub struct LogsPage {
    pub data: Vec<RequestLog>,
    pub page: i64,
    pub limit: i64,
    pub total: i64,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ObjectKind {
    List,
    Usage,
}

static LOG_EVENTS: OnceLock<tokio::sync::broadcast::Sender<Uuid>> = OnceLock::new();

fn log_events() -> &'static tokio::sync::broadcast::Sender<Uuid> {
    LOG_EVENTS.get_or_init(|| tokio::sync::broadcast::channel(64).0)
}

pub fn subscribe_request_logs() -> tokio::sync::broadcast::Receiver<Uuid> {
    log_events().subscribe()
}

fn publish_request_log(id: Uuid) {
    let _ = log_events().send(id);
}

/// Lists logs newest-first; PostgreSQL is unsupported until its repository exists.
pub async fn list_request_logs(
    database: &AppDatabase,
    page: Option<i64>,
    limit: i64,
    status: Option<&str>,
) -> Result<LogsPage, APIError> {
    let pool = sqlite_pool(database)?;
    let limit = limit.clamp(1, 500);
    let page = page.map(|page| page.max(1));
    let (count_query, logs_query) = match status {
        Some("success") => (
            "SELECT COUNT(*) FROM request_logs WHERE status_code >= 200 AND status_code < 300",
            "SELECT * FROM request_logs WHERE status_code >= 200 AND status_code < 300 ORDER BY created_at DESC LIMIT ? OFFSET ?",
        ),
        Some("error") => (
            "SELECT COUNT(*) FROM request_logs WHERE status_code < 200 OR status_code >= 300",
            "SELECT * FROM request_logs WHERE status_code < 200 OR status_code >= 300 ORDER BY created_at DESC LIMIT ? OFFSET ?",
        ),
        Some("all") | None => (
            "SELECT COUNT(*) FROM request_logs",
            "SELECT * FROM request_logs ORDER BY created_at DESC LIMIT ? OFFSET ?",
        ),
        Some(_) => {
            return Err(APIError::new(
                400,
                constants::database::INVALID_STATUS_PARAMETER,
            ));
        }
    };
    let total: i64 = sqlx::query_scalar(count_query)
        .fetch_one(pool)
        .await
        .map_err(|error| {
            APIError::new(
                500,
                constants::database::could_not_count_request_logs(&error),
            )
        })?;
    let page_number = page.unwrap_or(1);
    let offset = page.map_or(0, |page| (page - 1).saturating_mul(limit));
    let rows = sqlx::query(logs_query)
        .bind(limit)
        .bind(offset)
        .fetch_all(pool)
        .await
        .map_err(|error| {
            APIError::new(
                500,
                constants::database::could_not_list_request_logs(&error),
            )
        })?;
    let data = rows
        .iter()
        .map(map_request_log)
        .collect::<Result<Vec<_>, _>>()?;
    Ok(LogsPage {
        data,
        page: page_number,
        limit,
        total,
    })
}

pub async fn get_request_log(
    database: &AppDatabase,
    id: Uuid,
) -> Result<Option<RequestLog>, APIError> {
    let row = sqlx::query("SELECT * FROM request_logs WHERE id = ?")
        .bind(id.to_string())
        .fetch_optional(sqlite_pool(database)?)
        .await
        .map_err(|error| {
            APIError::new(500, constants::database::could_not_read_request_log(&error))
        })?;
    row.as_ref().map(map_request_log).transpose()
}

pub async fn usage_stats(database: &AppDatabase) -> Result<serde_json::Value, APIError> {
    let row = sqlx::query(
        "SELECT COUNT(*) AS total_requests, \
         COALESCE(SUM(CASE WHEN status_code >= 200 AND status_code < 300 THEN 1 ELSE 0 END), 0) AS successes, \
         COALESCE(SUM(total_tokens), 0) AS total_tokens, \
         COALESCE(SUM(prompt_tokens), 0) AS input_tokens, \
         COALESCE(SUM(completion_tokens), 0) AS output_tokens, \
         COALESCE(SUM(cached_tokens), 0) AS cached_tokens, \
         COALESCE(SUM(cache_creation_tokens), 0) AS cache_creation_tokens, \
         COALESCE(SUM(reasoning_tokens), 0) AS reasoning_tokens, \
         COALESCE(SUM(estimated_cost), 0) AS estimated_cost FROM request_logs",
    )
    .fetch_one(sqlite_pool(database)?)
    .await
    .map_err(|error| APIError::new(500, constants::database::could_not_aggregate_request_logs(&error)))?;
    let total_requests: i64 = row.try_get("total_requests").map_err(log_row_error)?;
    let successes: i64 = row.try_get("successes").map_err(log_row_error)?;
    let total_tokens: i64 = row.try_get("total_tokens").map_err(log_row_error)?;
    let input_tokens: i64 = row.try_get("input_tokens").map_err(log_row_error)?;
    let output_tokens: i64 = row.try_get("output_tokens").map_err(log_row_error)?;
    let cached_tokens: i64 = row.try_get("cached_tokens").map_err(log_row_error)?;
    let cache_creation_tokens: i64 = row
        .try_get("cache_creation_tokens")
        .map_err(log_row_error)?;
    let reasoning_tokens: i64 = row.try_get("reasoning_tokens").map_err(log_row_error)?;
    let estimated_cost: f64 = row.try_get("estimated_cost").map_err(log_row_error)?;
    let model_rows = sqlx::query(
        "SELECT model, COUNT(*) AS total_requests, \
         SUM(prompt_tokens) AS input_tokens, SUM(completion_tokens) AS output_tokens, \
         SUM(cached_tokens) AS cached_tokens, SUM(estimated_cost) AS estimated_cost \
         FROM request_logs GROUP BY model ORDER BY total_requests DESC",
    )
    .fetch_all(sqlite_pool(database)?)
    .await
    .map_err(|error| {
        APIError::new(
            500,
            constants::database::could_not_aggregate_request_logs_by_model(&error),
        )
    })?;
    let by_model = model_rows
        .iter()
        .map(|row| {
            Ok(serde_json::json!({
                "model": row.try_get::<String, _>("model").map_err(log_row_error)?,
                "total_requests": row.try_get::<i64, _>("total_requests").map_err(log_row_error)?,
                "total_input_tokens": row.try_get::<i64, _>("input_tokens").map_err(log_row_error)?,
                "total_output_tokens": row.try_get::<i64, _>("output_tokens").map_err(log_row_error)?,
                "total_cached_tokens": row.try_get::<i64, _>("cached_tokens").map_err(log_row_error)?,
                "est_cost": row.try_get::<f64, _>("estimated_cost").map_err(log_row_error)?,
            }))
        })
        .collect::<Result<Vec<_>, APIError>>()?;
    Ok(serde_json::json!({
        "object": ObjectKind::Usage,
        "total_requests": total_requests,
        "total_success_requests": successes,
        "total_tokens": total_tokens,
        "total_prompt_tokens": input_tokens,
        "total_completion_tokens": output_tokens,
        "total_cached_tokens": cached_tokens,
        "total_cache_creation_tokens": cache_creation_tokens,
        "total_reasoning_tokens": reasoning_tokens,
        "total_estimated_cost": estimated_cost,
        "total_input_tokens": input_tokens,
        "total_output_tokens": output_tokens,
        "cost_label": format!("${estimated_cost:.2}"),
        "estimated": true,
        "by_model": by_model
    }))
}

/// A validated `window` query value plus its bucket geometry, mirroring
/// `getBucketSizeMs`/`getBucketCount` in the Node runtime.
#[derive(Clone, Copy, Debug)]
pub struct AnalyticsWindow {
    pub name: &'static str,
    pub bucket_size_ms: i64,
    pub bucket_count: i64,
}

/// Maps the `window` query value to its buckets. `None` for an unknown value,
/// which the handler renders as `400`.
pub fn parse_analytics_window(raw: &str) -> Option<AnalyticsWindow> {
    let (name, bucket_size_ms, bucket_count) = match raw {
        "1h" => ("1h", 60_000, 60),
        "24h" => ("24h", 3_600_000, 24),
        "7d" => ("7d", 21_600_000, 28),
        "30d" => ("30d", 86_400_000, 30),
        _ => return None,
    };
    Some(AnalyticsWindow {
        name,
        bucket_size_ms,
        bucket_count,
    })
}

/// One time bucket of the analytics window. Missing buckets are zero-filled.
///
/// Deliberate deviation from Node: this report serializes snake_case, matching
/// the rest of the Rust `/v1/logs` surface, instead of Node's camelCase.
#[derive(Debug, Serialize)]
pub struct AnalyticsBucket {
    pub bucket_start: i64,
    pub total_requests: i64,
    pub success_requests: i64,
    pub error_requests: i64,
    pub avg_latency_ms: f64,
    pub total_tokens: i64,
    pub prompt_tokens: i64,
    pub completion_tokens: i64,
    pub cached_tokens: i64,
}

impl AnalyticsBucket {
    fn empty(bucket_start: i64) -> Self {
        Self {
            bucket_start,
            total_requests: 0,
            success_requests: 0,
            error_requests: 0,
            avg_latency_ms: 0.0,
            total_tokens: 0,
            prompt_tokens: 0,
            completion_tokens: 0,
            cached_tokens: 0,
        }
    }
}

#[derive(Debug, Serialize)]
pub struct AnalyticsTopModel {
    pub model: Option<String>,
    pub total_requests: i64,
    pub total_tokens: i64,
    pub est_cost: f64,
}

#[derive(Debug, Serialize)]
pub struct AnalyticsTopAgent {
    pub agent: String,
    pub raw_user_agent: String,
    pub total_requests: i64,
    pub total_tokens: i64,
}

#[derive(Debug, Serialize)]
pub struct AnalyticsProviderSlice {
    pub provider_id: String,
    pub total_requests: i64,
}

/// The `GET /v1/logs/analytics` report. Field names and semantics follow the
/// Node `LogsLogic.getAnalytics` result, but snake_case rather than camelCase.
#[derive(Debug, Serialize)]
pub struct AnalyticsReport {
    pub object: &'static str,
    pub window: &'static str,
    pub bucket_size_ms: i64,
    pub generated_at: i64,
    pub requests_per_second: f64,
    pub total_requests: i64,
    pub error_rate: f64,
    pub p95_latency_ms: i64,
    pub buckets: Vec<AnalyticsBucket>,
    pub top_models: Vec<AnalyticsTopModel>,
    pub top_agents: Vec<AnalyticsTopAgent>,
    pub providers: Vec<AnalyticsProviderSlice>,
}

/// Aggregates the window's traffic into buckets plus top models, agents, and
/// providers, matching `getAnalyticsDB` and the zero-fill in `getAnalytics`.
pub async fn analytics_report(
    database: &AppDatabase,
    window: AnalyticsWindow,
) -> Result<AnalyticsReport, APIError> {
    let pool = sqlite_pool(database)?;
    let now = now_ms();
    let bucket_size_ms = window.bucket_size_ms;
    let since = now - bucket_size_ms * window.bucket_count;

    let bucket_rows = sqlx::query(
        "SELECT CAST(created_at / ? AS INTEGER) * ? AS bucket, \
         COUNT(*) AS total_requests, \
         SUM(CASE WHEN status_code >= 200 AND status_code < 300 THEN 1 ELSE 0 END) AS success_requests, \
         SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) AS error_requests, \
         AVG(latency_ms) AS avg_latency_ms, \
         SUM(total_tokens) AS total_tokens, \
         SUM(prompt_tokens) AS prompt_tokens, \
         SUM(completion_tokens) AS completion_tokens, \
         SUM(cached_tokens) AS cached_tokens \
         FROM request_logs WHERE created_at >= ? GROUP BY bucket ORDER BY bucket ASC",
    )
    .bind(bucket_size_ms)
    .bind(bucket_size_ms)
    .bind(since)
    .fetch_all(pool)
    .await
    .map_err(|error| {
        APIError::new(
            500,
            constants::database::could_not_aggregate_request_logs(&error),
        )
    })?;

    let mut raw: HashMap<i64, AnalyticsBucket> = HashMap::new();
    for row in &bucket_rows {
        let bucket_start: i64 = row.try_get("bucket").map_err(log_row_error)?;
        raw.insert(
            bucket_start,
            AnalyticsBucket {
                bucket_start,
                total_requests: row.try_get("total_requests").map_err(log_row_error)?,
                success_requests: row.try_get("success_requests").map_err(log_row_error)?,
                error_requests: row.try_get("error_requests").map_err(log_row_error)?,
                avg_latency_ms: row
                    .try_get::<Option<f64>, _>("avg_latency_ms")
                    .map_err(log_row_error)?
                    .unwrap_or(0.0),
                total_tokens: row.try_get("total_tokens").map_err(log_row_error)?,
                prompt_tokens: row.try_get("prompt_tokens").map_err(log_row_error)?,
                completion_tokens: row.try_get("completion_tokens").map_err(log_row_error)?,
                cached_tokens: row.try_get("cached_tokens").map_err(log_row_error)?,
            },
        );
    }

    let mut buckets = Vec::with_capacity(window.bucket_count as usize);
    let mut cursor = since.div_euclid(bucket_size_ms) * bucket_size_ms;
    while cursor < now {
        buckets.push(
            raw.remove(&cursor)
                .unwrap_or_else(|| AnalyticsBucket::empty(cursor)),
        );
        cursor += bucket_size_ms;
    }

    let total_requests: i64 = buckets.iter().map(|bucket| bucket.total_requests).sum();
    let total_errors: i64 = buckets.iter().map(|bucket| bucket.error_requests).sum();
    let error_rate = if total_requests > 0 {
        ((total_errors as f64 / total_requests as f64) * 1000.0).round() / 1000.0
    } else {
        0.0
    };

    let model_rows = sqlx::query(
        "SELECT model, COUNT(*) AS total_requests, SUM(total_tokens) AS total_tokens, \
         SUM(estimated_cost) AS est_cost FROM request_logs WHERE created_at >= ? \
         GROUP BY model ORDER BY total_requests DESC LIMIT 10",
    )
    .bind(since)
    .fetch_all(pool)
    .await
    .map_err(|error| {
        APIError::new(
            500,
            constants::database::could_not_aggregate_request_logs_by_model(&error),
        )
    })?;
    let top_models = model_rows
        .iter()
        .map(|row| {
            Ok(AnalyticsTopModel {
                model: row.try_get("model").map_err(log_row_error)?,
                total_requests: row.try_get("total_requests").map_err(log_row_error)?,
                total_tokens: row.try_get("total_tokens").map_err(log_row_error)?,
                est_cost: row.try_get("est_cost").map_err(log_row_error)?,
            })
        })
        .collect::<Result<Vec<_>, APIError>>()?;

    let agent_rows = sqlx::query(
        "SELECT COALESCE(user_agent, 'Unknown') AS user_agent, COUNT(*) AS total_requests, \
         SUM(total_tokens) AS total_tokens FROM request_logs WHERE created_at >= ? \
         GROUP BY user_agent ORDER BY total_requests DESC LIMIT 10",
    )
    .bind(since)
    .fetch_all(pool)
    .await
    .map_err(|error| {
        APIError::new(
            500,
            constants::database::could_not_aggregate_request_logs(&error),
        )
    })?;
    let top_agents = agent_rows
        .iter()
        .map(|row| {
            let agent: String = row.try_get("user_agent").map_err(log_row_error)?;
            Ok(AnalyticsTopAgent {
                raw_user_agent: agent.clone(),
                agent,
                total_requests: row.try_get("total_requests").map_err(log_row_error)?,
                total_tokens: row.try_get("total_tokens").map_err(log_row_error)?,
            })
        })
        .collect::<Result<Vec<_>, APIError>>()?;

    let provider_rows = sqlx::query(
        "SELECT provider_id, COUNT(*) AS total_requests FROM request_logs WHERE created_at >= ? \
         GROUP BY provider_id ORDER BY total_requests DESC",
    )
    .bind(since)
    .fetch_all(pool)
    .await
    .map_err(|error| {
        APIError::new(
            500,
            constants::database::could_not_aggregate_request_logs(&error),
        )
    })?;
    let providers = provider_rows
        .iter()
        .map(|row| {
            Ok(AnalyticsProviderSlice {
                provider_id: row.try_get("provider_id").map_err(log_row_error)?,
                total_requests: row.try_get("total_requests").map_err(log_row_error)?,
            })
        })
        .collect::<Result<Vec<_>, APIError>>()?;

    let window_count: i64 =
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM request_logs WHERE created_at >= ?")
            .bind(since)
            .fetch_one(pool)
            .await
            .map_err(|error| {
                APIError::new(
                    500,
                    constants::database::could_not_count_request_logs(&error),
                )
            })?;
    // Node computes `CAST(COUNT(*) * 0.95 AS BIGINT) - 1`; a negative offset is
    // treated as zero by SQLite, which keeps the single-row case identical.
    let offset = (window_count as f64 * 0.95) as i64 - 1;
    let p95_latency_ms: i64 = sqlx::query_scalar::<_, i64>(
        "SELECT latency_ms FROM request_logs WHERE created_at >= ? \
         ORDER BY latency_ms LIMIT 1 OFFSET ?",
    )
    .bind(since)
    .bind(offset)
    .fetch_optional(pool)
    .await
    .map_err(|error| {
        APIError::new(
            500,
            constants::database::could_not_aggregate_request_logs(&error),
        )
    })?
    .unwrap_or(0);

    let recent_count: i64 =
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM request_logs WHERE created_at >= ?")
            .bind(now - 60_000)
            .fetch_one(pool)
            .await
            .map_err(|error| {
                APIError::new(
                    500,
                    constants::database::could_not_count_request_logs(&error),
                )
            })?;
    let requests_per_second = ((recent_count as f64 / 60.0) * 100.0).round() / 100.0;

    Ok(AnalyticsReport {
        object: "analytics",
        window: window.name,
        bucket_size_ms,
        generated_at: now,
        requests_per_second,
        total_requests,
        error_rate,
        p95_latency_ms,
        buckets,
        top_models,
        top_agents,
        providers,
    })
}

fn sqlite_pool(database: &AppDatabase) -> Result<&SqlitePool, APIError> {
    database
        .sqlite_pool()
        .ok_or_else(|| APIError::new(500, constants::database::REQUEST_LOGS_UNSUPPORTED))
}

fn map_request_log(row: &sqlx::sqlite::SqliteRow) -> Result<RequestLog, APIError> {
    let id: String = row.try_get("id").map_err(log_row_error)?;
    let request_id: String = row.try_get("request_id").map_err(log_row_error)?;
    let provider_id: Option<String> = row.try_get("provider_id").map_err(log_row_error)?;
    let status_code: i64 = row.try_get("status_code").map_err(log_row_error)?;
    Ok(RequestLog {
        id: Uuid::parse_str(&id).map_err(log_row_error)?,
        request_id: Uuid::parse_str(&request_id).map_err(log_row_error)?,
        user_id: optional_uuid(row, "user_id")?,
        api_key_id: optional_uuid(row, "api_key_id")?,
        method: row.try_get("method").map_err(log_row_error)?,
        path: row.try_get("path").map_err(log_row_error)?,
        status_code: i16::try_from(status_code).map_err(|error| {
            APIError::new(500, constants::database::log_status_code_invalid(error))
        })?,
        ip_address: row.try_get("ip_address").map_err(log_row_error)?,
        user_agent: row.try_get("user_agent").map_err(log_row_error)?,
        provider: provider_id,
        model: row.try_get("model").map_err(log_row_error)?,
        input_tokens: row.try_get("prompt_tokens").map_err(log_row_error)?,
        output_tokens: row.try_get("completion_tokens").map_err(log_row_error)?,
        total_tokens: row.try_get("total_tokens").map_err(log_row_error)?,
        latency_ms: row.try_get("latency_ms").map_err(log_row_error)?,
        error_code: row.try_get("error_code").map_err(log_row_error)?,
        error_message: row.try_get("error_message").map_err(log_row_error)?,
    })
}

fn optional_uuid(row: &sqlx::sqlite::SqliteRow, field: &str) -> Result<Option<Uuid>, APIError> {
    row.try_get::<Option<String>, _>(field)
        .map_err(log_row_error)?
        .map(|value| Uuid::parse_str(&value).map_err(log_row_error))
        .transpose()
}

fn log_row_error(error: impl std::fmt::Display) -> APIError {
    APIError::new(500, constants::database::could_not_map_request_log(&error))
}

pub struct RequestLogInput<'a> {
    pub request_id: &'a str,
    pub method: &'a str,
    pub path: &'a str,
    pub api_key_id: Option<&'a str>,
    pub ip_address: Option<&'a str>,
    pub user_agent: Option<&'a str>,
    pub provider_id: &'a str,
    pub model: &'a str,
    pub status_code: u16,
    pub latency_ms: i64,
    pub usage: &'a UsageBreakdown,
    pub estimated_cost: f64,
    pub fallback_occurred: bool,
    pub fallback_path: Option<&'a str>,
    pub fallback_reason: Option<&'a str>,
    pub resolved_model: Option<&'a str>,
    pub error_code: Option<&'a str>,
    pub error_message: Option<&'a str>,
    pub created_at: i64,
}

pub fn generate_log_id() -> Result<String, APIError> {
    let mut bytes = [0_u8; 16];
    getrandom::fill(&mut bytes).map_err(|error| {
        APIError::new(500, constants::database::could_not_generate_log_uuid(error))
    })?;
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    Ok(Uuid::from_bytes(bytes).to_string())
}

pub async fn insert_request_log(
    database: &AppDatabase,
    input: RequestLogInput<'_>,
) -> Result<String, APIError> {
    let Some(pool) = database.sqlite_pool() else {
        return Err(APIError::new(
            500,
            constants::database::REQUEST_LOGS_UNSUPPORTED,
        ));
    };
    let log_id = generate_log_id()?;
    let log_uuid = Uuid::parse_str(&log_id)
        .map_err(|error| APIError::new(500, constants::database::log_uuid_invalid(&error)))?;
    let request_id = Uuid::parse_str(input.request_id)
        .map_err(|error| APIError::new(500, constants::database::request_id_invalid(&error)))?
        .to_string();
    sqlx::query(
        "INSERT INTO request_logs (
            id, request_id, method, path, api_key_id, ip_address, user_agent,
            provider_id, model, prompt_tokens, completion_tokens, total_tokens,
            status_code, latency_ms, cached_tokens, cache_creation_tokens, reasoning_tokens,
            estimated_cost, fallback_occurred, fallback_path, fallback_reason, resolved_model,
            error_code, error_message, legacy_api_key_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&log_id)
    .bind(request_id)
    .bind(input.method)
    .bind(input.path)
    .bind(
        input
            .api_key_id
            .and_then(|id| Uuid::parse_str(id).ok())
            .map(|id| id.to_string()),
    )
    .bind(input.ip_address)
    .bind(input.user_agent)
    .bind(input.provider_id)
    .bind(input.model)
    .bind(input.usage.prompt_tokens)
    .bind(input.usage.completion_tokens)
    .bind(input.usage.total_tokens)
    .bind(i64::from(input.status_code))
    .bind(input.latency_ms)
    .bind(input.usage.cached_tokens)
    .bind(input.usage.cache_creation_tokens)
    .bind(input.usage.reasoning_tokens)
    .bind(input.estimated_cost)
    .bind(i64::from(input.fallback_occurred))
    .bind(input.fallback_path)
    .bind(input.fallback_reason)
    .bind(input.resolved_model)
    .bind(input.error_code)
    .bind(input.error_message)
    .bind(input.api_key_id.filter(|id| Uuid::parse_str(id).is_err()))
    .bind(input.created_at)
    .execute(pool)
    .await
    .map_err(|error| {
        APIError::new(
            500,
            constants::database::could_not_insert_request_log(&error),
        )
    })?;

    if let Some(key_id) = input.api_key_id
        && (input.usage.total_tokens > 0 || input.estimated_cost > 0.0)
    {
        let _ = sqlx::query(
                "UPDATE api_keys SET usage_tokens = usage_tokens + ?, usage_cost = usage_cost + ? WHERE id = ?",
            )
            .bind(input.usage.total_tokens)
            .bind(input.estimated_cost)
            .bind(key_id)
            .execute(pool)
            .await;
    }
    publish_request_log(log_uuid);
    Ok(log_id)
}
