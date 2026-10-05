//! Cline credential lifecycle: loading, the refresh-due window, the WorkOS
//! token refresh, and the expiry parsing that feeds it.

use std::sync::Arc;

use serde_json::Value;

use super::executor::ClineExecutor;
use super::request::endpoint_url;
use crate::clock::now_ms;
use crate::constants;
use crate::error::APIError;
use crate::features::providers::wire::{error_message, payload_reports_invalid_grant};
use crate::infrastructure::database::providers::{
    ClineCredentials, load_cline_credentials, update_cline_tokens,
};

pub(super) const TOKEN_REFRESH_LEAD_MS: i64 = 5 * 60 * 1000;
pub(super) const TOKEN_REFRESH_FALLBACK_MS: i64 = 12 * 60 * 60 * 1000;

impl ClineExecutor {
    pub(super) async fn credentials(&self) -> Result<ClineCredentials, APIError> {
        let database = self
            .database
            .as_ref()
            .ok_or_else(|| APIError::new(500, constants::providers::cline::DATABASE_REQUIRED))?;

        load_cline_credentials(database)
            .await
            .ok()
            .flatten()
            .ok_or_else(|| APIError::new(401, constants::providers::cline::NOT_CONNECTED))
    }

    pub(super) async fn ensure_fresh_token(
        &self,
        force: bool,
    ) -> Result<ClineCredentials, APIError> {
        let credentials = self.credentials().await?;
        if !force && !token_refresh_is_due(&credentials, now_ms()) {
            return Ok(credentials);
        }

        let Some(refresh_token) = credentials.refresh_token.as_deref() else {
            if credentials.is_expired(now_ms()) || force {
                return Err(APIError::new(
                    401,
                    constants::providers::cline::TOKEN_EXPIRED,
                ));
            }
            return Ok(credentials);
        };

        let refresh_lock = {
            let mut refreshes = self
                .token_refreshes
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            refreshes
                .entry(credentials.id.clone())
                .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())))
                .clone()
        };
        let _guard = refresh_lock.lock().await;

        let current = self.credentials().await?;
        if !force && !token_refresh_is_due(&current, now_ms()) {
            return Ok(current);
        }
        let refresh_token = current.refresh_token.as_deref().unwrap_or(refresh_token);

        match self.refresh_token(&current.id, refresh_token).await {
            Ok(refreshed) => Ok(refreshed),
            Err(error) if error.status() >= 500 && !current.is_expired(now_ms()) => Ok(current),
            Err(error) => Err(error),
        }
    }

    async fn refresh_token(
        &self,
        connection_id: &str,
        refresh_token: &str,
    ) -> Result<ClineCredentials, APIError> {
        let database = self
            .database
            .as_ref()
            .ok_or_else(|| APIError::new(500, constants::providers::cline::DATABASE_REQUIRED))?;
        let response = self
            .client
            .raw()
            .post(endpoint_url(&self.endpoints.api_base_url, "auth/refresh"))
            .timeout(self.client.request_timeout())
            .json(&serde_json::json!({
                "refreshToken": strip_workos_prefix(refresh_token),
                "grantType": "refresh_token",
            }))
            .send()
            .await
            .map_err(|error| {
                APIError::new(
                    500,
                    constants::providers::cline::refresh_transport_failed(error),
                )
            })?;
        let status = response.status();
        let payload = response.json::<Value>().await.unwrap_or(Value::Null);

        if status.is_client_error() || payload_reports_invalid_grant(&payload) {
            return Err(APIError::new(
                401,
                constants::providers::cline::TOKEN_EXPIRED,
            ));
        }
        if !status.is_success() {
            return Err(APIError::new(
                500,
                constants::providers::cline::refresh_failed(status.as_u16()),
            ));
        }

        let payload = unwrap_success(payload)?;
        let access_token = payload
            .get("accessToken")
            .or_else(|| payload.get("access_token"))
            .and_then(Value::as_str)
            .filter(|token| !token.trim().is_empty())
            .ok_or_else(|| APIError::new(401, constants::providers::cline::TOKEN_EXPIRED))?;
        let rotated_refresh = payload
            .get("refreshToken")
            .or_else(|| payload.get("refresh_token"))
            .and_then(Value::as_str)
            .filter(|token| !token.trim().is_empty())
            .unwrap_or(strip_workos_prefix(refresh_token));
        let expires_at = payload
            .get("expiresAt")
            .or_else(|| payload.get("expires_at"))
            .and_then(parse_expiry_ms);
        let refreshed_at = now_ms();
        let access_token = prefixed_token(access_token);

        update_cline_tokens(
            database,
            connection_id,
            &access_token,
            rotated_refresh,
            expires_at,
            refreshed_at,
        )
        .await?;

        Ok(ClineCredentials {
            id: connection_id.to_owned(),
            access_token,
            refresh_token: Some(rotated_refresh.to_owned()),
            token_expires_at: expires_at,
            last_refreshed_at: Some(refreshed_at),
        })
    }
}

fn prefixed_token(token: &str) -> String {
    if token.starts_with("workos:") {
        token.to_owned()
    } else {
        format!("workos:{token}")
    }
}

pub(super) fn bearer_token(token: &str) -> String {
    format!("Bearer {}", prefixed_token(token))
}

/// The `workos:` prefix is a header-only marker; upstream answers
/// `400 failed to refresh token` for a prefixed refresh token.
fn strip_workos_prefix(token: &str) -> &str {
    token.strip_prefix("workos:").unwrap_or(token)
}

pub(super) fn token_refresh_is_due(credentials: &ClineCredentials, now: i64) -> bool {
    match credentials.token_expires_at {
        Some(expires_at) => now >= expires_at.saturating_sub(TOKEN_REFRESH_LEAD_MS),
        None => credentials
            .last_refreshed_at
            .is_none_or(|refreshed_at| now - refreshed_at >= TOKEN_REFRESH_FALLBACK_MS),
    }
}

/// Unwraps the `{success, data, error}` envelope Cline wraps its payloads in.
pub(super) fn unwrap_success(payload: Value) -> Result<Value, APIError> {
    match payload.get("success").and_then(Value::as_bool) {
        Some(false) => Err(APIError::new(
            500,
            error_message(&payload).unwrap_or_else(|| "Cline request failed".to_owned()),
        )),
        Some(true) => Ok(payload.get("data").cloned().unwrap_or(Value::Null)),
        None => Ok(payload),
    }
}

pub(crate) fn parse_expiry_ms(value: &Value) -> Option<i64> {
    if let Some(number) = value.as_i64() {
        return Some(if number < 10_000_000_000 {
            number.saturating_mul(1000)
        } else {
            number
        });
    }

    let text = value.as_str()?.trim();
    if let Ok(number) = text.parse::<i64>() {
        return Some(if number < 10_000_000_000 {
            number.saturating_mul(1000)
        } else {
            number
        });
    }

    parse_rfc3339_ms(text)
}

/// Parses the UTC timestamp upstream ships, `2026-12-31T00:00:00Z`. Any other
/// shape yields `None`, which leaves the expiry unknown and lets the caller
/// fall back to its refresh window instead of guessing.
pub(super) fn parse_rfc3339_ms(value: &str) -> Option<i64> {
    let (date, time) = value.split_once('T')?;
    let time = time.strip_suffix('Z')?;
    let mut date = date.split('-').map(|part| part.parse::<i64>().ok());
    let year = date.next()??;
    let month = date.next()??;
    let day = date.next()??;
    if date.next().is_some() || !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }

    let mut clock = time.split(':');
    let hour = clock.next()?.parse::<i64>().ok()?;
    let minute = clock.next()?.parse::<i64>().ok()?;
    let second_part = clock.next()?;
    if clock.next().is_some() || hour > 23 || minute > 59 {
        return None;
    }
    let (second, millis) = match second_part.split_once('.') {
        Some((second, fraction)) => {
            let fraction = fraction.chars().take(3).collect::<String>();
            let millis = format!("{fraction:0<3}").parse::<i64>().ok()?;
            (second.parse::<i64>().ok()?, millis)
        }
        None => (second_part.parse::<i64>().ok()?, 0),
    };
    if second > 60 {
        return None;
    }

    let days = days_from_civil(year, month, day);
    Some(
        (days * 86_400 + hour * 3600 + minute * 60 + second)
            .saturating_mul(1000)
            .saturating_add(millis),
    )
}

fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let year = year - i64::from(month <= 2);
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let year_of_era = year - era * 400;
    let shifted_month = month + if month > 2 { -3 } else { 9 };
    let day_of_year = (153 * shifted_month + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}
