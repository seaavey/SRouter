//! CodeBuddy executor: the live model catalog and the chat transport.
//!
//! Both flavors (global and China) share this one type; [`Flavor`] selects the
//! endpoints, headers, and registry identity. The wire behavior mirrors the Node
//! oracle (`packages/executors/src/codebuddy.ts`): a minimal header set, a forced
//! `stream: true`, a leading `"You are CodeBuddy Code."` system prompt, typed
//! user blocks, and a `response_format` mirrored into the last user turn. The
//! real client sends a header superset and never injects that system prompt.
//!
//! There is deliberately no token refresh: the OAuth login returns a token that
//! is valid for about a year, so an expired token surfaces as an upstream error
//! and the operator reconnects.
//!
//! Credentials and base headers live in [`super::auth`], request building in
//! [`super::request`], the catalog refresh in [`super::refresh`], and the stream
//! translation in [`super::translate`].

use std::sync::Arc;

use futures_util::StreamExt;
use serde_json::Value;

use super::catalog::{CodeBuddyCatalog, SharedCatalog, read_catalog};
use super::translate::{Aggregator, LineDecoder, translate_stream};
use super::types::{CodeBuddyEndpoints, Flavor};
use crate::error::APIError;
use crate::features::providers::adapter::{ProviderAdapter, ProviderStream, upstream_error};
use crate::features::providers::executor::{BoxFuture, ProviderExecutor};
use crate::infrastructure::database::AppDatabase;
use crate::infrastructure::upstream::UpstreamClient;
use crate::protocol::model::ChatCompletionRequest;

// Re-exported so `codebuddy::executor::CATALOG_REQUEST_TIMEOUT` keeps resolving.
pub use super::refresh::CATALOG_REQUEST_TIMEOUT;

/// CodeBuddy's live catalog and credential-backed OpenAI-compatible transport.
#[derive(Clone)]
pub struct CodeBuddyExecutor {
    pub(super) flavor: Flavor,
    pub(super) endpoints: CodeBuddyEndpoints,
    pub(super) database: Option<AppDatabase>,
    pub(super) client: UpstreamClient,
    pub catalog: SharedCatalog,
    pub(super) catalog_refresh_lock: Arc<tokio::sync::Mutex<()>>,
}

impl CodeBuddyExecutor {
    pub fn new(
        flavor: Flavor,
        endpoints: CodeBuddyEndpoints,
        database: Option<AppDatabase>,
        client: UpstreamClient,
    ) -> Self {
        Self {
            flavor,
            endpoints,
            database,
            client,
            catalog: CodeBuddyCatalog::shared_empty(),
            catalog_refresh_lock: Arc::new(tokio::sync::Mutex::new(())),
        }
    }

    pub fn flavor(&self) -> Flavor {
        self.flavor
    }

    pub fn endpoints(&self) -> &CodeBuddyEndpoints {
        &self.endpoints
    }

    pub fn id(&self) -> &'static str {
        self.flavor.provider_id()
    }

    pub fn keys(&self) -> &'static [&'static str] {
        self.flavor.keys()
    }

    pub fn alias(&self) -> &'static str {
        self.flavor.alias()
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
            for frame in decoder.push(&bytes) {
                aggregator.accept(frame)?;
            }
        }
        for frame in decoder.finish() {
            aggregator.accept(frame)?;
        }

        Ok(aggregator.finish())
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

impl ProviderExecutor for CodeBuddyExecutor {
    fn as_any(&self) -> &dyn std::any::Any {
        self
    }

    fn id(&self) -> &'static str {
        CodeBuddyExecutor::id(self)
    }

    fn keys(&self) -> &'static [&'static str] {
        CodeBuddyExecutor::keys(self)
    }

    fn alias(&self) -> &'static str {
        CodeBuddyExecutor::alias(self)
    }

    fn models(&self) -> Vec<String> {
        CodeBuddyExecutor::models(self)
    }

    fn maybe_refresh(&self, force: bool) -> BoxFuture<'_, ()> {
        Box::pin(async move { CodeBuddyExecutor::maybe_refresh(self, force).await })
    }

    fn chat_completion<'a>(
        &'a self,
        model: &'a str,
        request: &'a ChatCompletionRequest,
    ) -> BoxFuture<'a, Result<Value, APIError>> {
        Box::pin(async move { CodeBuddyExecutor::chat_completion(self, model, request).await })
    }

    fn chat_completion_stream<'a>(
        &'a self,
        model: &'a str,
        request: &'a ChatCompletionRequest,
    ) -> BoxFuture<'a, Result<ProviderStream, APIError>> {
        Box::pin(
            async move { CodeBuddyExecutor::chat_completion_stream(self, model, request).await },
        )
    }
}

pub fn adapter(flavor: Flavor, database: Option<AppDatabase>) -> Result<ProviderAdapter, APIError> {
    adapter_with_endpoints(flavor, flavor.endpoints(), database)
}

pub fn adapter_with_endpoints(
    flavor: Flavor,
    endpoints: CodeBuddyEndpoints,
    database: Option<AppDatabase>,
) -> Result<ProviderAdapter, APIError> {
    let client = UpstreamClient::new()?;
    Ok(ProviderAdapter::new(CodeBuddyExecutor::new(
        flavor, endpoints, database, client,
    )))
}
