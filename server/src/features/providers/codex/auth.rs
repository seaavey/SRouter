//! Codex credential load and lazy OAuth token refresh: reads the ChatGPT OAuth
//! session from the database, refreshes the access token before it expires, and
//! persists rotated tokens back.

use std::sync::Arc;

use serde_json::Value;

use crate::clock::now_ms;
use crate::constants;
use crate::error::APIError;
use crate::features::providers::codex::types::CODEX_OAUTH_CLIENT_ID;
use crate::features::providers::wire::payload_reports_invalid_grant;
use crate::infrastructure::database::providers::{
    CodexCredentials, load_codex_credentials, update_codex_tokens,
};

use super::executor::CodexExecutor;

/// Refresh this long before the access token expires; mirrors the Node sweeper's
/// lead time (`apps/api/src/services/tokenRefresh.ts`).
const TOKEN_REFRESH_LEAD_MS: i64 = 5 * 60 * 1000;
/// Refresh a token with no known expiry once a day, the Node fallback.
const TOKEN_REFRESH_FALLBACK_MS: i64 = 12 * 60 * 60 * 1000;

impl CodexExecutor {
    async fn credentials(&self) -> Result<CodexCredentials, APIError> {
        let database = self
            .database
            .as_ref()
            .ok_or_else(|| APIError::new(500, constants::providers::codex::DATABASE_REQUIRED))?;

        load_codex_credentials(database)
            .await
            .ok()
            .flatten()
            .ok_or_else(|| APIError::new(401, constants::providers::codex::NOT_CONNECTED))
    }

    pub(super) async fn ensure_fresh_token(
        &self,
        force: bool,
    ) -> Result<CodexCredentials, APIError> {
        let credentials = self.credentials().await?;
        if !force && !token_refresh_is_due(&credentials, now_ms()) {
            return Ok(credentials);
        }

        let Some(refresh_token) = credentials.refresh_token.as_deref() else {
            if credentials.is_expired(now_ms()) || force {
                return Err(APIError::new(
                    401,
                    constants::providers::codex::TOKEN_EXPIRED,
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

        match self
            .refresh_token(&current.id, refresh_token, current.account_id.clone())
            .await
        {
            Ok(refreshed) => Ok(refreshed),
            // A transient upstream failure must not revoke a still-valid session.
            Err(error) if error.status() >= 500 && !current.is_expired(now_ms()) => Ok(current),
            Err(error) => Err(error),
        }
    }

    async fn refresh_token(
        &self,
        connection_id: &str,
        refresh_token: &str,
        account_id: Option<String>,
    ) -> Result<CodexCredentials, APIError> {
        let database = self
            .database
            .as_ref()
            .ok_or_else(|| APIError::new(500, constants::providers::codex::DATABASE_REQUIRED))?;
        let form = url::form_urlencoded::Serializer::new(String::new())
            .append_pair("grant_type", "refresh_token")
            .append_pair("refresh_token", refresh_token)
            .append_pair("client_id", CODEX_OAUTH_CLIENT_ID)
            .finish();
        let response = self
            .client
            .raw()
            .post(&self.endpoints.token_url)
            .timeout(self.client.request_timeout())
            .header("content-type", "application/x-www-form-urlencoded")
            .body(form)
            .send()
            .await
            .map_err(|error| {
                APIError::new(
                    500,
                    constants::providers::codex::refresh_transport_failed(error),
                )
            })?;
        let status = response.status();
        let payload = response.json::<Value>().await.unwrap_or(Value::Null);

        if status.is_client_error() || payload_reports_invalid_grant(&payload) {
            return Err(APIError::new(
                401,
                constants::providers::codex::TOKEN_EXPIRED,
            ));
        }
        if !status.is_success() {
            return Err(APIError::new(
                500,
                constants::providers::codex::refresh_failed(status.as_u16()),
            ));
        }

        let access_token = payload
            .get("access_token")
            .and_then(Value::as_str)
            .filter(|token| !token.trim().is_empty())
            .ok_or_else(|| APIError::new(401, constants::providers::codex::TOKEN_EXPIRED))?;
        let rotated_refresh = payload
            .get("refresh_token")
            .and_then(Value::as_str)
            .filter(|token| !token.trim().is_empty())
            .unwrap_or(refresh_token);
        let expires_at = payload
            .get("expires_in")
            .and_then(Value::as_i64)
            .map(|seconds| now_ms() + seconds.saturating_mul(1000));
        let refreshed_at = now_ms();

        update_codex_tokens(
            database,
            connection_id,
            access_token,
            rotated_refresh,
            expires_at,
            refreshed_at,
        )
        .await?;

        Ok(CodexCredentials {
            id: connection_id.to_owned(),
            access_token: access_token.to_owned(),
            refresh_token: Some(rotated_refresh.to_owned()),
            account_id,
            token_expires_at: expires_at,
            last_refreshed_at: Some(refreshed_at),
        })
    }
}

pub(super) fn token_refresh_is_due(credentials: &CodexCredentials, now: i64) -> bool {
    match credentials.token_expires_at {
        Some(expires_at) => now >= expires_at.saturating_sub(TOKEN_REFRESH_LEAD_MS),
        None => credentials
            .last_refreshed_at
            .is_none_or(|refreshed_at| now - refreshed_at >= TOKEN_REFRESH_FALLBACK_MS),
    }
}
