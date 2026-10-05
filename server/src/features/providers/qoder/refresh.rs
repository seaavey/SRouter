//! Live catalog refresh: the credential gate, the retry window, and the
//! coalesced fetch that keeps a burst of first requests from becoming a burst of
//! GETs.

use std::time::Duration;

use serde_json::Value;

use super::auth::identity;
use super::catalog::QoderCatalog;
use super::cosy::sign;
use super::executor::QoderExecutor;
use super::request::apply_headers;
use super::state::{read_catalog, write_catalog};
use super::types::QODER_USER_AGENT;
use crate::clock::now_ms;
use crate::constants;
use crate::error::APIError;
use crate::features::providers::adapter::{upstream_error, upstream_status_error};
use crate::infrastructure::database::providers::load_qoder_credentials;

/// Upper bound for the catalog GET. Chat inherits 120 s from the upstream
/// client; a request that fills an empty catalog must not wait that long.
const CATALOG_REQUEST_TIMEOUT: Duration = Duration::from_secs(10);

impl QoderExecutor {
    /// Refreshes the catalog when it is due. A caller whose snapshot is still
    /// empty waits, because there is nothing else to hand back; once the
    /// snapshot holds models the fetch runs in the background and no request
    /// pays for it.
    pub async fn maybe_refresh(&self, force: bool) {
        let Some(database) = self.database.as_ref() else {
            return;
        };
        match load_qoder_credentials(database).await {
            Ok(Some(_)) => {}
            Ok(None) => {
                *write_catalog(&self.catalog) = QoderCatalog::empty();
                return;
            }
            Err(_) => return,
        }

        // An empty snapshot queues for the fetch even when the retry window says
        // no new GET is due: the hold-off excuses starting a fetch, not walking
        // away from one another request already has in flight.
        if read_catalog(&self.catalog).is_empty() {
            let _ = self.refresh_coalesced(force).await;
            return;
        }

        if !self.refresh_is_due(force) {
            return;
        }

        let executor = self.clone();
        tokio::spawn(async move {
            let _ = executor.refresh_coalesced(force).await;
        });
    }

    fn refresh_is_due(&self, force: bool) -> bool {
        read_catalog(&self.catalog).refresh_is_due(force, now_ms())
    }

    /// Runs one fetch at a time. A waiter that finds the snapshot already filled
    /// by the lock's previous holder returns without touching the network, which
    /// is what keeps a burst of first requests from becoming a burst of fetches.
    async fn refresh_coalesced(&self, force: bool) -> Result<(), APIError> {
        let _guard = self.refresh_lock.lock().await;

        if !self.refresh_is_due(force) {
            return Ok(());
        }

        write_catalog(&self.catalog).attempted_at_ms = now_ms();
        self.refresh_catalog().await
    }

    /// Replaces the snapshot with the upstream model list. Any failure leaves
    /// the current snapshot in place.
    pub async fn refresh_catalog(&self) -> Result<(), APIError> {
        let credentials = self.credentials().await?;
        let machine_id = self.machine_id().await?;
        let url = self.endpoints.model_list_url();
        let request_id = uuid::Uuid::new_v4().to_string();
        let headers = sign(
            "",
            &url,
            &identity(&credentials, &machine_id),
            (now_ms() / 1000) as u64,
            &request_id,
        )?;

        let mut request = self
            .client
            .raw()
            .get(&url)
            .timeout(CATALOG_REQUEST_TIMEOUT)
            .header("User-Agent", QODER_USER_AGENT)
            .header("Accept", "application/json")
            .header("Accept-Encoding", "identity");
        request = apply_headers(request, &headers);

        let response = request.send().await.map_err(upstream_error)?;
        let status = response.status();
        if !status.is_success() {
            let detail = response.text().await.unwrap_or_default();
            return Err(upstream_status_error(status, &detail));
        }

        let payload = response.json::<Value>().await.map_err(|error| {
            APIError::new(500, constants::providers::could_not_decode_response(&error))
        })?;

        if let Some(catalog) = QoderCatalog::parse_chat_list(&payload) {
            *write_catalog(&self.catalog) = catalog;
        }

        Ok(())
    }
}
