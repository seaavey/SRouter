//! Cline executor: credential refresh, live catalog, and chat transport.
//!
//! The credential lifecycle lives in [`super::auth`], request building in
//! [`super::request`], the catalog refresh in [`super::refresh`], and the SSE
//! translation in [`super::translate`].

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use futures_util::StreamExt;
use serde_json::Value;

use super::catalog::{ClineCatalog, SharedCatalog, read_catalog};
use super::request::strip_cline_prefix;
use super::translate::{Aggregator, EventDecoder, translate_stream};
use super::types::{CLINE_KEYS, CLINE_PROVIDER, ClineEndpoints};
use crate::error::APIError;
use crate::features::providers::adapter::{ProviderAdapter, ProviderStream, upstream_error};
use crate::features::providers::executor::{BoxFuture, ProviderExecutor};
use crate::features::providers::rotation::AccountRotator;
use crate::infrastructure::database::AppDatabase;
use crate::infrastructure::upstream::UpstreamClient;
use crate::protocol::model::ChatCompletionRequest;

// Re-exported so `cline::executor::{endpoint_url, parse_expiry_ms}` and
// `cline::executor::CATALOG_REQUEST_TIMEOUT` keep resolving.
pub(crate) use super::auth::parse_expiry_ms;
pub use super::refresh::CATALOG_REQUEST_TIMEOUT;
pub(crate) use super::request::endpoint_url;

/// Cline's live catalog and credential-backed OpenAI-compatible transport.
#[derive(Clone)]
pub struct ClineExecutor {
    id: &'static str,
    keys: &'static [&'static str],
    pub(super) endpoints: ClineEndpoints,
    pub(super) database: Option<AppDatabase>,
    pub(super) client: UpstreamClient,
    pub catalog: SharedCatalog,
    pub(super) catalog_refresh_lock: Arc<tokio::sync::Mutex<()>>,
    pub(super) token_refreshes: Arc<Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>>,
    /// Rotation and cooldown state across this provider's accounts, shared by
    /// every clone of the adapter.
    pub(super) rotator: Arc<AccountRotator>,
}

impl ClineExecutor {
    pub fn new(
        endpoints: ClineEndpoints,
        database: Option<AppDatabase>,
        client: UpstreamClient,
    ) -> Self {
        Self {
            id: CLINE_PROVIDER.id,
            keys: CLINE_KEYS,
            endpoints,
            database,
            client,
            catalog: ClineCatalog::shared_empty(),
            catalog_refresh_lock: Arc::new(tokio::sync::Mutex::new(())),
            token_refreshes: Arc::new(Mutex::new(HashMap::new())),
            rotator: AccountRotator::shared(),
        }
    }

    pub fn id(&self) -> &str {
        self.id
    }

    pub fn keys(&self) -> &'static [&'static str] {
        self.keys
    }

    pub fn alias(&self) -> &str {
        CLINE_PROVIDER.alias
    }

    pub fn models(&self) -> Vec<String> {
        read_catalog(&self.catalog).models.clone()
    }

    pub fn model_id_variants(&self, model: &str) -> Vec<String> {
        vec![strip_cline_prefix(model.trim()).to_lowercase()]
    }

    pub fn endpoints(&self) -> &ClineEndpoints {
        &self.endpoints
    }

    pub async fn chat_completion(
        &self,
        model: &str,
        request: &ChatCompletionRequest,
    ) -> Result<Value, APIError> {
        self.maybe_refresh(false).await;
        let (response, prepared) = self.chat_response(model, request, true).await?;
        let mut upstream = response.bytes_stream();
        let mut decoder = EventDecoder::default();
        let mut aggregator = Aggregator::new(&prepared.model_key);

        while let Some(item) = upstream.next().await {
            let bytes = item.map_err(upstream_error)?;
            for frame in decoder.push(&bytes) {
                aggregator.accept(frame)?;
            }
        }
        for frame in decoder.finish() {
            aggregator.accept(frame)?;
        }

        aggregator.finish(request)
    }

    pub async fn chat_completion_stream(
        &self,
        model: &str,
        request: &ChatCompletionRequest,
    ) -> Result<ProviderStream, APIError> {
        self.maybe_refresh(false).await;
        let (response, _) = self.chat_response(model, request, false).await?;
        Ok(translate_stream(response.bytes_stream()))
    }
}

impl ProviderExecutor for ClineExecutor {
    fn as_any(&self) -> &dyn std::any::Any {
        self
    }

    fn id(&self) -> &str {
        ClineExecutor::id(self)
    }

    fn keys(&self) -> &'static [&'static str] {
        ClineExecutor::keys(self)
    }

    fn alias(&self) -> &str {
        ClineExecutor::alias(self)
    }

    fn models(&self) -> Vec<String> {
        ClineExecutor::models(self)
    }

    fn model_id_variants(&self, model: &str) -> Vec<String> {
        ClineExecutor::model_id_variants(self, model)
    }

    fn maybe_refresh(&self, force: bool) -> BoxFuture<'_, ()> {
        Box::pin(async move { ClineExecutor::maybe_refresh(self, force).await })
    }

    fn sweep_tokens(&self) -> BoxFuture<'_, ()> {
        Box::pin(async move {
            if let Err(error) = self.ensure_fresh_token(false).await {
                tracing::debug!(error = %error, "Cline token refresh sweeper check completed with error");
            }
        })
    }

    fn chat_completion<'a>(
        &'a self,
        model: &'a str,
        request: &'a ChatCompletionRequest,
    ) -> BoxFuture<'a, Result<Value, APIError>> {
        Box::pin(async move { ClineExecutor::chat_completion(self, model, request).await })
    }

    fn chat_completion_stream<'a>(
        &'a self,
        model: &'a str,
        request: &'a ChatCompletionRequest,
    ) -> BoxFuture<'a, Result<ProviderStream, APIError>> {
        Box::pin(async move { ClineExecutor::chat_completion_stream(self, model, request).await })
    }
}

pub fn adapter(database: Option<AppDatabase>) -> Result<ProviderAdapter, APIError> {
    adapter_with_endpoints(ClineEndpoints::default(), database)
}

pub fn adapter_with_endpoints(
    endpoints: ClineEndpoints,
    database: Option<AppDatabase>,
) -> Result<ProviderAdapter, APIError> {
    let client = UpstreamClient::new()?;
    Ok(ProviderAdapter::new(ClineExecutor::new(
        endpoints, database, client,
    )))
}
