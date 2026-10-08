//! Aggregated views over the request log: the all-time usage totals and the
//! windowed analytics report.

use std::collections::HashMap;

use serde::Serialize;
use sqlx::Row;

use crate::clock::now_ms;
use crate::constants;
use crate::error::APIError;
use crate::infrastructure::database::AppDatabase;

use super::store::{ObjectKind, log_row_error};

/// The all-time usage totals served by `GET /v1/logs/stats` and carried by the
/// `usage.updated` event. The wire keys are snake_case, as documented in
/// `docs/api-v1-contract.md`, "Logs in the Rust build".
///
/// The counters are grouped instead of flat, so the report reads as
/// `{ object, data: { totals, by_model } }` rather than a dozen loose numbers
/// sitting beside the discriminator.
#[derive(Debug, Serialize, specta::Type)]
pub struct UsageStatsReport {
    pub object: ObjectKind,
    pub data: UsageData,
}

#[derive(Debug, Serialize, specta::Type)]
pub struct UsageData {
    pub totals: UsageTotals,
    pub by_model: Vec<UsageByModel>,
}

/// Every counter [`UsageStatsReport`] aggregates over the request log, grouped by
/// what it counts. Each group drops the `total_` prefix of the flat shape,
/// because the field it lives under already says it.
#[derive(Debug, Serialize, specta::Type)]
pub struct UsageTotals {
    pub requests: UsageRequestTotals,
    pub tokens: UsageTokenTotals,
    pub cost: UsageCostTotals,
}

#[derive(Debug, Serialize, specta::Type)]
pub struct UsageRequestTotals {
    #[specta(type = specta_typescript::Number)]
    pub total: i64,
    #[specta(type = specta_typescript::Number)]
    pub success: i64,
    #[specta(type = specta_typescript::Number)]
    pub failed: i64,
}

#[derive(Debug, Serialize, specta::Type)]
pub struct UsageTokenTotals {
    #[specta(type = specta_typescript::Number)]
    pub input: i64,
    #[specta(type = specta_typescript::Number)]
    pub output: i64,
    #[specta(type = specta_typescript::Number)]
    pub total: i64,
    #[specta(type = specta_typescript::Number)]
    pub reasoning: i64,
    pub cache: UsageCacheTokens,
}

/// Cache tokens split by direction: `write` is what the provider had to store
/// (`cache_creation_tokens`), `read` is what it served back (`cached_tokens`).
#[derive(Debug, Serialize, specta::Type)]
pub struct UsageCacheTokens {
    #[specta(type = specta_typescript::Number)]
    pub write: i64,
    #[specta(type = specta_typescript::Number)]
    pub read: i64,
}

/// The logged cost. Only the sum is stored per request, so `total` is the whole
/// breakdown the database can honestly report; `label` is the display form and
/// `estimated` flags that it is an estimate.
#[derive(Debug, Serialize, specta::Type)]
pub struct UsageCostTotals {
    pub total: f64,
    pub label: String,
    pub estimated: bool,
}

/// One `by_model` entry of [`UsageStatsReport`].
#[derive(Debug, Serialize, specta::Type)]
pub struct UsageByModel {
    pub model: String,
    #[specta(type = specta_typescript::Number)]
    pub total_requests: i64,
    #[specta(type = specta_typescript::Number)]
    pub total_input_tokens: i64,
    #[specta(type = specta_typescript::Number)]
    pub total_output_tokens: i64,
    #[specta(type = specta_typescript::Number)]
    pub total_cached_tokens: i64,
    pub est_cost: f64,
}

pub async fn usage_stats(database: &AppDatabase) -> Result<UsageStatsReport, APIError> {
    let row = sqlx::query(
        "SELECT COUNT(*) AS total_requests, \
         COALESCE(SUM(CASE WHEN status_code >= 200 AND status_code < 300 THEN 1 ELSE 0 END), 0) AS successes, \
         COALESCE(SUM(CASE WHEN status_code < 200 OR status_code >= 300 THEN 1 ELSE 0 END), 0) AS failures, \
         COALESCE(SUM(total_tokens), 0) AS total_tokens, \
         COALESCE(SUM(prompt_tokens), 0) AS input_tokens, \
         COALESCE(SUM(completion_tokens), 0) AS output_tokens, \
         COALESCE(SUM(cached_tokens), 0) AS cached_tokens, \
         COALESCE(SUM(cache_creation_tokens), 0) AS cache_creation_tokens, \
         COALESCE(SUM(reasoning_tokens), 0) AS reasoning_tokens, \
         CAST(COALESCE(SUM(estimated_cost), 0) AS REAL) AS estimated_cost \
         FROM request_logs",
    )
    .fetch_one(&database.sqlite_required(constants::database::REQUEST_LOGS_UNSUPPORTED)?)
    .await
    .map_err(|error| APIError::new(500, constants::database::could_not_aggregate_request_logs(&error)))?;
    let total_requests: i64 = row.try_get("total_requests").map_err(log_row_error)?;
    let successes: i64 = row.try_get("successes").map_err(log_row_error)?;
    let failures: i64 = row.try_get("failures").map_err(log_row_error)?;
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
    .fetch_all(&database.sqlite_required(constants::database::REQUEST_LOGS_UNSUPPORTED)?)
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
            Ok(UsageByModel {
                model: row.try_get::<String, _>("model").map_err(log_row_error)?,
                total_requests: row.try_get("total_requests").map_err(log_row_error)?,
                total_input_tokens: row.try_get("input_tokens").map_err(log_row_error)?,
                total_output_tokens: row.try_get("output_tokens").map_err(log_row_error)?,
                total_cached_tokens: row.try_get("cached_tokens").map_err(log_row_error)?,
                est_cost: row.try_get("estimated_cost").map_err(log_row_error)?,
            })
        })
        .collect::<Result<Vec<_>, APIError>>()?;
    Ok(UsageStatsReport {
        object: ObjectKind::Usage,
        data: UsageData {
            totals: UsageTotals {
                requests: UsageRequestTotals {
                    total: total_requests,
                    success: successes,
                    failed: failures,
                },
                tokens: UsageTokenTotals {
                    input: input_tokens,
                    output: output_tokens,
                    total: total_tokens,
                    reasoning: reasoning_tokens,
                    cache: UsageCacheTokens {
                        write: cache_creation_tokens,
                        read: cached_tokens,
                    },
                },
                cost: UsageCostTotals {
                    total: estimated_cost,
                    label: format!("${estimated_cost:.4}"),
                    estimated: true,
                },
            },
            by_model,
        },
    })
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
#[derive(Debug, Serialize, specta::Type)]
pub struct AnalyticsBucket {
    #[specta(type = specta_typescript::Number)]
    pub bucket_start: i64,
    #[specta(type = specta_typescript::Number)]
    pub total_requests: i64,
    #[specta(type = specta_typescript::Number)]
    pub success_requests: i64,
    #[specta(type = specta_typescript::Number)]
    pub error_requests: i64,
    #[specta(type = Option<specta_typescript::Number>)]
    pub avg_latency_ms: f64,
    #[specta(type = specta_typescript::Number)]
    pub total_tokens: i64,
    #[specta(type = specta_typescript::Number)]
    pub prompt_tokens: i64,
    #[specta(type = specta_typescript::Number)]
    pub completion_tokens: i64,
    #[specta(type = specta_typescript::Number)]
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

#[derive(Debug, Serialize, specta::Type)]
pub struct AnalyticsTopModel {
    pub model: Option<String>,
    #[specta(type = specta_typescript::Number)]
    pub total_requests: i64,
    #[specta(type = specta_typescript::Number)]
    pub total_tokens: i64,
    pub est_cost: f64,
}

#[derive(Debug, Serialize, specta::Type)]
pub struct AnalyticsTopAgent {
    pub agent: String,
    pub raw_user_agent: String,
    #[specta(type = specta_typescript::Number)]
    pub total_requests: i64,
    #[specta(type = specta_typescript::Number)]
    pub total_tokens: i64,
}

#[derive(Debug, Serialize, specta::Type)]
pub struct AnalyticsProviderSlice {
    pub provider_id: String,
    #[specta(type = specta_typescript::Number)]
    pub total_requests: i64,
}

/// The `GET /v1/logs/analytics` report. Field names and semantics follow the
/// Node `LogsLogic.getAnalytics` result, but snake_case rather than camelCase.
#[derive(Debug, Serialize, specta::Type)]
pub struct AnalyticsReport {
    pub object: &'static str,
    pub window: &'static str,
    #[specta(type = specta_typescript::Number)]
    pub bucket_size_ms: i64,
    #[specta(type = specta_typescript::Number)]
    pub generated_at: i64,
    pub requests_per_second: f64,
    #[specta(type = specta_typescript::Number)]
    pub total_requests: i64,
    pub error_rate: f64,
    #[specta(type = specta_typescript::Number)]
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
    let pool = database.sqlite_required(constants::database::REQUEST_LOGS_UNSUPPORTED)?;
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
    .fetch_all(&pool)
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
    .fetch_all(&pool)
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
    .fetch_all(&pool)
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
    .fetch_all(&pool)
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
            .fetch_one(&pool)
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
    .fetch_optional(&pool)
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
            .fetch_one(&pool)
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
