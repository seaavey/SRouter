//! Quota checker feature providing provider OAuth quota data.
//!
//! Exposes `GET /v1/quota` and the retained compatibility misspelling `GET /v1/qouta`.
//! Legacy evidence and contract:
//! - `docs/api-v1-contract.md` row 94 (`/v1/quota`, `/v1/qouta` (GET), API-key auth).
//! - `apps/api/src/routes/v1/quota.ts` (route definitions).
//! - `apps/api/src/logic/quota.logic.ts` (60s caching, in-flight coalescing, OAuth provider filtering).
//! - `packages/providers/src/quota/openai-codex.ts` (`wham/usage` API parsing).
//! - `packages/types/src/quota.ts` (QuotaResponse, ProviderQuotaAccount, LiveModelQuotaItem).
//! - `apps/api/tests/quota-oauth-filter.test.ts` (filter non-OAuth providers, graceful handling).

use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use axum::extract::{Query, State};
use axum::routing::get;
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use tokio::sync::{Mutex, RwLock};

use crate::error::APIError;
use crate::features::providers::codex::types::{CODEX_ORIGINATOR, CODEX_USER_AGENT};
use crate::infrastructure::database::AppDatabase;
use crate::infrastructure::database::providers::{
    ProviderForQuota, list_providers_for_quota, matches_base_id,
};
use crate::state::AppState;

/// Upstream usage endpoint for OpenAI Codex.
pub const CODEX_USAGE_URL: &str = "https://chatgpt.com/backend-api/wham/usage";

/// In-memory cache time-to-live matching Node oracle (60 seconds).
const CACHE_TTL_SECS: u64 = 60;

/// Top-level response for `GET /v1/quota` and `GET /v1/qouta`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuotaResponse {
    pub object: &'static str,
    #[serde(rename = "totalAccounts")]
    pub total_accounts: usize,
    pub providers: Vec<ProviderQuotaAccount>,
}

/// An account's quota overview.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderQuotaAccount {
    pub id: String,
    pub provider: String,
    pub account: String,
    pub enabled: bool,
    #[serde(rename = "quotaType")]
    pub quota_type: &'static str,
    #[serde(rename = "totalQuotas", skip_serializing_if = "Option::is_none")]
    pub total_quotas: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quotas: Option<Vec<LiveModelQuotaItem>>,
    #[serde(rename = "usageMetrics", skip_serializing_if = "Option::is_none")]
    pub usage_metrics: Option<Vec<serde_json::Value>>,
}

/// A specific rate-limit window or model quota entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LiveModelQuotaItem {
    pub name: String,
    pub used: u32,
    pub limit: u32,
    pub percentage: String,
    #[serde(rename = "percentageValue")]
    pub percentage_value: u32,
    #[serde(rename = "resetIn")]
    pub reset_in: String,
    #[serde(rename = "resetTime", skip_serializing_if = "Option::is_none")]
    pub reset_time: Option<String>,
    pub status: &'static str,
}

#[derive(Debug, Clone)]
struct RateLimitWindow {
    used_percent: f64,
    reset_at: Option<i64>,
    duration_seconds: Option<u64>,
    name: String,
}

#[derive(Debug, Deserialize)]
pub struct QuotaQueryParams {
    pub refresh: Option<String>,
    pub force: Option<String>,
}

struct CachedQuota {
    expires_at: Instant,
    data: QuotaResponse,
}

/// Thread-safe in-memory cache with concurrent request coalescing.
pub struct QuotaCache {
    inner: RwLock<Option<CachedQuota>>,
    coalesce_lock: Mutex<()>,
    usage_url_override: Option<String>,
}

impl Default for QuotaCache {
    fn default() -> Self {
        Self::new()
    }
}

impl QuotaCache {
    pub fn new() -> Self {
        Self {
            inner: RwLock::new(None),
            coalesce_lock: Mutex::new(()),
            usage_url_override: None,
        }
    }

    /// Creates a cache configured with an upstream URL override (used in test fixtures).
    pub fn with_usage_url(usage_url: String) -> Self {
        Self {
            inner: RwLock::new(None),
            coalesce_lock: Mutex::new(()),
            usage_url_override: Some(usage_url),
        }
    }

    /// Retrieves quota information, returning cached data if fresh and unforced.
    pub async fn get_quota_info(
        &self,
        database: Option<&AppDatabase>,
        force_refresh: bool,
    ) -> Result<QuotaResponse, APIError> {
        if !force_refresh {
            let read = self.inner.read().await;
            if let Some(cached) = &*read
                && Instant::now() < cached.expires_at
            {
                return Ok(cached.data.clone());
            }
        }

        // Stampede protection: coalesce simultaneous cache misses
        let _guard = self.coalesce_lock.lock().await;

        if !force_refresh {
            let read = self.inner.read().await;
            if let Some(cached) = &*read
                && Instant::now() < cached.expires_at
            {
                return Ok(cached.data.clone());
            }
        }

        let response = fetch_live_quota(database, self.usage_url_override.as_deref()).await?;

        let mut write = self.inner.write().await;
        *write = Some(CachedQuota {
            expires_at: Instant::now() + Duration::from_secs(CACHE_TTL_SECS),
            data: response.clone(),
        });

        Ok(response)
    }
}

/// Mounts `/quota` and the retained compatibility alias `/qouta`.
pub fn create_quota_router() -> Router<AppState> {
    Router::new()
        .route("/quota", get(get_quota))
        .route("/qouta", get(get_quota))
}

async fn get_quota(
    State(state): State<AppState>,
    Query(query): Query<QuotaQueryParams>,
) -> Result<Json<QuotaResponse>, APIError> {
    let force = query.refresh.as_deref() == Some("true") || query.force.as_deref() == Some("true");
    let result = state
        .quota_cache
        .get_quota_info(state.database.as_ref(), force)
        .await?;
    Ok(Json(result))
}

/// Inspects database for OAuth providers and fetches their live quotas concurrently.
async fn fetch_live_quota(
    database: Option<&AppDatabase>,
    usage_url_override: Option<&str>,
) -> Result<QuotaResponse, APIError> {
    let Some(database) = database else {
        return Ok(QuotaResponse {
            object: "quota",
            total_accounts: 0,
            providers: Vec::new(),
        });
    };

    let all_providers = list_providers_for_quota(database).await?;
    let oauth_providers: Vec<_> = all_providers
        .into_iter()
        .filter(is_oauth_provider)
        .collect();

    if oauth_providers.is_empty() {
        return Ok(QuotaResponse {
            object: "quota",
            total_accounts: 0,
            providers: Vec::new(),
        });
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .unwrap_or_default();

    let now_secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;

    let usage_url = usage_url_override.unwrap_or(CODEX_USAGE_URL);

    // Concurrently fetch quota across accounts with error isolation
    let fetch_futures = oauth_providers.iter().map(|provider| {
        let client = &client;
        async move {
            let driver = if provider.provider_id.is_empty() {
                &provider.id
            } else {
                &provider.provider_id
            };

            if matches_base_id(driver, "openai_codex") {
                match fetch_codex_quota(client, provider, usage_url, now_secs).await {
                    Ok(acc) => acc,
                    Err(err) => {
                        tracing::debug!(
                            provider_id = %provider.id,
                            error = %err,
                            "Codex quota fetch failed or was unavailable"
                        );
                        None
                    }
                }
            } else {
                // Other OAuth providers without live quota endpoints are safely omitted
                None
            }
        }
    });

    let results = futures_util::future::join_all(fetch_futures).await;
    let accounts: Vec<ProviderQuotaAccount> = results.into_iter().flatten().collect();

    Ok(QuotaResponse {
        object: "quota",
        total_accounts: accounts.len(),
        providers: accounts,
    })
}

/// Identifies providers eligible for OAuth quota inspection. Non-OAuth providers
/// (e.g. regular API keys) are filtered out.
pub(crate) fn is_oauth_provider(p: &ProviderForQuota) -> bool {
    if p.category == "oauth" {
        return true;
    }
    let driver = if p.provider_id.is_empty() {
        &p.id
    } else {
        &p.provider_id
    };
    matches_base_id(driver, "openai_codex")
        || matches_base_id(driver, "antigravity")
        || matches_base_id(driver, "codebuddy-cn")
}

/// Calls OpenAI Codex usage endpoint and extracts rate limit windows.
async fn fetch_codex_quota(
    client: &reqwest::Client,
    provider: &ProviderForQuota,
    usage_url: &str,
    now_secs: i64,
) -> Result<Option<ProviderQuotaAccount>, APIError> {
    let credentials: serde_json::Value = serde_json::from_str(&provider.credentials_raw)
        .map_err(|e| APIError::new(500, format!("Invalid credentials JSON: {e}")))?;

    let access_token = credentials
        .get("access_token")
        .or_else(|| credentials.get("accessToken"))
        .and_then(|v| v.as_str())
        .unwrap_or("");

    if access_token.is_empty() {
        return Ok(None);
    }

    let account_id = credentials
        .get("account_id")
        .or_else(|| credentials.get("accountId"))
        .and_then(|v| v.as_str());

    let mut request = client
        .get(usage_url)
        .header("authorization", format!("Bearer {access_token}"))
        .header("accept", "application/json")
        .header("user-agent", CODEX_USER_AGENT)
        .header("originator", CODEX_ORIGINATOR);

    if let Some(acct) = account_id
        && !acct.is_empty()
    {
        request = request.header("chatgpt-account-id", acct);
    }

    let res = request
        .send()
        .await
        .map_err(|e| APIError::new(502, format!("Codex quota request failed: {e}")))?;

    if !res.status().is_success() {
        return Err(APIError::new(
            502,
            format!("Codex quota upstream HTTP {}", res.status()),
        ));
    }

    let payload: serde_json::Value = res
        .json()
        .await
        .map_err(|e| APIError::new(502, format!("Invalid Codex quota response: {e}")))?;

    let windows = get_windows(&payload);
    if windows.is_empty() {
        return Ok(None);
    }

    let quotas: Vec<LiveModelQuotaItem> = windows
        .into_iter()
        .map(|window| {
            let used = window.used_percent.clamp(0.0, 100.0).round() as u32;
            let remaining = (100.0 - window.used_percent).clamp(0.0, 100.0).round() as u32;
            let reset_time = window.reset_at.map(format_iso8601);
            let reset_in = format_reset_in(window.reset_at, now_secs);
            let status = if remaining <= 5 {
                "exhausted"
            } else if remaining <= 20 {
                "warning"
            } else {
                "ok"
            };

            LiveModelQuotaItem {
                name: format!("Codex {}", get_window_label(&window)),
                used,
                limit: 100,
                percentage: format!("{remaining}%"),
                percentage_value: remaining,
                reset_in,
                reset_time,
                status,
            }
        })
        .collect();

    let plan_type = payload
        .get("plan_type")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty());

    let provider_title = match plan_type {
        Some(plan) => format!("OpenAI Codex ({plan})"),
        None => "OpenAI Codex".to_string(),
    };

    Ok(Some(ProviderQuotaAccount {
        id: provider.id.clone(),
        provider: provider_title,
        account: if provider.name.is_empty() {
            "OpenAI Codex Account".to_string()
        } else {
            provider.name.clone()
        },
        enabled: provider.enabled,
        quota_type: "live_provider_quota",
        total_quotas: Some(quotas.len()),
        quotas: Some(quotas),
        usage_metrics: None,
    }))
}

fn read_number(val: Option<&serde_json::Value>) -> Option<f64> {
    match val {
        Some(serde_json::Value::Number(n)) => n.as_f64(),
        Some(serde_json::Value::String(s)) => s.trim().parse::<f64>().ok(),
        _ => None,
    }
}

fn read_window(value: &serde_json::Value, name: &str) -> Option<RateLimitWindow> {
    let obj = value.as_object()?;
    let used_percent = read_number(obj.get("used_percent").or_else(|| obj.get("usedPercent")))?;

    let reset_at = read_number(
        obj.get("reset_at")
            .or_else(|| obj.get("resets_at"))
            .or_else(|| obj.get("resetAt"))
            .or_else(|| obj.get("resetsAt")),
    )
    .map(|n| n as i64);

    let duration_seconds = read_number(
        obj.get("limit_window_seconds")
            .or_else(|| obj.get("limitWindowSeconds"))
            .or_else(|| obj.get("window_duration_seconds"))
            .or_else(|| obj.get("windowDurationSeconds")),
    )
    .map(|n| n as u64)
    .or_else(|| {
        read_number(
            obj.get("window_minutes")
                .or_else(|| obj.get("window_duration_mins"))
                .or_else(|| obj.get("windowDurationMins")),
        )
        .map(|mins| (mins * 60.0) as u64)
    });

    Some(RateLimitWindow {
        used_percent: used_percent.clamp(0.0, 100.0),
        reset_at,
        duration_seconds,
        name: name.to_string(),
    })
}

fn get_windows(payload: &serde_json::Value) -> Vec<RateLimitWindow> {
    let mut result: Vec<RateLimitWindow> = Vec::new();
    let mut candidates: Vec<(String, &serde_json::Value)> = Vec::new();

    if let Some(rate_limit) = payload
        .get("rate_limit")
        .or_else(|| payload.get("rateLimits"))
    {
        if let Some(primary) = rate_limit
            .get("primary_window")
            .or_else(|| rate_limit.get("primary"))
        {
            candidates.push(("5-hour".to_string(), primary));
        }
        if let Some(secondary) = rate_limit
            .get("secondary_window")
            .or_else(|| rate_limit.get("secondary"))
        {
            candidates.push(("Weekly".to_string(), secondary));
        }
    }

    if let Some(by_id) = payload
        .get("rate_limits_by_limit_id")
        .or_else(|| payload.get("rateLimitsByLimitId"))
        .and_then(|v| v.as_object())
    {
        for (limit_id, val) in by_id {
            if let Some(primary) = val.get("primary_window").or_else(|| val.get("primary")) {
                candidates.push((limit_id.clone(), primary));
            }
        }
    }

    for (name, val) in candidates {
        if let Some(window) = read_window(val, &name)
            && !result.iter().any(|item| item.name == window.name)
        {
            result.push(window);
        }
    }

    result
}

fn get_window_label(window: &RateLimitWindow) -> String {
    let Some(secs) = window.duration_seconds else {
        return window.name.clone();
    };
    if secs == 0 {
        return window.name.clone();
    }

    let hours = secs as f64 / 3600.0;
    if (4.0..=6.0).contains(&hours) {
        return "5-hour".to_string();
    }

    let days = secs as f64 / 86400.0;
    if (6.0..=8.0).contains(&days) {
        return "Weekly".to_string();
    }
    if (27.0..=31.0).contains(&days) {
        return "Monthly".to_string();
    }
    if days >= 1.0 && secs % 86400 == 0 {
        return format!("{}-day", days as u64);
    }
    if hours >= 1.0 && secs % 3600 == 0 {
        return format!("{}-hour", hours as u64);
    }

    format!("{}-minute", (secs / 60).max(1))
}

/// Formats the remaining duration until reset, mirroring Node's `formatResetIn`.
pub fn format_reset_in(reset_at: Option<i64>, now_secs: i64) -> String {
    let Some(reset_at) = reset_at else {
        return "24h 0m".to_string();
    };

    let diff = reset_at - now_secs;
    if diff <= 0 {
        return "0m".to_string();
    }

    let days = diff / 86400;
    let hours = (diff % 86400) / 3600;
    let minutes = (diff % 3600) / 60;

    if days > 0 {
        format!("{days}d {hours}h")
    } else if hours > 0 {
        format!("{hours}h {minutes}m")
    } else {
        format!("{minutes}m")
    }
}

/// Converts Unix epoch seconds to an ISO8601 UTC timestamp string.
pub fn format_iso8601(secs: i64) -> String {
    let mut days = secs / 86400;
    let mut day_secs = secs % 86400;
    if day_secs < 0 {
        days -= 1;
        day_secs += 86400;
    }
    let hours = day_secs / 3600;
    let minutes = (day_secs % 3600) / 60;
    let seconds = day_secs % 60;

    let z = days + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as u32;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = (yoe as i64) + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };

    format!("{y:04}-{m:02}-{d:02}T{hours:02}:{minutes:02}:{seconds:02}Z")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn format_reset_in_parses_various_offsets() {
        let now = 1000000;
        assert_eq!(format_reset_in(None, now), "24h 0m");
        assert_eq!(format_reset_in(Some(now - 100), now), "0m");
        assert_eq!(format_reset_in(Some(now), now), "0m");
        assert_eq!(format_reset_in(Some(now + 45), now), "0m");
        assert_eq!(format_reset_in(Some(now + 65), now), "1m");
        assert_eq!(format_reset_in(Some(now + 3600 + 120), now), "1h 2m");
        assert_eq!(
            format_reset_in(Some(now + 86400 * 2 + 3600 * 5), now),
            "2d 5h"
        );
    }

    #[test]
    fn format_iso8601_renders_utc_strings() {
        assert_eq!(format_iso8601(0), "1970-01-01T00:00:00Z");
        assert_eq!(format_iso8601(1759508316), "2025-10-03T16:18:36Z");
    }

    #[test]
    fn get_window_label_maps_durations() {
        let make_win = |secs: Option<u64>, name: &str| RateLimitWindow {
            used_percent: 0.0,
            reset_at: None,
            duration_seconds: secs,
            name: name.to_string(),
        };

        assert_eq!(get_window_label(&make_win(Some(18000), "custom")), "5-hour");
        assert_eq!(
            get_window_label(&make_win(Some(604800), "custom")),
            "Weekly"
        );
        assert_eq!(
            get_window_label(&make_win(Some(86400 * 30), "custom")),
            "Monthly"
        );
        assert_eq!(
            get_window_label(&make_win(Some(86400 * 2), "custom")),
            "2-day"
        );
        assert_eq!(
            get_window_label(&make_win(Some(3600 * 3), "custom")),
            "3-hour"
        );
        assert_eq!(get_window_label(&make_win(Some(120), "custom")), "2-minute");
        assert_eq!(get_window_label(&make_win(None, "fallback")), "fallback");
    }

    #[test]
    fn window_parsing_extracts_primary_and_secondary() {
        let payload = serde_json::json!({
            "plan_type": "go",
            "rate_limit": {
                "primary_window": {
                    "used_percent": 12.5,
                    "reset_at": 1759508316,
                    "limit_window_seconds": 18000
                },
                "secondary_window": {
                    "used_percent": 85.0,
                    "reset_at": 1759881804,
                    "limit_window_seconds": 604800
                }
            }
        });

        let windows = get_windows(&payload);
        assert_eq!(windows.len(), 2);
        assert_eq!(windows[0].name, "5-hour");
        assert_eq!(windows[0].used_percent, 12.5);
        assert_eq!(windows[1].name, "Weekly");
        assert_eq!(windows[1].used_percent, 85.0);
    }
}
