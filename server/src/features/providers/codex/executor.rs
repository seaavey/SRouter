//! Codex executor: the `openai_codex` driver. Owns the credential-aware
//! transport against the upstream Responses API and the buffered/streaming chat
//! entry points; request encoding lives in `request`, SSE decoding and chunk
//! translation in `translate`, and OAuth refresh in `auth`.

use std::collections::{BTreeMap, HashMap};
use std::sync::{Arc, Mutex};

use futures_util::StreamExt;
use serde_json::Value;

use crate::clock::now_ms;
use crate::constants;
use crate::error::APIError;
use crate::features::providers::adapter::{
    ProviderAdapter, ProviderStream, upstream_error, upstream_status_error,
    upstream_stream_status_error,
};
use crate::features::providers::codex::catalog::{
    CATALOG_REQUEST_TIMEOUT, CodexCatalog, SharedCatalog, read_catalog, write_catalog,
};
use crate::features::providers::codex::types::{
    CODEX_CLIENT_VERSION, CODEX_KEYS, CODEX_ORIGINATOR, CODEX_PROVIDER, CODEX_USER_AGENT,
    CodexEndpoints,
};
use crate::features::providers::executor::{BoxFuture, ProviderExecutor};
use crate::features::providers::wire::{apply_headers, bearer_token};
use crate::infrastructure::database::AppDatabase;
use crate::infrastructure::database::providers::load_codex_credentials;
use crate::infrastructure::upstream::UpstreamClient;
use crate::protocol::model::ChatCompletionRequest;

use super::request::{strip_codex_prefix, upstream_body};
use super::translate::{EventDecoder, Translator, translate_stream};

struct PreparedRequest {
    url: String,
    model_key: String,
    encoded_body: String,
    headers: BTreeMap<&'static str, String>,
}

/// The Codex provider: ChatGPT OAuth credentials plus a Responses API transport.
#[derive(Clone)]
pub struct CodexExecutor {
    id: &'static str,
    keys: &'static [&'static str],
    pub(super) endpoints: CodexEndpoints,
    pub(super) database: Option<AppDatabase>,
    pub(super) client: UpstreamClient,
    catalog: SharedCatalog,
    catalog_refresh_lock: Arc<tokio::sync::Mutex<()>>,
    pub(super) token_refreshes: Arc<Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>>,
}

impl CodexExecutor {
    pub fn new(
        endpoints: CodexEndpoints,
        database: Option<AppDatabase>,
        client: UpstreamClient,
    ) -> Self {
        Self {
            id: CODEX_PROVIDER.id,
            keys: CODEX_KEYS,
            endpoints,
            database,
            client,
            catalog: CodexCatalog::shared_empty(),
            catalog_refresh_lock: Arc::new(tokio::sync::Mutex::new(())),
            token_refreshes: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn id(&self) -> &str {
        self.id
    }

    pub fn keys(&self) -> &'static [&'static str] {
        self.keys
    }

    pub fn alias(&self) -> &str {
        CODEX_PROVIDER.alias
    }

    pub fn models(&self) -> Vec<String> {
        read_catalog(&self.catalog).models.clone()
    }

    /// A model is addressed as `openai_codex/<slug>`; the bare id the upstream
    /// expects is what the registry keeps.
    pub fn model_id_variants(&self, model: &str) -> Vec<String> {
        let bare = strip_codex_prefix(model.trim()).to_lowercase();
        let mut variants = vec![bare.clone()];
        if bare.contains('.') {
            let dash = bare.replace('.', "-");
            if !variants.contains(&dash) {
                variants.push(dash);
            }
        }
        if let Some((prefix, suffix)) = bare.rsplit_once('-') {
            let dot = format!("{prefix}.{suffix}");
            if !variants.contains(&dot) {
                variants.push(dot);
            }
        }
        variants
    }

    pub fn endpoints(&self) -> &CodexEndpoints {
        &self.endpoints
    }

    /// An empty catalog waits for the shared fetch; a populated one refreshes
    /// in the background.
    pub async fn maybe_refresh(&self, force: bool) {
        let Some(database) = self.database.as_ref() else {
            return;
        };
        match load_codex_credentials(database).await {
            Ok(Some(_)) => {}
            Ok(None) => {
                *write_catalog(&self.catalog) = CodexCatalog::empty();
                return;
            }
            Err(_) => return,
        }

        if self.catalog_is_empty() {
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

    fn catalog_is_empty(&self) -> bool {
        read_catalog(&self.catalog).is_empty()
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
        let credentials = self.ensure_fresh_token(false).await?;
        let url = format!(
            "{}/models?client_version={CODEX_CLIENT_VERSION}",
            self.endpoints.api_base_url.trim_end_matches('/')
        );
        let mut request = self
            .client
            .raw()
            .get(&url)
            .timeout(CATALOG_REQUEST_TIMEOUT)
            .header("authorization", bearer_token(&credentials.access_token))
            .header("originator", CODEX_ORIGINATOR)
            .header("user-agent", CODEX_USER_AGENT)
            .header("accept", "application/json");

        if let Some(account_id) = credentials
            .account_id
            .as_deref()
            .filter(|value| !value.trim().is_empty())
        {
            request = request.header("chatgpt-account-id", account_id);
        }

        let response = request.send().await.map_err(upstream_error)?;
        let status = response.status();

        if !status.is_success() {
            let detail = response.text().await.unwrap_or_default();
            return Err(map_status_error(status, &detail));
        }

        let payload = response.json::<Value>().await.map_err(|error| {
            APIError::new(500, constants::providers::could_not_decode_response(&error))
        })?;

        if let Some(catalog) = CodexCatalog::parse_model_list(&payload) {
            *write_catalog(&self.catalog) = catalog;
        }

        Ok(())
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
        let mut translator = Translator::new(&prepared.model_key);
        translator.emit = false;

        while let Some(item) = upstream.next().await {
            let bytes = item.map_err(upstream_error)?;
            for frame in decoder.push(&bytes) {
                translator.accept(frame)?;
            }
        }
        for frame in decoder.finish() {
            translator.accept(frame)?;
        }

        translator.finish_buffered(request)
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
            &prepared.model_key,
        ))
    }

    /// Sends one turn, retrying once after a forced refresh when upstream
    /// answers `401` with a token that has since rotated. `buffered` selects the
    /// total request timeout and the error wording of a failed status.
    async fn chat_response(
        &self,
        model: &str,
        request: &ChatCompletionRequest,
        buffered: bool,
    ) -> Result<(reqwest::Response, PreparedRequest), APIError> {
        let prepared = self.prepare(model, request, false).await?;
        let response = self.send(&prepared, buffered).await?;

        if response.status().as_u16() != 401 {
            return check_status(response, prepared, !buffered);
        }

        drop(response);
        self.ensure_fresh_token(true).await?;
        let prepared = self.prepare(model, request, false).await?;
        let response = self.send(&prepared, buffered).await?;
        check_status(response, prepared, !buffered)
    }

    async fn send(
        &self,
        prepared: &PreparedRequest,
        buffered: bool,
    ) -> Result<reqwest::Response, APIError> {
        let mut request = self
            .client
            .raw()
            .post(&prepared.url)
            .body(prepared.encoded_body.clone());
        if buffered {
            request = request.timeout(self.client.request_timeout());
        }
        request = apply_headers(request, &prepared.headers);
        request.send().await.map_err(upstream_error)
    }

    async fn prepare(
        &self,
        model: &str,
        request: &ChatCompletionRequest,
        force_refresh: bool,
    ) -> Result<PreparedRequest, APIError> {
        let credentials = self.ensure_fresh_token(force_refresh).await?;
        let raw_key = strip_codex_prefix(model.trim());
        let model_key = {
            let catalog = read_catalog(&self.catalog);
            if catalog.models.iter().any(|m| m == raw_key) {
                raw_key.to_owned()
            } else {
                let dash_variant = raw_key.replace('.', "-");
                if catalog.models.iter().any(|m| m == &dash_variant) {
                    dash_variant
                } else {
                    raw_key.to_owned()
                }
            }
        };
        let body = upstream_body(&model_key, request)?;

        let encoded_body = serde_json::to_string(&body).map_err(|error| {
            APIError::new(500, constants::providers::could_not_build_request(&error))
        })?;

        let mut headers = BTreeMap::new();
        headers.insert("authorization", bearer_token(&credentials.access_token));
        headers.insert("content-type", "application/json".to_owned());
        headers.insert("accept", "text/event-stream".to_owned());
        headers.insert("originator", CODEX_ORIGINATOR.to_owned());
        headers.insert("user-agent", CODEX_USER_AGENT.to_owned());
        if let Some(account_id) = credentials
            .account_id
            .as_deref()
            .filter(|value| !value.trim().is_empty())
        {
            headers.insert("chatgpt-account-id", account_id.to_owned());
        }

        Ok(PreparedRequest {
            url: format!(
                "{}/responses",
                self.endpoints.api_base_url.trim_end_matches('/')
            ),
            model_key,
            encoded_body,
            headers,
        })
    }
}

fn map_status_error(status: reqwest::StatusCode, _detail: &str) -> APIError {
    if status.as_u16() == 401 {
        APIError::new(401, constants::providers::codex::TOKEN_EXPIRED)
    } else {
        upstream_status_error(status, "Codex models request failed")
    }
}

/// Maps a failed upstream status onto the client error. `401` becomes the
/// reconnect message instead of a raw upstream body, the way the other OAuth
/// drivers behave.
fn check_status(
    response: reqwest::Response,
    prepared: PreparedRequest,
    streaming: bool,
) -> Result<(reqwest::Response, PreparedRequest), APIError> {
    let status = response.status();
    if status.is_success() {
        return Ok((response, prepared));
    }

    Err(if status.as_u16() == 401 {
        APIError::new(401, constants::providers::codex::TOKEN_EXPIRED)
    } else if streaming {
        upstream_stream_status_error(status, "Codex responses request failed")
    } else {
        upstream_status_error(status, "Codex responses request failed")
    })
}

impl ProviderExecutor for CodexExecutor {
    fn as_any(&self) -> &dyn std::any::Any {
        self
    }

    fn id(&self) -> &str {
        CodexExecutor::id(self)
    }

    fn keys(&self) -> &'static [&'static str] {
        CodexExecutor::keys(self)
    }

    fn alias(&self) -> &str {
        CodexExecutor::alias(self)
    }

    fn models(&self) -> Vec<String> {
        CodexExecutor::models(self)
    }

    fn model_id_variants(&self, model: &str) -> Vec<String> {
        CodexExecutor::model_id_variants(self, model)
    }

    fn maybe_refresh(&self, force: bool) -> BoxFuture<'_, ()> {
        Box::pin(async move { CodexExecutor::maybe_refresh(self, force).await })
    }

    fn sweep_tokens(&self) -> BoxFuture<'_, ()> {
        Box::pin(async move {
            if let Err(error) = self.ensure_fresh_token(false).await {
                tracing::debug!(error = %error, "Codex token refresh sweeper check completed with error");
            }
        })
    }

    fn chat_completion<'a>(
        &'a self,
        model: &'a str,
        request: &'a ChatCompletionRequest,
    ) -> BoxFuture<'a, Result<Value, APIError>> {
        Box::pin(async move { CodexExecutor::chat_completion(self, model, request).await })
    }

    fn chat_completion_stream<'a>(
        &'a self,
        model: &'a str,
        request: &'a ChatCompletionRequest,
    ) -> BoxFuture<'a, Result<ProviderStream, APIError>> {
        Box::pin(async move { CodexExecutor::chat_completion_stream(self, model, request).await })
    }
}

/// Builds the adapter against the production base URL.
pub fn adapter(database: Option<AppDatabase>) -> Result<ProviderAdapter, APIError> {
    adapter_with_endpoints(CodexEndpoints::default(), database)
}

/// Builds the adapter against explicit endpoints; tests inject the fake here.
pub fn adapter_with_endpoints(
    endpoints: CodexEndpoints,
    database: Option<AppDatabase>,
) -> Result<ProviderAdapter, APIError> {
    let client = UpstreamClient::new()?;

    Ok(ProviderAdapter::new(CodexExecutor::new(
        endpoints, database, client,
    )))
}
