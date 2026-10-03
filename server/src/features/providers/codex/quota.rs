//! Codex provider live quota fetcher against ChatGPT `wham/usage`.
//!
//! Provenance and oracle reference:
//! - `packages/providers/src/quota/openai-codex.ts` (upstream endpoint and rate-limit window parsing).
//! - `docs/api-v1-contract.md` row 94.

use crate::error::APIError;
use crate::features::catalog::quota::{LiveModelQuotaItem, ProviderQuotaAccount};
use crate::features::providers::codex::types::{CODEX_ORIGINATOR, CODEX_USER_AGENT};
use crate::infrastructure::database::providers::ProviderForQuota;

/// Default upstream usage endpoint for OpenAI Codex.
pub const CODEX_USAGE_URL: &str = "https://chatgpt.com/backend-api/wham/usage";

#[derive(Debug, Clone)]
pub struct RateLimitWindow {
    pub used_percent: f64,
    pub reset_at: Option<i64>,
    pub duration_seconds: Option<u64>,
    pub name: String,
}

/// Calls OpenAI Codex usage endpoint and extracts rate limit windows into a `ProviderQuotaAccount`.
pub async fn fetch_codex_quota(
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

pub fn get_windows(payload: &serde_json::Value) -> Vec<RateLimitWindow> {
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

pub fn get_window_label(window: &RateLimitWindow) -> String {
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
