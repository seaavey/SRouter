//! Command Code catalog refresh: the credential gate and the coalesced fetch.

use std::time::Duration;

use serde_json::Value;

use super::catalog::{CommandCodeCatalog, read_catalog, write_catalog};
use super::executor::CommandCodeExecutor;
use crate::clock::now_ms;
use crate::constants;
use crate::error::APIError;
use crate::features::providers::adapter::{upstream_error, upstream_status_error};
use crate::features::providers::wire::{apply_headers, bearer_token};

pub const CATALOG_REQUEST_TIMEOUT: Duration = Duration::from_secs(10);

impl CommandCodeExecutor {
    /// An empty catalog waits for the shared fetch; a populated one refreshes in
    /// the background. Without a connection the snapshot is emptied, so a
    /// disconnected account stops advertising models immediately.
    pub async fn maybe_refresh(&self, force: bool) {
        if self.database.is_none() {
            return;
        }
        match self.credentials().await {
            Ok(_) => {}
            Err(error) if error.status() == 401 => {
                *write_catalog(&self.catalog) = CommandCodeCatalog::empty();
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

    /// Replaces the snapshot with the vendor's live list. A failed fetch never
    /// clears a snapshot that already landed.
    pub async fn refresh_catalog(&self) -> Result<(), APIError> {
        let models = self.fetch_models().await?;
        if models.is_empty() {
            return Ok(());
        }

        let now = now_ms();
        let mut catalog = write_catalog(&self.catalog);
        catalog.models = models;
        catalog.fetched_at_ms = now;
        catalog.attempted_at_ms = now;

        Ok(())
    }

    async fn fetch_models(&self) -> Result<Vec<String>, APIError> {
        let credentials = self.credentials().await?;
        let mut headers = self.base_headers();
        headers.insert("Accept", "application/json".to_owned());
        headers.insert("Authorization", bearer_token(&credentials.access_token));
        let response = apply_headers(
            self.client
                .raw()
                .get(&self.endpoints.models_url)
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

        Ok(CommandCodeCatalog::parse_models(&payload).unwrap_or_default())
    }
}
