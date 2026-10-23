//! OpenCode Zen live catalog refresh: the free-tier merge and the coalesced
//! fetch. The endpoint is public, so no credential gate sits in front of it.

use std::time::Duration;

use serde_json::Value;

use super::catalog::{OpenCodeCatalog, read_catalog, write_catalog};
use super::executor::OpenCodeExecutor;
use crate::clock::now_ms;
use crate::constants;
use crate::error::APIError;
use crate::features::providers::adapter::{upstream_error, upstream_status_error};

pub const CATALOG_REQUEST_TIMEOUT: Duration = Duration::from_secs(10);

impl OpenCodeExecutor {
    /// An unfilled catalog waits for the shared fetch; a filled one refreshes in
    /// the background.
    pub async fn maybe_refresh(&self, force: bool) {
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

    /// Replaces the snapshot with the seed plus the free-tier ids upstream
    /// returns today, so a model the seed still lists keeps routing while a new
    /// one appears without a release.
    pub async fn refresh_catalog(&self) -> Result<(), APIError> {
        let mut models = self.seed_models();
        for id in self.fetch_live_models().await? {
            if !models.contains(&id) {
                models.push(id);
            }
        }

        let now = now_ms();
        let mut catalog = write_catalog(&self.catalog);
        catalog.models = models;
        catalog.fetched_at_ms = now;
        catalog.attempted_at_ms = now;

        Ok(())
    }

    /// The free-tier ids of the live list. The endpoint needs no credentials,
    /// which is why this provider needs no database to keep a catalog.
    async fn fetch_live_models(&self) -> Result<Vec<String>, APIError> {
        let url = format!("{}/models", self.base_url.trim_end_matches('/'));
        let response = self
            .client
            .raw()
            .get(url)
            .timeout(CATALOG_REQUEST_TIMEOUT)
            .header("Accept", "application/json")
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

        Ok(OpenCodeCatalog::parse_live(&payload).unwrap_or_default())
    }
}
