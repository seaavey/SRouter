//! Antigravity executor: the static CloudCode IDE catalog and the Gemini-native
//! chat transport.
//!
//! This type is thin. Credentials and the `loadCodeAssist` bootstrap live in
//! [`super::auth`], request/header building and the SSE re-framer in
//! [`super::request`], frame translation in [`super::translate`], and the
//! catalog snapshot policy in [`super::refresh`]. The executor only wires them:
//! it reads its connection from the `providers` row at request time (the
//! static-registry pattern Cline/Codex/CodeBuddy established) and offers the
//! buffered and streamed chat entry points.
//!
//! The catalog is static (17 ids, D2) and gated on the connection, so
//! `models()` is empty until an Antigravity account is connected. The chat
//! endpoint is the always-streaming `daily-cloudcode-pa` SSE URL (D8); a
//! non-stream caller runs the same stream and accumulates. A `400` walks the
//! pro-family cascade, a quota answer gets one `GOOGLE_ONE_AI` retry, and any
//! other failure surfaces as the typed `Antigravity Provider Error`.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use futures_util::StreamExt;
use serde_json::Value;

use super::refresh::{AntigravityCatalog, SharedCatalog, read_catalog};
use super::types::{ANTIGRAVITY_PROVIDER, AntigravityEndpoints};
use crate::clock::now_ms;
use crate::error::APIError;
use crate::features::providers::adapter::{ProviderAdapter, ProviderStream};
use crate::features::providers::executor::{BoxFuture, ProviderExecutor};
use crate::features::providers::wire::stream_error_message;
use crate::infrastructure::database::AppDatabase;
use crate::infrastructure::upstream::UpstreamClient;
use crate::protocol::model::ChatCompletionRequest;
use crate::protocol::sse::SseDataDecoder;

/// Registry lookup keys: the base id and its alias, both `antigravity`.
pub const ANTIGRAVITY_KEYS: &[&str] = &["antigravity"];

/// The Antigravity provider: a Google OAuth session, a static CloudCode model
/// catalog, and a Gemini-native transport.
#[derive(Clone)]
pub struct AntigravityExecutor {
    pub(super) endpoints: AntigravityEndpoints,
    pub(super) database: Option<AppDatabase>,
    pub(super) client: UpstreamClient,
    pub(super) catalog: SharedCatalog,
    pub(super) refresh_locks: Arc<Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>>,
}

impl AntigravityExecutor {
    pub fn new(
        endpoints: AntigravityEndpoints,
        database: Option<AppDatabase>,
        client: UpstreamClient,
    ) -> Self {
        Self {
            endpoints,
            database,
            client,
            catalog: AntigravityCatalog::shared_empty(),
            refresh_locks: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn id(&self) -> &str {
        ANTIGRAVITY_PROVIDER.id
    }

    pub fn keys(&self) -> &'static [&'static str] {
        ANTIGRAVITY_KEYS
    }

    pub fn alias(&self) -> &str {
        ANTIGRAVITY_PROVIDER.alias
    }

    pub fn models(&self) -> Vec<String> {
        read_catalog(&self.catalog).models.clone()
    }

    pub fn endpoints(&self) -> &AntigravityEndpoints {
        &self.endpoints
    }

    /// A non-stream caller runs the SSE stream and accumulates it (D8).
    pub async fn chat_completion(
        &self,
        model: &str,
        request: &ChatCompletionRequest,
    ) -> Result<Value, APIError> {
        let mut stream = self.chat_completion_stream(model, request).await?;
        let mut decoder = SseDataDecoder::new();
        let mut chunks = Vec::new();

        while let Some(item) = stream.next().await {
            for value in decoder.push(&item) {
                if let Some(message) = stream_error_message(&value, "Antigravity stream failed") {
                    return Err(APIError::new(500, message));
                }
                chunks.push(value);
            }
        }

        Ok(super::translate::accumulate_chunks(
            &chunks,
            model,
            now_ms(),
        ))
    }

    /// Opens the SSE response, walking the pro-family cascade on HTTP 400.
    pub async fn chat_completion_stream(
        &self,
        model: &str,
        request: &ChatCompletionRequest,
    ) -> Result<ProviderStream, APIError> {
        self.maybe_refresh(false).await;
        let credentials = self.ensure_fresh_token(false).await?;
        let project_id = self.ensure_project_id(&credentials).await?;

        let candidates = super::translate::model_fallbacks(model);
        let mut last_error = None;

        for (index, candidate) in candidates.iter().enumerate() {
            // The Node oracle re-parses every candidate inside `buildRequest`, so
            // the wire model is the mapped one (the pro chain's raw id maps back
            // to `gemini-pro-agent`). The cascade control flow is unchanged.
            let wire_model = super::translate::parse_model_name(candidate);
            match self
                .send_candidate(&wire_model, request, &project_id, &credentials.access_token)
                .await
            {
                Ok(response) => {
                    return Ok(super::request::stream_response(
                        response.bytes_stream(),
                        model.to_owned(),
                    ));
                }
                // Only a 400 walks the cascade, and only while a candidate remains.
                Err(error) if is_bad_request(&error) && index + 1 < candidates.len() => {
                    last_error = Some(error);
                }
                Err(error) => return Err(error),
            }
        }

        Err(last_error.unwrap_or_else(|| APIError::new(500, "Antigravity request failed")))
    }
}

/// The typed error carries the upstream status in its message; only `(400)`
/// walks the cascade, matching the oracle's `includes("(400)")`.
fn is_bad_request(error: &APIError) -> bool {
    error.message().contains("(400)")
}

impl ProviderExecutor for AntigravityExecutor {
    fn as_any(&self) -> &dyn std::any::Any {
        self
    }

    fn id(&self) -> &str {
        AntigravityExecutor::id(self)
    }

    fn keys(&self) -> &'static [&'static str] {
        AntigravityExecutor::keys(self)
    }

    fn alias(&self) -> &str {
        AntigravityExecutor::alias(self)
    }

    fn models(&self) -> Vec<String> {
        AntigravityExecutor::models(self)
    }

    fn maybe_refresh(&self, force: bool) -> BoxFuture<'_, ()> {
        Box::pin(async move { AntigravityExecutor::maybe_refresh(self, force).await })
    }

    fn sweep_tokens(&self) -> BoxFuture<'_, ()> {
        Box::pin(async move {
            if let Err(error) = self.ensure_fresh_token(false).await {
                tracing::debug!(error = %error, "Antigravity token refresh sweeper check completed with error");
            }
        })
    }

    fn chat_completion<'a>(
        &'a self,
        model: &'a str,
        request: &'a ChatCompletionRequest,
    ) -> BoxFuture<'a, Result<Value, APIError>> {
        Box::pin(async move { AntigravityExecutor::chat_completion(self, model, request).await })
    }

    fn chat_completion_stream<'a>(
        &'a self,
        model: &'a str,
        request: &'a ChatCompletionRequest,
    ) -> BoxFuture<'a, Result<ProviderStream, APIError>> {
        Box::pin(
            async move { AntigravityExecutor::chat_completion_stream(self, model, request).await },
        )
    }
}

/// Builds the adapter against the production endpoints.
pub fn adapter(database: Option<AppDatabase>) -> Result<ProviderAdapter, APIError> {
    adapter_with_endpoints(AntigravityEndpoints::default(), database)
}

/// Builds the adapter against explicit endpoints; tests inject the fake here.
pub fn adapter_with_endpoints(
    endpoints: AntigravityEndpoints,
    database: Option<AppDatabase>,
) -> Result<ProviderAdapter, APIError> {
    let client = UpstreamClient::new()?;

    Ok(ProviderAdapter::new(AntigravityExecutor::new(
        endpoints, database, client,
    )))
}
