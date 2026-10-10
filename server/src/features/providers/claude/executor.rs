//! Claude Code executor: the Anthropic Messages transport over a stored OAuth
//! session, plus the live `/models` catalog.
//!
//! The provider speaks the Anthropic Messages API, so this executor is thin: it
//! loads its connection from the `providers` row at request time (the
//! static-registry pattern Cline/Codex/Antigravity established), turns the
//! internal OpenAI request into an Anthropic body, and translates the buffered
//! response or the SSE stream back to OpenAI shapes. Credentials, the lazy
//! refresh, and the catalog snapshot all live here; the wire translation is the
//! same shape `apps/api` uses (`packages/executors/src/anthropic.ts` and
//! `packages/translator/src/adapter.ts`), reproduced from the oracle rather than
//! imported.
//!
//! The catalog is live (`GET {base}/models`), gated on the connection: a build
//! without a Claude account advertises no `claude` model. `maybe_refresh` warms
//! it from the boot task, the model routes, and a successful connection write.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use serde_json::{Value, json};

use super::catalog::{
    CATALOG_RETRY_MS, CATALOG_TTL_MS, ClaudeCatalog, SharedCatalog, read_catalog, write_catalog,
};
use super::types::{
    CLAUDE_ANTHROPIC_VERSION, CLAUDE_CLI_HEADERS, CLAUDE_OAUTH_CLIENT_ID, CLAUDE_PROVIDER,
    ClaudeEndpoints, anthropic_beta,
};
use crate::clock::now_ms;
use crate::constants;
use crate::error::APIError;
use crate::features::providers::adapter::{ProviderAdapter, ProviderStream};
use crate::features::providers::anthropic::{
    anthropic_body, anthropic_response_to_openai, stream_response,
};
use crate::features::providers::executor::{BoxFuture, ProviderExecutor};
use crate::infrastructure::database::AppDatabase;
use crate::infrastructure::database::providers::{
    ClaudeCredentials, load_claude_credentials, update_claude_tokens,
};
use crate::infrastructure::upstream::UpstreamClient;
use crate::protocol::model::ChatCompletionRequest;

/// Registry lookup keys: the base id and its alias, both `claude`.
pub const CLAUDE_KEYS: &[&str] = &["claude"];

/// Refresh the access token this long before it expires.
const TOKEN_REFRESH_LEAD_MS: i64 = 5 * 60 * 1000;

/// The Claude provider: an Anthropic OAuth session and a live model catalog.
#[derive(Clone)]
pub struct ClaudeExecutor {
    pub(super) endpoints: ClaudeEndpoints,
    pub(super) database: Option<AppDatabase>,
    pub(super) client: UpstreamClient,
    pub(super) catalog: SharedCatalog,
    pub(super) refresh_locks: Arc<Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>>,
}

impl ClaudeExecutor {
    pub fn new(
        endpoints: ClaudeEndpoints,
        database: Option<AppDatabase>,
        client: UpstreamClient,
    ) -> Self {
        Self {
            endpoints,
            database,
            client,
            catalog: ClaudeCatalog::shared_empty(),
            refresh_locks: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn id(&self) -> &str {
        CLAUDE_PROVIDER.id
    }

    pub fn keys(&self) -> &'static [&'static str] {
        CLAUDE_KEYS
    }

    pub fn alias(&self) -> &str {
        CLAUDE_PROVIDER.alias
    }

    pub fn models(&self) -> Vec<String> {
        read_catalog(&self.catalog).models.clone()
    }

    pub fn endpoints(&self) -> &ClaudeEndpoints {
        &self.endpoints
    }

    /// A buffered inference request, translated from the Anthropic response.
    pub async fn chat_completion(
        &self,
        model: &str,
        request: &ChatCompletionRequest,
    ) -> Result<Value, APIError> {
        let credentials = self.ensure_fresh_token(false).await?;
        let body = anthropic_body(request, model, false);
        let response = self.send(&credentials, model, &body, false).await?;
        let status = response.status();
        if !status.is_success() {
            let detail = response.text().await.unwrap_or_default();
            return Err(APIError::new(
                status.as_u16(),
                constants::providers::claude::provider_error(status.as_u16(), &detail),
            ));
        }

        let payload: Value = response.json().await.map_err(|error| {
            APIError::new(500, constants::providers::could_not_decode_response(&error))
        })?;

        Ok(anthropic_response_to_openai(
            &payload,
            &request.model,
            now_ms() / 1000,
        ))
    }

    /// A streaming inference request, re-framed from the Anthropic SSE stream.
    pub async fn chat_completion_stream(
        &self,
        model: &str,
        request: &ChatCompletionRequest,
    ) -> Result<ProviderStream, APIError> {
        let credentials = self.ensure_fresh_token(false).await?;
        let body = anthropic_body(request, model, true);
        let response = self.send(&credentials, model, &body, true).await?;
        let status = response.status();
        if !status.is_success() {
            let detail = response.text().await.unwrap_or_default();
            return Err(APIError::new(
                status.as_u16(),
                constants::providers::claude::provider_stream_error(status.as_u16(), &detail),
            ));
        }

        Ok(stream_response(
            response.bytes_stream(),
            request.model.clone(),
        ))
    }

    /// POSTs an Anthropic body with the OAuth headers. A transport failure is a
    /// `500`; a non-success status is returned to the caller to type.
    async fn send(
        &self,
        credentials: &ClaudeCredentials,
        model: &str,
        body: &Value,
        stream: bool,
    ) -> Result<reqwest::Response, APIError> {
        let mut builder = self
            .client
            .raw()
            .post(&self.endpoints.chat_url)
            .timeout(self.client.request_timeout())
            .header("content-type", "application/json")
            .header("anthropic-version", CLAUDE_ANTHROPIC_VERSION)
            .header("anthropic-beta", anthropic_beta(model))
            .header(
                "authorization",
                format!("Bearer {}", credentials.access_token),
            );
        for (name, value) in CLAUDE_CLI_HEADERS {
            builder = builder.header(*name, *value);
        }
        if let Some(organization_id) = credentials.organization_id.as_deref() {
            builder = builder.header("anthropic-organization-id", organization_id);
        }
        if stream {
            builder = builder.header("accept", "text/event-stream");
        }

        builder
            .json(body)
            .send()
            .await
            .map_err(|error| APIError::new(500, constants::providers::request_failed(&error)))
    }

    /// The newest enabled Claude connection, or the "not connected" error.
    pub(super) async fn credentials(&self) -> Result<ClaudeCredentials, APIError> {
        let database = self
            .database
            .as_ref()
            .ok_or_else(|| APIError::new(500, constants::providers::claude::DATABASE_REQUIRED))?;

        load_claude_credentials(database)
            .await?
            .ok_or_else(|| APIError::new(401, constants::providers::claude::NOT_CONNECTED))
    }

    /// Credentials whose access token is fresh, refreshing under a
    /// per-connection lock when the token is inside the lead window. A token
    /// without a refresh token is used as-is; a transient refresh failure keeps
    /// a still-valid token instead of revoking the session.
    pub(super) async fn ensure_fresh_token(
        &self,
        force: bool,
    ) -> Result<ClaudeCredentials, APIError> {
        let credentials = self.credentials().await?;
        if !force && !token_refresh_is_due(&credentials, now_ms()) {
            return Ok(credentials);
        }

        let Some(refresh_token) = credentials.refresh_token.clone() else {
            return Ok(credentials);
        };

        let refresh_lock = {
            let mut locks = self
                .refresh_locks
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            locks
                .entry(credentials.id.clone())
                .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())))
                .clone()
        };
        let _guard = refresh_lock.lock().await;

        let current = self.credentials().await?;
        if !force && !token_refresh_is_due(&current, now_ms()) {
            return Ok(current);
        }
        let refresh_token = current.refresh_token.clone().unwrap_or(refresh_token);

        match self.refresh_token(&current, &refresh_token).await {
            Ok(refreshed) => Ok(refreshed),
            Err(error) if error.status() >= 500 && !current.is_expired(now_ms()) => Ok(current),
            Err(error) => Err(error),
        }
    }

    async fn refresh_token(
        &self,
        current: &ClaudeCredentials,
        refresh_token: &str,
    ) -> Result<ClaudeCredentials, APIError> {
        let database = self
            .database
            .as_ref()
            .ok_or_else(|| APIError::new(500, constants::providers::claude::DATABASE_REQUIRED))?;

        // Claude OAuth: JSON body, `client_id` only, no client secret.
        let body = json!({
            "grant_type": "refresh_token",
            "client_id": CLAUDE_OAUTH_CLIENT_ID,
            "refresh_token": refresh_token,
        });
        let response = self
            .client
            .raw()
            .post(&self.endpoints.token_url)
            .timeout(self.client.request_timeout())
            .header("content-type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|error| {
                APIError::new(
                    500,
                    constants::providers::claude::refresh_transport_failed(&error),
                )
            })?;
        let status = response.status();
        let payload = response.json::<Value>().await.unwrap_or(Value::Null);
        if !status.is_success() {
            return Err(APIError::new(
                500,
                constants::providers::claude::refresh_failed(status.as_u16()),
            ));
        }

        let access_token = payload
            .get("access_token")
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| APIError::new(500, constants::providers::claude::EMPTY_TOKEN_RESPONSE))?
            .to_owned();
        let refresh_token = payload
            .get("refresh_token")
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .map(str::to_owned)
            .unwrap_or_else(|| refresh_token.to_owned());
        let expires_at = payload
            .get("expires_in")
            .and_then(Value::as_i64)
            .filter(|seconds| *seconds > 0)
            .map(|seconds| now_ms() + seconds.saturating_mul(1000));

        update_claude_tokens(
            database,
            &current.id,
            &access_token,
            &refresh_token,
            expires_at,
            now_ms(),
        )
        .await?;

        Ok(ClaudeCredentials {
            id: current.id.clone(),
            access_token,
            refresh_token: Some(refresh_token),
            expires_at,
            organization_id: current.organization_id.clone(),
        })
    }

    /// Flips the live catalog on/off from the connection and refetches it when
    /// stale, or unconditionally when `force` is set.
    pub async fn maybe_refresh(&self, force: bool) {
        let Some(database) = self.database.as_ref() else {
            write_catalog(&self.catalog).models.clear();
            return;
        };

        let Ok(Some(credentials)) = load_claude_credentials(database).await else {
            write_catalog(&self.catalog).models.clear();
            return;
        };

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
        write_catalog(&self.catalog).attempted_at_ms = now;

        // A refresh failure falls back to the credentials just loaded: the fetch
        // then fails on the stale token and the landed catalog stays as it was.
        let credentials = self.ensure_fresh_token(false).await.unwrap_or(credentials);
        // A failed fetch never empties a catalog that already landed.
        if let Ok(models) = self.fetch_models(&credentials).await {
            let mut catalog = write_catalog(&self.catalog);
            catalog.models = models;
            catalog.fetched_at_ms = now;
        }
    }

    /// Reads the live model list from `GET {base}/models`.
    async fn fetch_models(&self, credentials: &ClaudeCredentials) -> Result<Vec<String>, APIError> {
        let mut builder = self
            .client
            .raw()
            .get(&self.endpoints.models_url)
            .timeout(self.client.request_timeout())
            .header("anthropic-version", CLAUDE_ANTHROPIC_VERSION)
            .header(
                "authorization",
                format!("Bearer {}", credentials.access_token),
            );
        for (name, value) in CLAUDE_CLI_HEADERS {
            builder = builder.header(*name, *value);
        }
        if let Some(organization_id) = credentials.organization_id.as_deref() {
            builder = builder.header("anthropic-organization-id", organization_id);
        }

        let response = builder
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

        Ok(ClaudeCatalog::parse_model_list(&payload)
            .map(|catalog| catalog.models)
            .unwrap_or_default())
    }
}

/// Whether the access token is inside the refresh lead window.
fn token_refresh_is_due(credentials: &ClaudeCredentials, now_ms: i64) -> bool {
    credentials
        .expires_at
        .is_some_and(|expiry| expiry - now_ms <= TOKEN_REFRESH_LEAD_MS)
}

impl ProviderExecutor for ClaudeExecutor {
    fn as_any(&self) -> &dyn std::any::Any {
        self
    }

    fn id(&self) -> &str {
        ClaudeExecutor::id(self)
    }

    fn keys(&self) -> &'static [&'static str] {
        ClaudeExecutor::keys(self)
    }

    fn alias(&self) -> &str {
        ClaudeExecutor::alias(self)
    }

    fn models(&self) -> Vec<String> {
        ClaudeExecutor::models(self)
    }

    fn maybe_refresh(&self, force: bool) -> BoxFuture<'_, ()> {
        Box::pin(async move { ClaudeExecutor::maybe_refresh(self, force).await })
    }

    fn sweep_tokens(&self) -> BoxFuture<'_, ()> {
        Box::pin(async move {
            if let Err(error) = self.ensure_fresh_token(false).await {
                tracing::debug!(error = %error, "Claude token refresh sweeper check completed with error");
            }
        })
    }

    fn chat_completion<'a>(
        &'a self,
        model: &'a str,
        request: &'a ChatCompletionRequest,
    ) -> BoxFuture<'a, Result<Value, APIError>> {
        Box::pin(async move { ClaudeExecutor::chat_completion(self, model, request).await })
    }

    fn chat_completion_stream<'a>(
        &'a self,
        model: &'a str,
        request: &'a ChatCompletionRequest,
    ) -> BoxFuture<'a, Result<ProviderStream, APIError>> {
        Box::pin(async move { ClaudeExecutor::chat_completion_stream(self, model, request).await })
    }
}

/// Builds the adapter against the production endpoints.
pub fn adapter(database: Option<AppDatabase>) -> Result<ProviderAdapter, APIError> {
    adapter_with_endpoints(ClaudeEndpoints::default(), database)
}

/// Builds the adapter against explicit endpoints; tests inject the fake here.
pub fn adapter_with_endpoints(
    endpoints: ClaudeEndpoints,
    database: Option<AppDatabase>,
) -> Result<ProviderAdapter, APIError> {
    let client = UpstreamClient::new()?;

    Ok(ProviderAdapter::new(ClaudeExecutor::new(
        endpoints, database, client,
    )))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{anthropic_body, anthropic_response_to_openai};
    use crate::protocol::model::{ChatCompletionRequest, ChatContent, ChatMessage, ChatRole};

    fn request(messages: Vec<ChatMessage>, max_tokens: Option<u32>) -> ChatCompletionRequest {
        serde_json::from_value(json!({
            "model": "claude-sonnet-4-5",
            "messages": messages,
            "max_tokens": max_tokens,
        }))
        .expect("request deserializes")
    }

    fn message(role: ChatRole, content: ChatContent) -> ChatMessage {
        ChatMessage {
            role,
            content,
            name: None,
            tool_calls: None,
            tool_call_id: None,
            cache_control: None,
        }
    }

    #[test]
    fn the_body_moves_the_system_message_to_the_top_level() {
        let req = request(
            vec![
                message(ChatRole::System, ChatContent::Text("be terse".to_owned())),
                message(ChatRole::User, ChatContent::Text("hi".to_owned())),
                message(ChatRole::Assistant, ChatContent::Text("hello".to_owned())),
            ],
            Some(100),
        );

        let body = anthropic_body(&req, "claude-sonnet-4-5", true);

        assert_eq!(body["system"], "be terse");
        assert_eq!(body["max_tokens"], 100);
        assert_eq!(body["stream"], true);
        assert_eq!(body["messages"].as_array().unwrap().len(), 2);
        assert_eq!(body["messages"][0]["role"], "user");
        assert_eq!(body["messages"][0]["content"], "hi");
        assert_eq!(body["messages"][1]["role"], "assistant");
    }

    #[test]
    fn a_missing_max_tokens_defaults_to_4096() {
        let req = request(
            vec![message(ChatRole::User, ChatContent::Text("hi".to_owned()))],
            None,
        );

        assert_eq!(anthropic_body(&req, "m", false)["max_tokens"], 4096);
    }

    #[test]
    fn the_response_joins_text_blocks_and_maps_usage() {
        let payload = json!({
            "id": "msg_1",
            "content": [
                { "type": "text", "text": "hello " },
                { "type": "thinking", "thinking": "hmm" },
                { "type": "text", "text": "world" }
            ],
            "stop_reason": "max_tokens",
            "usage": { "input_tokens": 10, "output_tokens": 5 }
        });

        let completion = anthropic_response_to_openai(&payload, "claude/claude-sonnet-4-5", 7);

        assert_eq!(
            completion["choices"][0]["message"]["content"],
            "hello world"
        );
        assert_eq!(completion["choices"][0]["finish_reason"], "length");
        assert_eq!(completion["usage"]["prompt_tokens"], 10);
        assert_eq!(completion["usage"]["completion_tokens"], 5);
        assert_eq!(completion["usage"]["total_tokens"], 15);
        assert_eq!(completion["model"], "claude/claude-sonnet-4-5");
    }

    #[test]
    fn a_normal_stop_maps_to_stop() {
        let payload = json!({ "content": [], "stop_reason": "end_turn", "usage": {} });

        let completion = anthropic_response_to_openai(&payload, "m", 0);

        assert_eq!(completion["choices"][0]["finish_reason"], "stop");
        assert_eq!(completion["usage"]["total_tokens"], 0);
    }
}
