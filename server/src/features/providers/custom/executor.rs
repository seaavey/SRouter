//! The generic driver for a user-registered provider. One `CustomProvider`
//! serves one `providers` row: the row carries its UUID, model prefix, base URL, and
//! protocol, so nothing is compiled in.
//!
//! Two protocol families, matching the two Node executors the provider dialog
//! offers: `openai` forwards the OpenAI chat-completions request as-is, and
//! `anthropic` translates through the shared [`crate::features::providers::anthropic`]
//! helpers. Credentials are read from the row at request time, so a key rotated
//! elsewhere is picked up without a re-registration.

use std::sync::Arc;

use serde_json::Value;

use crate::clock::now_ms;
use crate::constants;
use crate::error::APIError;
use crate::features::providers::adapter::{
    ProviderAdapter, ProviderStream, encode_stream, upstream_error, upstream_status_error,
    upstream_stream_status_error,
};
use crate::features::providers::anthropic::{
    anthropic_body, anthropic_response_to_openai, stream_response,
};
use crate::features::providers::custom::CustomProviderRow;
use crate::features::providers::custom::catalog::{
    CATALOG_RETRY_MS, CATALOG_TTL_MS, SharedCatalog, read_catalog, write_catalog,
};
use crate::features::providers::executor::{BoxFuture, ProviderExecutor};
use crate::infrastructure::database::AppDatabase;
use crate::infrastructure::database::providers::{CustomCredentials, load_custom_credentials};
use crate::infrastructure::upstream::UpstreamClient;
use crate::protocol::image::ImageGenerationRequest;
use crate::protocol::model::ChatCompletionRequest;

/// The protocol a custom provider speaks. Only the two the provider dialog
/// offers; anything else falls back to `OpenAI`, matching Node's
/// `ProviderDefinitionFromConfig` default.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProviderShape {
    OpenAI,
    Anthropic,
}

impl ProviderShape {
    pub fn parse(protocol: &str) -> Self {
        match protocol.trim().to_lowercase().as_str() {
            "anthropic" => Self::Anthropic,
            _ => Self::OpenAI,
        }
    }
}

/// A user-registered provider, built from one `providers` row.
#[derive(Clone)]
pub struct CustomProvider {
    row: CustomProviderRow,
    shape: ProviderShape,
    database: Option<AppDatabase>,
    client: UpstreamClient,
    catalog: SharedCatalog,
    refresh_lock: Arc<tokio::sync::Mutex<()>>,
}

impl CustomProvider {
    pub fn new(row: CustomProviderRow, database: Option<AppDatabase>) -> Result<Self, APIError> {
        let shape = ProviderShape::parse(&row.protocol);

        Ok(Self {
            row,
            shape,
            database,
            client: UpstreamClient::new()?,
            catalog: crate::features::providers::custom::catalog::CustomCatalog::shared_empty(),
            refresh_lock: Arc::new(tokio::sync::Mutex::new(())),
        })
    }

    /// The upstream base URL with any trailing slash trimmed, the way Node
    /// normalizes it in the executor constructors.
    fn base_url(&self) -> &str {
        self.row.base_url.trim_end_matches('/')
    }

    /// The user-facing model prefix: the row's prefix, or its id when none was
    /// given, mirroring Node's `providerAlias(providerBaseId(uuid))`.
    fn model_prefix(&self) -> &str {
        self.row.prefix.as_deref().unwrap_or(&self.row.id)
    }

    /// Reads the row's credentials at request time. A row without a database
    /// handle cannot be reached; the gateway always has one.
    async fn credentials(&self) -> Result<CustomCredentials, APIError> {
        let database = self
            .database
            .as_ref()
            .ok_or_else(|| APIError::new(500, constants::providers::DATABASE_REQUIRED))?;

        Ok(load_custom_credentials(database, &self.row.id)
            .await?
            .unwrap_or_default())
    }

    /// The upstream chat endpoint for this protocol family.
    fn chat_url(&self) -> String {
        match self.shape {
            ProviderShape::OpenAI => format!("{}/chat/completions", self.base_url()),
            ProviderShape::Anthropic => format!("{}/messages", self.base_url()),
        }
    }

    /// The upstream model-list endpoint.
    fn models_url(&self) -> String {
        format!("{}/models", self.base_url())
    }

    /// Builds the upstream payload for an OpenAI-shaped provider: the caller's
    /// request with the resolved bare model id and this driver's stream flag.
    fn openai_body(
        &self,
        model: &str,
        request: &ChatCompletionRequest,
        stream: bool,
    ) -> Result<Value, APIError> {
        let mut body = serde_json::to_value(request).map_err(|error| {
            APIError::new(500, constants::providers::could_not_build_request(&error))
        })?;
        body["model"] = Value::String(model.to_owned());
        body["stream"] = Value::Bool(stream);

        Ok(body)
    }

    /// The request body for either protocol family.
    fn request_body(
        &self,
        model: &str,
        request: &ChatCompletionRequest,
        stream: bool,
    ) -> Result<Value, APIError> {
        match self.shape {
            ProviderShape::OpenAI => self.openai_body(model, request, stream),
            ProviderShape::Anthropic => Ok(anthropic_body(request, model, stream)),
        }
    }

    /// Signs one upstream request builder: `Authorization: Bearer` for OpenAI
    /// and the Anthropic header set (plus the CLI fingerprint) for Anthropic,
    /// then any operator-supplied custom headers on top.
    fn sign(
        &self,
        builder: reqwest::RequestBuilder,
        credentials: &CustomCredentials,
    ) -> reqwest::RequestBuilder {
        let mut builder = builder.header("content-type", "application/json");
        if let Some(token) = credentials.token() {
            match self.shape {
                ProviderShape::OpenAI => {
                    builder = builder.header("authorization", format!("Bearer {token}"));
                }
                ProviderShape::Anthropic => {
                    builder = builder
                        .header("authorization", format!("Bearer {token}"))
                        .header("x-api-key", token)
                        .header(
                            "anthropic-version",
                            crate::features::providers::claude::types::CLAUDE_ANTHROPIC_VERSION,
                        );
                    for (name, value) in
                        crate::features::providers::claude::types::CLAUDE_CLI_HEADERS
                    {
                        builder = builder.header(*name, *value);
                    }
                }
            }
        }

        for (name, value) in &credentials.custom_headers {
            builder = builder.header(name, value);
        }

        builder
    }

    pub async fn chat_completion(
        &self,
        model: &str,
        request: &ChatCompletionRequest,
    ) -> Result<Value, APIError> {
        let credentials = self.credentials().await?;
        let body = self.request_body(model, request, false)?;
        let response = self
            .sign(
                self.client
                    .raw()
                    .post(self.chat_url())
                    .timeout(self.client.request_timeout()),
                &credentials,
            )
            .json(&body)
            .send()
            .await
            .map_err(upstream_error)?;

        let status = response.status();
        if !status.is_success() {
            let detail = response.text().await.unwrap_or_default();
            return Err(upstream_status_error(status, &detail));
        }

        let payload: Value = response.json().await.map_err(|error| {
            APIError::new(500, constants::providers::could_not_decode_response(&error))
        })?;

        Ok(match self.shape {
            ProviderShape::OpenAI => payload,
            ProviderShape::Anthropic => {
                anthropic_response_to_openai(&payload, &request.model, now_ms() / 1000)
            }
        })
    }

    pub async fn chat_completion_stream(
        &self,
        model: &str,
        request: &ChatCompletionRequest,
    ) -> Result<ProviderStream, APIError> {
        let credentials = self.credentials().await?;
        let body = self.request_body(model, request, true)?;
        let response = self
            .sign(self.client.raw().post(self.chat_url()), &credentials)
            .json(&body)
            .send()
            .await
            .map_err(upstream_error)?;

        let status = response.status();
        if !status.is_success() {
            let detail = response.text().await.unwrap_or_default();
            return Err(upstream_stream_status_error(status, &detail));
        }

        Ok(match self.shape {
            ProviderShape::OpenAI => encode_stream(response.bytes_stream()),
            ProviderShape::Anthropic => {
                stream_response(response.bytes_stream(), request.model.clone())
            }
        })
    }

    /// The live model ids. A fetch is due when the snapshot is empty past the
    /// retry window, or filled past the TTL.
    pub async fn maybe_refresh(&self, force: bool) {
        let now = now_ms();
        let due = {
            let catalog = read_catalog(&self.catalog);
            force
                || (catalog.models.is_empty() && now - catalog.attempted_at_ms >= CATALOG_RETRY_MS)
                || (!catalog.models.is_empty() && now - catalog.fetched_at_ms >= CATALOG_TTL_MS)
        };
        if !due {
            return;
        }

        // One fetch at a time per provider: a burst of catalog reads would
        // otherwise each start their own upstream call.
        let _guard = self.refresh_lock.lock().await;

        let now = now_ms();
        {
            let mut catalog = write_catalog(&self.catalog);
            catalog.attempted_at_ms = now;
        }

        let Ok(credentials) = self.credentials().await else {
            return;
        };
        if let Ok(models) = self.fetch_models(&credentials).await {
            let mut catalog = write_catalog(&self.catalog);
            catalog.models = models;
            catalog.fetched_at_ms = now;
        }
    }

    /// Reads the live model list from `GET {base}/models`.
    async fn fetch_models(&self, credentials: &CustomCredentials) -> Result<Vec<String>, APIError> {
        let response = self
            .sign(
                self.client
                    .raw()
                    .get(self.models_url())
                    .timeout(self.client.request_timeout()),
                credentials,
            )
            .send()
            .await
            .map_err(|error| APIError::new(500, constants::providers::request_failed(&error)))?;
        if !response.status().is_success() {
            return Err(APIError::new(
                500,
                constants::providers::request_failed("model list rejected"),
            ));
        }
        let payload: Value = response.json().await.map_err(|error| {
            APIError::new(500, constants::providers::could_not_decode_response(&error))
        })?;

        Ok(
            crate::features::providers::custom::catalog::CustomCatalog::parse_model_list(&payload)
                .unwrap_or_default(),
        )
    }

    /// Clears the catalog when the row is gone, so a deleted provider stops
    /// advertising models before the registry drops it.
    pub async fn clear_catalog(&self) {
        write_catalog(&self.catalog).models.clear();
    }

    /// An OpenAI-compatible image request. The Anthropic shape does not serve
    /// image generation, so it falls through to the trait default.
    pub async fn generate_image(
        &self,
        model: &str,
        request: &ImageGenerationRequest,
    ) -> Result<Value, APIError> {
        if self.shape != ProviderShape::OpenAI {
            return Err(
                APIError::new(400, constants::gateway::model_not_supported_image(model))
                    .with_code(constants::ErrorCode::ModelNotSupported)
                    .with_param("model"),
            );
        }

        let credentials = self.credentials().await?;
        let url = format!("{}/images/generations", self.base_url());
        let mut body = serde_json::to_value(request).map_err(|error| {
            APIError::new(500, constants::providers::could_not_build_request(&error))
        })?;
        body["model"] = Value::String(model.to_owned());

        let response = self
            .sign(
                self.client
                    .raw()
                    .post(&url)
                    .timeout(self.client.request_timeout()),
                &credentials,
            )
            .json(&body)
            .send()
            .await
            .map_err(upstream_error)?;

        let status = response.status();
        if !status.is_success() {
            let detail = response.text().await.unwrap_or_default();
            return Err(upstream_status_error(status, &detail));
        }

        response.json::<Value>().await.map_err(|error| {
            APIError::new(500, constants::providers::could_not_decode_response(&error))
        })
    }
}

impl ProviderExecutor for CustomProvider {
    fn as_any(&self) -> &dyn std::any::Any {
        self
    }

    fn id(&self) -> &str {
        &self.row.id
    }

    /// A runtime provider holds no `'static` key slice; the registry reads
    /// [`ProviderExecutor::keys_owned`] instead.
    fn keys(&self) -> &'static [&'static str] {
        &[]
    }

    fn keys_owned(&self) -> Vec<String> {
        let mut keys = vec![self.row.id.to_lowercase()];
        if let Some(prefix) = self.row.prefix.as_deref() {
            let prefix = prefix.to_lowercase();
            if prefix != keys[0] {
                keys.push(prefix);
            }
        }

        keys
    }

    fn alias(&self) -> &str {
        self.model_prefix()
    }

    fn models(&self) -> Vec<String> {
        read_catalog(&self.catalog).models.clone()
    }

    fn maybe_refresh(&self, force: bool) -> BoxFuture<'_, ()> {
        Box::pin(async move { CustomProvider::maybe_refresh(self, force).await })
    }

    fn chat_completion<'a>(
        &'a self,
        model: &'a str,
        request: &'a ChatCompletionRequest,
    ) -> BoxFuture<'a, Result<Value, APIError>> {
        Box::pin(async move { CustomProvider::chat_completion(self, model, request).await })
    }

    fn chat_completion_stream<'a>(
        &'a self,
        model: &'a str,
        request: &'a ChatCompletionRequest,
    ) -> BoxFuture<'a, Result<ProviderStream, APIError>> {
        Box::pin(async move { CustomProvider::chat_completion_stream(self, model, request).await })
    }

    fn generate_image<'a>(
        &'a self,
        model: &'a str,
        request: &'a ImageGenerationRequest,
    ) -> BoxFuture<'a, Result<Value, APIError>> {
        Box::pin(async move { CustomProvider::generate_image(self, model, request).await })
    }
}

/// Wraps a stored row as a registry adapter.
pub fn adapter_from_row(
    row: CustomProviderRow,
    database: Option<AppDatabase>,
) -> Result<ProviderAdapter, APIError> {
    Ok(ProviderAdapter::new(CustomProvider::new(row, database)?))
}

/// Alias kept for symmetry with the built-in drivers' `adapter` constructors.
pub fn adapter(
    row: CustomProviderRow,
    database: Option<AppDatabase>,
) -> Result<ProviderAdapter, APIError> {
    adapter_from_row(row, database)
}
