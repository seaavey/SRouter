//! Cline live catalog refresh: the merged `/models` + curated free-model list,
//! the credential gate, and the coalesced fetch.

use std::time::Duration;

use serde_json::Value;

use super::auth::bearer_token;
use super::catalog::{ClineCatalog, read_catalog, write_catalog};
use super::executor::ClineExecutor;
use super::request::endpoint_url;
use crate::clock::now_ms;
use crate::constants;
use crate::error::APIError;
use crate::features::providers::adapter::{upstream_error, upstream_status_error};
use crate::infrastructure::database::providers::load_cline_credentials;

pub const CATALOG_REQUEST_TIMEOUT: Duration = Duration::from_secs(10);

impl ClineExecutor {
    /// An empty catalog waits for the shared fetch; a populated one refreshes in the background.
    pub async fn maybe_refresh(&self, force: bool) {
        let Some(database) = self.database.as_ref() else {
            return;
        };
        match load_cline_credentials(database).await {
            Ok(connections) if !connections.is_empty() => {}
            Ok(_) => {
                *write_catalog(&self.catalog) = ClineCatalog::empty();
                return;
            }
            Err(_) => return,
        }

        if read_catalog(&self.catalog).is_empty() {
            let _ = self.refresh_catalog_coalesced(force).await;
            return;
        }

        if !self.refresh_is_due(force) {
            return;
        }

        let executor = self.clone();
        tokio::spawn(async move {
            let _ = executor.refresh_catalog_coalesced(force).await;
        });
    }

    fn refresh_is_due(&self, force: bool) -> bool {
        read_catalog(&self.catalog).refresh_is_due(force, now_ms())
    }

    async fn refresh_catalog_coalesced(&self, force: bool) -> Result<(), APIError> {
        let _guard = self.catalog_refresh_lock.lock().await;
        if !self.refresh_is_due(force) {
            return Ok(());
        }

        write_catalog(&self.catalog).attempted_at_ms = now_ms();
        self.refresh_catalog().await
    }

    /// Replaces the snapshot only when upstream returns a usable model list.
    pub async fn refresh_catalog(&self) -> Result<(), APIError> {
        let credentials = self.ensure_fresh_token(false).await?;
        let response = self
            .client
            .raw()
            .get(endpoint_url(&self.endpoints.api_base_url, "models"))
            .timeout(CATALOG_REQUEST_TIMEOUT)
            .header("Authorization", bearer_token(&credentials.access_token))
            .header("Accept", "application/json")
            .header("Accept-Encoding", "identity")
            .send()
            .await
            .map_err(upstream_error)?;
        let status = response.status();

        if !status.is_success() {
            let detail = response.text().await.unwrap_or_default();
            return Err(map_status_error(status, &detail));
        }

        let payload = response.json::<Value>().await.map_err(|error| {
            APIError::new(500, constants::providers::could_not_decode_response(&error))
        })?;
        if let Some(mut catalog) = ClineCatalog::parse_model_list(&payload) {
            // The curated list carries the `cline-free/*` ids `/models` omits,
            // so the two are merged before the snapshot is replaced. A failed
            // curated fetch keeps the catalog usable without them.
            let curated = self.free_models(&credentials.access_token).await;
            if !curated.is_empty() {
                catalog.models.extend(curated);
                catalog.models.sort();
                catalog.models.dedup();
            }
            *write_catalog(&self.catalog) = catalog;
        }

        Ok(())
    }

    /// The `cline-free/*` ids of the curated recommended-models payload. This
    /// list is optional: any failure adds nothing instead of failing the
    /// refresh, which is what the official client does as well.
    async fn free_models(&self, access_token: &str) -> Vec<String> {
        let Ok(response) = self
            .client
            .raw()
            .get(endpoint_url(
                &self.endpoints.api_base_url,
                "ai/cline/recommended-models",
            ))
            .timeout(CATALOG_REQUEST_TIMEOUT)
            .header("Authorization", bearer_token(access_token))
            .header("Accept", "application/json")
            .send()
            .await
        else {
            return Vec::new();
        };
        if !response.status().is_success() {
            return Vec::new();
        }

        let payload = response.json::<Value>().await.unwrap_or(Value::Null);
        ClineCatalog::parse_free_list(&payload)
    }
}

fn map_status_error(status: reqwest::StatusCode, detail: &str) -> APIError {
    match status.as_u16() {
        401 => APIError::new(401, constants::providers::cline::TOKEN_EXPIRED),
        402 => APIError::new(402, constants::providers::cline::OUT_OF_CREDITS),
        _ => upstream_status_error(status, detail),
    }
}
