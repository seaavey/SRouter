//! Command Code executor: the live model catalog and the `/alpha/generate`
//! transport.
//!
//! The relay is stream-only, so the buffered path runs the same NDJSON decode as
//! the streaming one and aggregates it — one translation to keep correct, not
//! two. There is deliberately no token refresh: the sign-in hands back a static
//! key, so an expired one surfaces as an upstream 401 and the operator
//! reconnects (the CodeBuddy policy).
//!
//! Credentials and base headers live in [`super::auth`], request building in
//! [`super::request`], the catalog refresh in [`super::refresh`], and the event
//! translation in [`super::translate`].

use std::sync::Arc;

use futures_util::StreamExt;
use serde_json::Value;

use super::catalog::{CommandCodeCatalog, SharedCatalog, read_catalog};
use super::translate::{Aggregator, LineDecoder, translate_stream};
use super::types::CommandCodeEndpoints;
use crate::error::APIError;
use crate::features::providers::adapter::{ProviderAdapter, ProviderStream, upstream_error};
use crate::features::providers::executor::{BoxFuture, ProviderExecutor};
use crate::infrastructure::database::AppDatabase;
use crate::infrastructure::upstream::UpstreamClient;
use crate::protocol::model::ChatCompletionRequest;

// Re-exported so `commandcode::executor::CATALOG_REQUEST_TIMEOUT` keeps resolving.
pub use super::refresh::CATALOG_REQUEST_TIMEOUT;

/// Command Code's live catalog and CLI-keyed transport.
#[derive(Clone)]
pub struct CommandCodeExecutor {
    pub(super) endpoints: CommandCodeEndpoints,
    pub(super) database: Option<AppDatabase>,
    pub(super) client: UpstreamClient,
    pub catalog: SharedCatalog,
    pub(super) catalog_refresh_lock: Arc<tokio::sync::Mutex<()>>,
}

impl CommandCodeExecutor {
    pub fn new(
        endpoints: CommandCodeEndpoints,
        database: Option<AppDatabase>,
        client: UpstreamClient,
    ) -> Self {
        Self {
            endpoints,
            database,
            client,
            catalog: CommandCodeCatalog::shared_empty(),
            catalog_refresh_lock: Arc::new(tokio::sync::Mutex::new(())),
        }
    }

    pub fn endpoints(&self) -> &CommandCodeEndpoints {
        &self.endpoints
    }

    pub fn id(&self) -> &str {
        "commandcode"
    }

    pub fn keys(&self) -> &'static [&'static str] {
        super::types::COMMANDCODE_KEYS
    }

    pub fn alias(&self) -> &str {
        "commandcode"
    }

    pub fn models(&self) -> Vec<String> {
        read_catalog(&self.catalog).models.clone()
    }

    pub async fn chat_completion(
        &self,
        model: &str,
        request: &ChatCompletionRequest,
    ) -> Result<Value, APIError> {
        self.maybe_refresh(false).await;
        let (response, prepared) = self.chat_response(model, request, true).await?;
        let mut upstream = response.bytes_stream();
        let mut decoder = LineDecoder::default();
        let mut aggregator = Aggregator::new(&prepared.model_key);

        while let Some(item) = upstream.next().await {
            let bytes = item.map_err(upstream_error)?;
            for event in decoder.push(&bytes) {
                aggregator.accept(event)?;
            }
        }
        for event in decoder.finish() {
            aggregator.accept(event)?;
        }

        aggregator.finish()
    }

    pub async fn chat_completion_stream(
        &self,
        model: &str,
        request: &ChatCompletionRequest,
    ) -> Result<ProviderStream, APIError> {
        self.maybe_refresh(false).await;
        let (response, prepared) = self.chat_response(model, request, false).await?;

        Ok(translate_stream(
            response.bytes_stream(),
            prepared.model_key,
        ))
    }
}

impl ProviderExecutor for CommandCodeExecutor {
    fn as_any(&self) -> &dyn std::any::Any {
        self
    }

    fn id(&self) -> &str {
        CommandCodeExecutor::id(self)
    }

    fn keys(&self) -> &'static [&'static str] {
        CommandCodeExecutor::keys(self)
    }

    fn alias(&self) -> &str {
        CommandCodeExecutor::alias(self)
    }

    fn models(&self) -> Vec<String> {
        CommandCodeExecutor::models(self)
    }

    fn maybe_refresh(&self, force: bool) -> BoxFuture<'_, ()> {
        Box::pin(async move { CommandCodeExecutor::maybe_refresh(self, force).await })
    }

    fn chat_completion<'a>(
        &'a self,
        model: &'a str,
        request: &'a ChatCompletionRequest,
    ) -> BoxFuture<'a, Result<Value, APIError>> {
        Box::pin(async move { CommandCodeExecutor::chat_completion(self, model, request).await })
    }

    fn chat_completion_stream<'a>(
        &'a self,
        model: &'a str,
        request: &'a ChatCompletionRequest,
    ) -> BoxFuture<'a, Result<ProviderStream, APIError>> {
        Box::pin(
            async move { CommandCodeExecutor::chat_completion_stream(self, model, request).await },
        )
    }
}

pub fn adapter(database: Option<AppDatabase>) -> Result<ProviderAdapter, APIError> {
    adapter_with_endpoints(CommandCodeEndpoints::default(), database)
}

pub fn adapter_with_endpoints(
    endpoints: CommandCodeEndpoints,
    database: Option<AppDatabase>,
) -> Result<ProviderAdapter, APIError> {
    let client = UpstreamClient::new()?;
    Ok(ProviderAdapter::new(CommandCodeExecutor::new(
        endpoints, database, client,
    )))
}
