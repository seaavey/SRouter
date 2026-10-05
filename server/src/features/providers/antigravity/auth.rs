//! Antigravity credential load and lazy Google token refresh (D6), plus the
//! CloudCode project bootstrap (D5).
//!
//! D6 mirrors the Codex refresh: a five-minute lead window, one mutex per
//! connection so concurrent requests coalesce onto a single refresh, and a
//! rotated `refresh_token` persisted back. The token endpoint is injectable
//! through [`AntigravityEndpoints`], so a test points the refresh at a fake.
//!
//! D5 resolves `cloudaicompanionProject` once through `loadCodeAssist` on the
//! first use of a `ya29.` access token and persists it on the connection, so
//! later requests read it from the row instead of calling Google again. When
//! the lookup fails the executor falls back to a generated id.

use std::sync::Arc;

use serde_json::Value;

use super::executor::AntigravityExecutor;
use crate::clock::now_ms;
use crate::constants;
use crate::error::APIError;
use crate::features::providers::antigravity::types::{
    ANTIGRAVITY_OAUTH_CLIENT_ID, ANTIGRAVITY_OAUTH_CLIENT_SECRET,
};
use crate::features::providers::wire::{apply_headers, payload_reports_invalid_grant};
use crate::infrastructure::database::providers::{
    AntigravityCredentials, load_antigravity_credentials, update_antigravity_project_id,
    update_antigravity_tokens,
};

/// Refresh this long before the access token expires; the Codex sweeper's lead
/// time (`apps/api/src/services/tokenRefresh.ts`).
const TOKEN_REFRESH_LEAD_MS: i64 = 5 * 60 * 1000;

impl AntigravityExecutor {
    /// The newest enabled Antigravity connection, or the "not connected" error.
    pub(super) async fn credentials(&self) -> Result<AntigravityCredentials, APIError> {
        let database = self.database.as_ref().ok_or_else(|| {
            APIError::new(500, constants::providers::antigravity::DATABASE_REQUIRED)
        })?;

        load_antigravity_credentials(database)
            .await?
            .ok_or_else(|| APIError::new(401, constants::providers::antigravity::NOT_CONNECTED))
    }

    /// Credentials whose access token is fresh, refreshing under a
    /// per-connection lock when the token is inside the lead window. A token
    /// without a refresh token is used as-is; a transient refresh failure keeps
    /// a still-valid token instead of revoking the session.
    pub(super) async fn ensure_fresh_token(
        &self,
        force: bool,
    ) -> Result<AntigravityCredentials, APIError> {
        let credentials = self.credentials().await?;
        if !force && !token_refresh_is_due(&credentials, now_ms()) {
            return Ok(credentials);
        }

        let Some(refresh_token) = credentials.refresh_token.clone() else {
            return Ok(credentials);
        };

        let refresh_lock = {
            let mut locks = self
                .refresh_locks
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            locks
                .entry(credentials.id.clone())
                .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())))
                .clone()
        };
        let _guard = refresh_lock.lock().await;

        let current = self.credentials().await?;
        if !force && !token_refresh_is_due(&current, now_ms()) {
            return Ok(current);
        }
        let refresh_token = current.refresh_token.clone().unwrap_or(refresh_token);

        match self.refresh_token(&current, &refresh_token).await {
            Ok(refreshed) => Ok(refreshed),
            Err(error) if error.status() >= 500 && !current.is_expired(now_ms()) => Ok(current),
            Err(error) => Err(error),
        }
    }

    async fn refresh_token(
        &self,
        current: &AntigravityCredentials,
        refresh_token: &str,
    ) -> Result<AntigravityCredentials, APIError> {
        let database = self.database.as_ref().ok_or_else(|| {
            APIError::new(500, constants::providers::antigravity::DATABASE_REQUIRED)
        })?;

        // Probe-proven: Google requires `client_secret` for this client even
        // with a refresh token.
        let form = url::form_urlencoded::Serializer::new(String::new())
            .append_pair("grant_type", "refresh_token")
            .append_pair("refresh_token", refresh_token)
            .append_pair("client_id", ANTIGRAVITY_OAUTH_CLIENT_ID)
            .append_pair("client_secret", ANTIGRAVITY_OAUTH_CLIENT_SECRET)
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
                    constants::providers::antigravity::refresh_transport_failed(&error),
                )
            })?;
        let status = response.status();
        let payload = response.json::<Value>().await.unwrap_or(Value::Null);

        if status.is_client_error() || payload_reports_invalid_grant(&payload) {
            return Err(APIError::new(
                401,
                constants::providers::antigravity::TOKEN_EXPIRED,
            ));
        }
        if !status.is_success() {
            return Err(APIError::new(
                500,
                constants::providers::antigravity::refresh_failed(status.as_u16()),
            ));
        }

        let access_token = payload
            .get("access_token")
            .and_then(Value::as_str)
            .filter(|token| !token.trim().is_empty())
            .ok_or_else(|| APIError::new(401, constants::providers::antigravity::TOKEN_EXPIRED))?;
        let rotated_refresh = payload
            .get("refresh_token")
            .and_then(Value::as_str)
            .filter(|token| !token.trim().is_empty())
            .unwrap_or(refresh_token);
        let expires_at = payload
            .get("expires_in")
            .and_then(Value::as_i64)
            .map(|seconds| now_ms() + seconds.saturating_mul(1000));

        update_antigravity_tokens(
            database,
            &current.id,
            access_token,
            rotated_refresh,
            expires_at,
            now_ms(),
        )
        .await?;

        Ok(AntigravityCredentials {
            id: current.id.clone(),
            access_token: access_token.to_owned(),
            refresh_token: Some(rotated_refresh.to_owned()),
            expires_at,
            project_id: current.project_id.clone(),
        })
    }

    /// The CloudCode project id for the envelope: the stored id, else a
    /// `loadCodeAssist` lookup for a `ya29.` token, else a generated fallback.
    /// The resolved id is persisted so the lookup runs once (D5).
    pub(super) async fn ensure_project_id(
        &self,
        credentials: &AntigravityCredentials,
    ) -> Result<String, APIError> {
        if let Some(project_id) = credentials
            .project_id
            .as_deref()
            .filter(|value| !value.trim().is_empty())
        {
            return Ok(project_id.to_owned());
        }

        let project_id = self
            .load_code_assist(credentials)
            .await
            .unwrap_or_else(generate_fallback_project_id);

        if let Some(database) = self.database.as_ref() {
            let _ = update_antigravity_project_id(database, &credentials.id, &project_id).await;
        }

        Ok(project_id)
    }

    /// `POST v1internal:loadCodeAssist` for a `ya29.` token, returning
    /// `cloudaicompanionProject` (or `projectId`). `None` for any other token,
    /// a non-2xx answer, or a payload without a project.
    async fn load_code_assist(&self, credentials: &AntigravityCredentials) -> Option<String> {
        if !credentials.access_token.starts_with("ya29.") {
            return None;
        }

        let response = apply_headers(
            self.client
                .raw()
                .post(&self.endpoints.code_assist_url)
                .timeout(self.client.request_timeout()),
            &self.request_headers(&credentials.access_token),
        )
        .json(&serde_json::json!({}))
        .send()
        .await
        .ok()?;
        if !response.status().is_success() {
            return None;
        }

        let payload: Value = response.json().await.ok()?;
        payload
            .get("cloudaicompanionProject")
            .or_else(|| payload.get("projectId"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_owned)
    }
}

/// Whether the access token is inside the refresh lead window. A token with no
/// recorded expiry (an imported token) is refreshed once; a successful refresh
/// writes an expiry, so the next check is governed by the lead window.
pub(super) fn token_refresh_is_due(credentials: &AntigravityCredentials, now: i64) -> bool {
    match credentials.expires_at {
        Some(expires_at) => now >= expires_at.saturating_sub(TOKEN_REFRESH_LEAD_MS),
        None => true,
    }
}

/// The fallback project id the Node oracle generates when `loadCodeAssist`
/// fails: `{adjective}-{noun}-{5 hex}`.
pub(super) fn generate_fallback_project_id() -> String {
    const ADJECTIVES: &[&str] = &["useful", "bright", "swift", "calm", "bold"];
    const NOUNS: &[&str] = &["fuze", "wave", "spark", "flow", "core"];

    let mut seed = [0u8; 2];
    let _ = getrandom::fill(&mut seed);
    let adjective = ADJECTIVES[seed[0] as usize % ADJECTIVES.len()];
    let noun = NOUNS[seed[1] as usize % NOUNS.len()];
    let suffix = crate::features::providers::wire::random_hex(3);

    format!("{adjective}-{noun}-{}", &suffix[..5])
}
