//! Request-log rows: the wire shape, the newest-first listing, the live event
//! stream, and the insert path.

use std::sync::OnceLock;

use serde::Serialize;
use sqlx::Row;
use uuid::Uuid;

use crate::constants;
use crate::error::APIError;
use crate::infrastructure::database::AppDatabase;
use crate::protocol::usage::UsageBreakdown;

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
    pub cached_tokens: Option<i64>,
    pub cache_creation_tokens: Option<i64>,
    pub reasoning_tokens: Option<i64>,
    pub estimated_cost: Option<f64>,
    pub resolved_model: Option<String>,
    pub fallback_occurred: Option<bool>,
    pub fallback_path: Option<String>,
    pub fallback_reason: Option<String>,
    pub latency_ms: i64,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
    pub created_at: i64,
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
    let pool = database.sqlite_required(constants::database::REQUEST_LOGS_UNSUPPORTED)?;
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
        .fetch_optional(database.sqlite_required(constants::database::REQUEST_LOGS_UNSUPPORTED)?)
        .await
        .map_err(|error| {
            APIError::new(500, constants::database::could_not_read_request_log(&error))
        })?;
    row.as_ref().map(map_request_log).transpose()
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
        cached_tokens: row.try_get("cached_tokens").map_err(log_row_error)?,
        cache_creation_tokens: row
            .try_get("cache_creation_tokens")
            .map_err(log_row_error)?,
        reasoning_tokens: row.try_get("reasoning_tokens").map_err(log_row_error)?,
        estimated_cost: row.try_get("estimated_cost").map_err(log_row_error)?,
        resolved_model: row.try_get("resolved_model").map_err(log_row_error)?,
        fallback_occurred: row
            .try_get::<Option<i64>, _>("fallback_occurred")
            .map_err(log_row_error)?
            .map(|value| value != 0),
        fallback_path: row.try_get("fallback_path").map_err(log_row_error)?,
        fallback_reason: row.try_get("fallback_reason").map_err(log_row_error)?,
        latency_ms: row.try_get("latency_ms").map_err(log_row_error)?,
        error_code: row.try_get("error_code").map_err(log_row_error)?,
        error_message: row.try_get("error_message").map_err(log_row_error)?,
        created_at: row.try_get("created_at").map_err(log_row_error)?,
    })
}

fn optional_uuid(row: &sqlx::sqlite::SqliteRow, field: &str) -> Result<Option<Uuid>, APIError> {
    row.try_get::<Option<String>, _>(field)
        .map_err(log_row_error)?
        .map(|value| Uuid::parse_str(&value).map_err(log_row_error))
        .transpose()
}

pub(super) fn log_row_error(error: impl std::fmt::Display) -> APIError {
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
