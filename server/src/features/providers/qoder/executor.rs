//! Qoder executor: builds the COSY-signed upstream request and translates the
//! gateway's wrapped SSE envelope back into OpenAI frames.
//!
//! The upstream never speaks OpenAI on the wire: every frame is an envelope
//! holding a stringified OpenAI chunk, there is no `data: [DONE]`, and the
//! frames arrive fragmented across TCP reads. Both directions of that translation
//! live in [`super::request`] and [`super::translate`], so the gateway handlers
//! only ever see OpenAI.

use std::sync::{Arc, RwLock};

use futures_util::StreamExt;
use serde_json::Value;

use super::catalog::{QoderCatalog, SharedCatalog};
use super::state::read_catalog;
use super::translate::{Aggregator, data_payload, translate_stream};
use super::types::{QODER_KEYS, QODER_PROVIDER, QoderEndpoints};
use crate::error::APIError;
use crate::features::providers::adapter::{ProviderAdapter, ProviderStream, upstream_error};
use crate::features::providers::executor::{BoxFuture, ProviderExecutor};
use crate::infrastructure::database::AppDatabase;
use crate::infrastructure::upstream::UpstreamClient;
use crate::protocol::model::ChatCompletionRequest;

// Re-exported so `qoder::executor::machine_id_for` keeps resolving for the
// device-flow login.
pub use super::auth::machine_id_for;

/// The executor for Qoder models. It owns the endpoints, the live model
/// catalog, and the database handle its credentials are read from, because the
/// registry is built before `AppState` exists and cannot inject them later.
#[derive(Clone)]
pub struct QoderExecutor {
    id: &'static str,
    keys: &'static [&'static str],
    pub(super) endpoints: QoderEndpoints,
    pub(super) database: Option<AppDatabase>,
    pub(super) client: UpstreamClient,
    pub(super) catalog: SharedCatalog,
    pub(super) machine_id: Arc<RwLock<Option<String>>>,
    /// Shared through the `Arc` because the registry stores one clone of this
    /// adapter per lookup key, and both clones must coalesce into one fetch.
    pub(super) refresh_lock: Arc<tokio::sync::Mutex<()>>,
}

impl QoderExecutor {
    pub fn new(
        endpoints: QoderEndpoints,
        database: Option<AppDatabase>,
        client: UpstreamClient,
    ) -> Self {
        Self {
            id: QODER_PROVIDER.id,
            keys: QODER_KEYS,
            endpoints,
            database,
            client,
            catalog: QoderCatalog::shared_empty(),
            machine_id: Arc::new(RwLock::new(None)),
            refresh_lock: Arc::new(tokio::sync::Mutex::new(())),
        }
    }

    pub fn id(&self) -> &'static str {
        self.id
    }

    pub fn keys(&self) -> &'static [&'static str] {
        self.keys
    }

    pub fn alias(&self) -> &'static str {
        QODER_PROVIDER.alias
    }

    /// Advertised model ids: the keys of the live snapshot plus the friendly
    /// names it accepted, empty until the first fetch lands. Nothing upstream has
    /// not confirmed is ever advertised.
    pub fn models(&self) -> Vec<String> {
        read_catalog(&self.catalog).models.clone()
    }

    /// Every id the snapshot advertises for the model `model` names, the id as
    /// asked first. A name the snapshot does not hold stands alone, so no sibling
    /// is invented here.
    pub fn model_id_variants(&self, model: &str) -> Vec<String> {
        let model = model.trim().to_lowercase();
        let catalog = read_catalog(&self.catalog);
        let key = catalog.key_for_id(&model).unwrap_or(model.as_str());
        let mut variants = vec![model.clone()];

        variants.extend(
            catalog
                .ids_for_key(key)
                .into_iter()
                .map(|id| id.to_lowercase())
                .filter(|id| id != &model),
        );

        variants
    }

    pub fn endpoints(&self) -> &QoderEndpoints {
        &self.endpoints
    }

    pub async fn chat_completion(
        &self,
        model: &str,
        request: &ChatCompletionRequest,
    ) -> Result<Value, APIError> {
        self.maybe_refresh(false).await;
        let prepared = self.prepare(model, request).await?;
        let response = self.send_chat(&prepared, true).await?;
        let mut stream = response.bytes_stream();

        let mut aggregator = Aggregator::new(&prepared.model_key);
        let mut line_buffer = String::new();

        while let Some(item) = stream.next().await {
            let bytes = item.map_err(upstream_error)?;
            line_buffer.push_str(&String::from_utf8_lossy(&bytes));

            while let Some(position) = line_buffer.find('\n') {
                let line = line_buffer[..position].trim_end_matches('\r').to_owned();
                line_buffer.drain(..=position);

                if let Some(envelope) = data_payload(&line) {
                    aggregator.accept(envelope)?;
                }
            }
        }

        aggregator.finish(request)
    }

    pub async fn chat_completion_stream(
        &self,
        model: &str,
        request: &ChatCompletionRequest,
    ) -> Result<ProviderStream, APIError> {
        self.maybe_refresh(false).await;
        let prepared = self.prepare(model, request).await?;
        let response = self.send_chat(&prepared, false).await?;

        Ok(translate_stream(
            response.bytes_stream(),
            prepared.model_key,
        ))
    }
}

impl ProviderExecutor for QoderExecutor {
    fn as_any(&self) -> &dyn std::any::Any {
        self
    }

    fn id(&self) -> &'static str {
        QoderExecutor::id(self)
    }

    fn keys(&self) -> &'static [&'static str] {
        QoderExecutor::keys(self)
    }

    fn alias(&self) -> &'static str {
        QoderExecutor::alias(self)
    }

    fn models(&self) -> Vec<String> {
        QoderExecutor::models(self)
    }

    fn model_id_variants(&self, model: &str) -> Vec<String> {
        QoderExecutor::model_id_variants(self, model)
    }

    fn maybe_refresh(&self, force: bool) -> BoxFuture<'_, ()> {
        Box::pin(async move { QoderExecutor::maybe_refresh(self, force).await })
    }

    fn chat_completion<'a>(
        &'a self,
        model: &'a str,
        request: &'a ChatCompletionRequest,
    ) -> BoxFuture<'a, Result<Value, APIError>> {
        Box::pin(async move { QoderExecutor::chat_completion(self, model, request).await })
    }

    fn chat_completion_stream<'a>(
        &'a self,
        model: &'a str,
        request: &'a ChatCompletionRequest,
    ) -> BoxFuture<'a, Result<ProviderStream, APIError>> {
        Box::pin(async move { QoderExecutor::chat_completion_stream(self, model, request).await })
    }
}

/// Builds the adapter against the production endpoints.
pub fn adapter(database: Option<AppDatabase>) -> Result<ProviderAdapter, APIError> {
    adapter_with_endpoints(QoderEndpoints::default(), database)
}

/// Builds the adapter against explicit endpoints, which is how tests point it
/// at a fake upstream.
pub fn adapter_with_endpoints(
    endpoints: QoderEndpoints,
    database: Option<AppDatabase>,
) -> Result<ProviderAdapter, APIError> {
    let client = UpstreamClient::new()?;

    Ok(ProviderAdapter::new(QoderExecutor::new(
        endpoints, database, client,
    )))
}
