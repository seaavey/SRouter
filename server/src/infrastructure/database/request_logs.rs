//! Persistence store for request logs and usage metrics.

use crate::error::APIError;
use crate::features::gateway::usage::UsageBreakdown;
use crate::infrastructure::database::AppDatabase;

/// Payload for recording an operational request execution log.
pub struct RequestLogInput<'a> {
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
    pub created_at: i64,
}

/// Generates a random log id with `log_` prefix matching schema conventions.
pub fn generate_log_id() -> Result<String, APIError> {
    let mut bytes = [0u8; 12];
    getrandom::fill(&mut bytes).map_err(|error| {
        APIError::new(
            500,
            format!("could not generate secure random bytes: {error}"),
        )
    })?;

    Ok(format!("log_{}", hex::encode(bytes)))
}

/// Appends a new request log to the database and increments API key usage if applicable.
pub async fn insert_request_log(
    database: &AppDatabase,
    input: RequestLogInput<'_>,
) -> Result<String, APIError> {
    let Some(pool) = database.sqlite_pool() else {
        // PostgreSQL path is untouched until its version carrier lands.
        return Ok(String::new());
    };

    let log_id = generate_log_id()?;

    sqlx::query(
        "INSERT INTO request_logs (
            id, api_key_id, ip_address, user_agent, provider_id, model,
            prompt_tokens, completion_tokens, total_tokens, status_code, latency_ms,
            cached_tokens, cache_creation_tokens, reasoning_tokens, estimated_cost,
            fallback_occurred, fallback_path, fallback_reason, resolved_model, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&log_id)
    .bind(input.api_key_id)
    .bind(input.ip_address)
    .bind(input.user_agent)
    .bind(input.provider_id)
    .bind(input.model)
    .bind(input.usage.prompt_tokens)
    .bind(input.usage.completion_tokens)
    .bind(input.usage.total_tokens)
    .bind(input.status_code as i64)
    .bind(input.latency_ms)
    .bind(input.usage.cached_tokens)
    .bind(input.usage.cache_creation_tokens)
    .bind(input.usage.reasoning_tokens)
    .bind(input.estimated_cost)
    .bind(if input.fallback_occurred { 1i64 } else { 0i64 })
    .bind(input.fallback_path)
    .bind(input.fallback_reason)
    .bind(input.resolved_model)
    .bind(input.created_at)
    .execute(pool)
    .await
    .map_err(|error| APIError::new(500, format!("could not insert request log: {error}")))?;

    if let Some(key_id) = input.api_key_id {
        if input.usage.total_tokens > 0 || input.estimated_cost > 0.0 {
            let _ = sqlx::query(
                "UPDATE api_keys SET usage_tokens = usage_tokens + ?, usage_cost = usage_cost + ? WHERE id = ?",
            )
            .bind(input.usage.total_tokens)
            .bind(input.estimated_cost)
            .bind(key_id)
            .execute(pool)
            .await;
        }
    }

    Ok(log_id)
}
