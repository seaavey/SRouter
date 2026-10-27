//! OpenCode Console credential resolution and token refresh.

use std::sync::Arc;

use serde_json::Value;

use super::executor::OpenCodeExecutor;
use crate::clock::now_ms;
use crate::constants;
use crate::error::APIError;
use crate::infrastructure::database::providers::{
    OpenCodeCredentials, load_opencode_credentials, update_opencode_tokens,
};

const OPENCODE_CLIENT_ID: &str = "opencode-cli";
const OPENCODE_BASE_CONSOLE_URL: &str = "https://opencode.ai/console";
const REFRESH_WINDOW_MS: i64 = 5 * 60 * 1000;

impl OpenCodeExecutor {
    /// Resolves the authorization and optional org header for an upstream request.
    /// If an active connection exists, ensures tokens are fresh and returns
    /// `("Bearer <access_token>", Some(org_id))`.
    /// Otherwise, falls back to `("Bearer public", None)`.
    pub async fn auth_headers(&self) -> Result<(String, Option<String>), APIError> {
        let Some(database) = self.database.as_ref() else {
            return Ok(("Bearer public".to_string(), None));
        };

        let connections = match load_opencode_credentials(database).await {
            Ok(conns) => conns,
            Err(_) => return Ok(("Bearer public".to_string(), None)),
        };

        let Some(credentials) = connections.first() else {
            return Ok(("Bearer public".to_string(), None));
        };

        let fresh = self.ensure_fresh_token_for(credentials).await?;
        Ok((format!("Bearer {}", fresh.access_token), fresh.org_id))
    }

    async fn ensure_fresh_token_for(
        &self,
        credentials: &OpenCodeCredentials,
    ) -> Result<OpenCodeCredentials, APIError> {
        let now = now_ms();
        let needs_refresh = credentials
            .token_expires_at
            .is_some_and(|expires_at| expires_at - now <= REFRESH_WINDOW_MS);

        if !needs_refresh && !credentials.is_expired(now) {
            return Ok(credentials.clone());
        }

        let Some(refresh_token) = credentials.refresh_token.as_ref() else {
            if credentials.is_expired(now) {
                return Err(APIError::new(
                    401,
                    constants::providers::opencode::TOKEN_EXPIRED,
                ));
            }
            return Ok(credentials.clone());
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

        let Some(database) = self.database.as_ref() else {
            return Ok(credentials.clone());
        };

        // Re-read current row
        let current = load_opencode_credentials(database)
            .await?
            .into_iter()
            .find(|c| c.id == credentials.id)
            .unwrap_or_else(|| credentials.clone());

        if !current.is_expired(now_ms()) && current
            .token_expires_at
            .is_some_and(|exp| exp - now_ms() > REFRESH_WINDOW_MS)
        {
            return Ok(current);
        }

        let refresh_body = serde_json::json!({
            "client_id": OPENCODE_CLIENT_ID,
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
        });

        let token_url = format!("{OPENCODE_BASE_CONSOLE_URL}/auth/device/token");
        let response = self
            .client
            .raw()
            .post(&token_url)
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .json(&refresh_body)
            .send()
            .await;

        let response = match response {
            Ok(resp) if resp.status().is_success() => resp,
            Ok(resp) => {
                if current.is_expired(now_ms()) {
                    return Err(APIError::new(
                        401,
                        constants::providers::opencode::refresh_failed(resp.status().as_u16()),
                    ));
                }
                return Ok(current);
            }
            Err(err) => {
                if current.is_expired(now_ms()) {
                    return Err(APIError::new(
                        500,
                        constants::providers::opencode::refresh_transport_failed(err),
                    ));
                }
                return Ok(current);
            }
        };

        let payload = response.json::<Value>().await.unwrap_or(Value::Null);
        let new_access = payload
            .get("access_token")
            .and_then(Value::as_str)
            .ok_or_else(|| APIError::new(400, constants::providers::opencode::INVALID_TOKEN_RESPONSE))?;
        let new_refresh = payload.get("refresh_token").and_then(Value::as_str);
        let expires_in = payload.get("expires_in").and_then(Value::as_i64);
        let new_expires_at = expires_in.map(|secs| now_ms() + secs * 1000);

        update_opencode_tokens(
            database,
            &current.id,
            new_access,
            new_refresh,
            new_expires_at,
            current.org_id.as_deref(),
        )
        .await?;

        Ok(OpenCodeCredentials {
            id: current.id,
            access_token: new_access.to_string(),
            refresh_token: new_refresh.map(ToOwned::to_owned).or(current.refresh_token),
            token_expires_at: new_expires_at,
            last_refreshed_at: Some(now_ms()),
            org_id: current.org_id,
        })
    }
}
