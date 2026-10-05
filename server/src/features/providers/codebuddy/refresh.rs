//! CodeBuddy live catalog refresh: the flavor-gated fetch, the credential gate,
//! and the coalesced refresh.

use std::time::Duration;

use serde_json::Value;

use super::catalog::{CodeBuddyCatalog, read_catalog, write_catalog};
use super::executor::CodeBuddyExecutor;
use crate::clock::now_ms;
use crate::constants;
use crate::error::APIError;
use crate::features::providers::adapter::{upstream_error, upstream_status_error};
use crate::features::providers::wire::{apply_headers, bearer_token};
use crate::infrastructure::database::providers::load_codebuddy_credentials;

pub const CATALOG_REQUEST_TIMEOUT: Duration = Duration::from_secs(10);

impl CodeBuddyExecutor {
    /// An empty catalog waits for the shared fetch; a populated one refreshes in
    /// the background. The catalog is gated on the flavor's exact connection, so
    /// the global and China adapters never advertise each other's models.
    pub async fn maybe_refresh(&self, force: bool) {
        let Some(database) = self.database.as_ref() else {
            return;
        };
        match load_codebuddy_credentials(database, self.flavor.provider_id()).await {
            Ok(Some(_)) => {}
            Ok(None) => {
                *write_catalog(&self.catalog) = CodeBuddyCatalog::empty();
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
        let credentials = self.credentials().await?;
        let mut headers = self.base_headers();
        headers.insert("Accept", "application/json".to_owned());
        headers.insert("Authorization", bearer_token(&credentials.access_token));
        let response = apply_headers(
            self.client
                .raw()
                .get(&self.endpoints.config_url)
                .timeout(CATALOG_REQUEST_TIMEOUT),
            &headers,
        )
        .send()
        .await
        .map_err(upstream_error)?;
        let status = response.status();

        if !status.is_success() {
            let detail = response.text().await.unwrap_or_default();
            return Err(upstream_status_error(status, &detail));
        }

        let payload = response.json::<Value>().await.map_err(|error| {
            APIError::new(500, constants::providers::could_not_decode_response(&error))
        })?;
        if let Some(catalog) = CodeBuddyCatalog::parse_config(&payload) {
            *write_catalog(&self.catalog) = catalog;
        }

        Ok(())
    }
}
