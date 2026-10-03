//! Codex executor: credential load and lazy refresh, the upstream Responses API
//! request shape, and the translation of Responses SSE into OpenAI chat frames.
//!
//! Upstream speaks the OpenAI Responses API (`POST {base}/responses`, SSE event
//! names like `response.output_text.delta`), while the gateway serves Chat
//! Completions. This module owns both directions: the request encoder, the SSE
//! decoder, and the chunk translator used by the streaming path and by the
//! buffered path (which always calls upstream with `stream: true` and folds the
//! deltas into one completion).

use std::collections::{BTreeMap, HashMap, VecDeque};
use std::pin::Pin;
use std::sync::{Arc, Mutex};

use axum::body::Bytes;
use futures_util::{Stream, StreamExt};
use reqwest::header::{HeaderName, HeaderValue};
use serde::Deserialize;
use serde_json::Value;

use crate::clock::now_ms;
use crate::constants;
use crate::error::APIError;
use crate::features::gateway::model::{
    ChatCompletionRequest, ChatContent, ChatMessage, ChatRole, ResponseFormat, ToolChoice,
    ToolChoiceMode,
};
use crate::features::gateway::sse;
use crate::features::gateway::usage::UsageBreakdown;
use crate::features::providers::adapter::{
    ProviderAdapter, ProviderStream, upstream_error, upstream_status_error,
    upstream_stream_status_error,
};
use crate::features::providers::codex::catalog::{
    CATALOG_REQUEST_TIMEOUT, CodexCatalog, SharedCatalog, read_catalog, write_catalog,
};
use crate::features::providers::codex::types::{
    CODEX_CLIENT_VERSION, CODEX_KEYS, CODEX_OAUTH_CLIENT_ID, CODEX_ORIGINATOR, CODEX_PROVIDER,
    CODEX_USER_AGENT, CodexEndpoints,
};
use crate::features::providers::executor::{BoxFuture, ProviderExecutor};
use crate::infrastructure::database::AppDatabase;
use crate::infrastructure::database::providers::{
    CodexCredentials, load_codex_credentials, update_codex_tokens,
};
use crate::infrastructure::upstream::{STREAM_IDLE_TIMEOUT, UpstreamClient};

/// Refresh this long before the access token expires; mirrors the Node sweeper's
/// lead time (`apps/api/src/services/tokenRefresh.ts`).
const TOKEN_REFRESH_LEAD_MS: i64 = 5 * 60 * 1000;
/// Refresh a token with no known expiry once a day, the Node fallback.
const TOKEN_REFRESH_FALLBACK_MS: i64 = 12 * 60 * 60 * 1000;

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
    endpoints: CodexEndpoints,
    database: Option<AppDatabase>,
    client: UpstreamClient,
    catalog: SharedCatalog,
    catalog_refresh_lock: Arc<tokio::sync::Mutex<()>>,
    token_refreshes: Arc<Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>>,
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

    pub fn id(&self) -> &'static str {
        self.id
    }

    pub fn keys(&self) -> &'static [&'static str] {
        self.keys
    }

    pub fn alias(&self) -> &'static str {
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
        if !matches!(load_codex_credentials(database).await, Ok(Some(_))) {
            return;
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

    async fn credentials(&self) -> Result<CodexCredentials, APIError> {
        let database = self
            .database
            .as_ref()
            .ok_or_else(|| APIError::new(500, constants::providers::codex::DATABASE_REQUIRED))?;

        load_codex_credentials(database)
            .await
            .ok()
            .flatten()
            .ok_or_else(|| APIError::new(401, constants::providers::codex::NOT_CONNECTED))
    }

    async fn ensure_fresh_token(&self, force: bool) -> Result<CodexCredentials, APIError> {
        let credentials = self.credentials().await?;
        if !force && !token_refresh_is_due(&credentials, now_ms()) {
            return Ok(credentials);
        }

        let Some(refresh_token) = credentials.refresh_token.as_deref() else {
            if credentials.is_expired(now_ms()) || force {
                return Err(APIError::new(
                    401,
                    constants::providers::codex::TOKEN_EXPIRED,
                ));
            }
            return Ok(credentials);
        };

        let refresh_lock = {
            let mut refreshes = self
                .token_refreshes
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            refreshes
                .entry(credentials.id.clone())
                .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())))
                .clone()
        };
        let _guard = refresh_lock.lock().await;

        let current = self.credentials().await?;
        if !force && !token_refresh_is_due(&current, now_ms()) {
            return Ok(current);
        }
        let refresh_token = current.refresh_token.as_deref().unwrap_or(refresh_token);

        match self
            .refresh_token(&current.id, refresh_token, current.account_id.clone())
            .await
        {
            Ok(refreshed) => Ok(refreshed),
            // A transient upstream failure must not revoke a still-valid session.
            Err(error) if error.status() >= 500 && !current.is_expired(now_ms()) => Ok(current),
            Err(error) => Err(error),
        }
    }

    async fn refresh_token(
        &self,
        connection_id: &str,
        refresh_token: &str,
        account_id: Option<String>,
    ) -> Result<CodexCredentials, APIError> {
        let database = self
            .database
            .as_ref()
            .ok_or_else(|| APIError::new(500, constants::providers::codex::DATABASE_REQUIRED))?;
        let form = url::form_urlencoded::Serializer::new(String::new())
            .append_pair("grant_type", "refresh_token")
            .append_pair("refresh_token", refresh_token)
            .append_pair("client_id", CODEX_OAUTH_CLIENT_ID)
            .finish();
        let response = self
            .client
            .raw()
            .post(&self.endpoints.token_url)
            .timeout(self.client.request_timeout())
            .header("content-type", "application/x-www-form-urlencoded")
            .body(form)
            .send()
            .await
            .map_err(|error| {
                APIError::new(
                    500,
                    constants::providers::codex::refresh_transport_failed(error),
                )
            })?;
        let status = response.status();
        let payload = response.json::<Value>().await.unwrap_or(Value::Null);

        if status.is_client_error() || payload_reports_invalid_grant(&payload) {
            return Err(APIError::new(
                401,
                constants::providers::codex::TOKEN_EXPIRED,
            ));
        }
        if !status.is_success() {
            return Err(APIError::new(
                500,
                constants::providers::codex::refresh_failed(status.as_u16()),
            ));
        }

        let access_token = payload
            .get("access_token")
            .and_then(Value::as_str)
            .filter(|token| !token.trim().is_empty())
            .ok_or_else(|| APIError::new(401, constants::providers::codex::TOKEN_EXPIRED))?;
        let rotated_refresh = payload
            .get("refresh_token")
            .and_then(Value::as_str)
            .filter(|token| !token.trim().is_empty())
            .unwrap_or(refresh_token);
        let expires_at = payload
            .get("expires_in")
            .and_then(Value::as_i64)
            .map(|seconds| now_ms() + seconds.saturating_mul(1000));
        let refreshed_at = now_ms();

        update_codex_tokens(
            database,
            connection_id,
            access_token,
            rotated_refresh,
            expires_at,
            refreshed_at,
        )
        .await?;

        Ok(CodexCredentials {
            id: connection_id.to_owned(),
            access_token: access_token.to_owned(),
            refresh_token: Some(rotated_refresh.to_owned()),
            account_id,
            token_expires_at: expires_at,
            last_refreshed_at: Some(refreshed_at),
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

/// Builds the Responses API body for one turn: the message transcript becomes
/// `input` items, chat tools become flat function tools, and the stream flags
/// are the adapter's own (`stream: true`, `store: false`, the shape the official
/// client sends).
fn upstream_body(model_key: &str, request: &ChatCompletionRequest) -> Result<Value, APIError> {
    let mut body = serde_json::json!({
        "model": model_key,
        "input": input_items(&request.messages),
        "stream": true,
        "store": false,
    });

    if let Some(tools) = &request.tools
        && !tools.is_empty()
    {
        body["tools"] = Value::Array(
            tools
                .iter()
                .map(|tool| {
                    serde_json::json!({
                        "type": "function",
                        "name": tool.function.name,
                        "description": tool.function.description,
                        "parameters": tool.function.parameters,
                    })
                })
                .collect(),
        );
    }

    if let Some(tool_choice) = &request.tool_choice {
        body["tool_choice"] = match tool_choice {
            ToolChoice::Mode(ToolChoiceMode::None) => Value::String("none".to_owned()),
            ToolChoice::Mode(ToolChoiceMode::Auto) => Value::String("auto".to_owned()),
            ToolChoice::Mode(ToolChoiceMode::Required) => Value::String("required".to_owned()),
            ToolChoice::Named(named) => serde_json::json!({
                "type": "function",
                "name": named.function.name,
            }),
        };
    }

    // `none` disables reasoning on the chat schema; the Responses API has no
    // such value, so the field is dropped and upstream runs its default.
    let effort = request
        .reasoning
        .as_ref()
        .and_then(|options| options.effort.as_deref())
        .or(request.reasoning_effort.as_deref())
        .filter(|effort| !effort.eq_ignore_ascii_case("none"));
    if let Some(effort) = effort {
        body["reasoning"] = serde_json::json!({ "effort": effort });
    }

    if let Some(max_tokens) = request.max_tokens {
        body["max_output_tokens"] = Value::from(max_tokens);
    }
    if let Some(temperature) = request.temperature {
        body["temperature"] = Value::from(temperature);
    }
    if let Some(top_p) = request.top_p {
        body["top_p"] = Value::from(top_p);
    }

    if let Some(format) = request.response_format.as_ref().and_then(text_format) {
        body["text"] = serde_json::json!({ "format": format });
    }

    serde_json::to_value(&body)
        .map_err(|error| APIError::new(500, constants::providers::could_not_build_request(&error)))
}

/// Maps the chat `response_format` onto the Responses `text.format` object.
/// An unknown shape is dropped rather than sent as a guess.
fn text_format(format: &ResponseFormat) -> Option<Value> {
    match format.kind.as_str() {
        "json_object" => Some(serde_json::json!({ "type": "json_object" })),
        "json_schema" => {
            // Chat requests nest the schema under `json_schema`; the Responses
            // API wants the parts flattened into `text.format`.
            let nested = format.json_schema.as_ref().and_then(Value::as_object);
            let name = format
                .name
                .clone()
                .or_else(|| {
                    nested
                        .and_then(|object| object.get("name"))
                        .and_then(Value::as_str)
                        .map(str::to_owned)
                })
                .unwrap_or_else(|| "response".to_owned());
            let schema = nested
                .and_then(|object| object.get("schema"))
                .cloned()
                .or_else(|| format.json_schema.clone())?;
            let strict = format.strict.or_else(|| {
                nested
                    .and_then(|object| object.get("strict"))
                    .and_then(Value::as_bool)
            });

            let mut mapped = serde_json::json!({
                "type": "json_schema",
                "name": name,
                "schema": schema,
            });
            if let Some(strict) = strict {
                mapped["strict"] = Value::Bool(strict);
            }
            Some(mapped)
        }
        _ => None,
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

/// Turns the chat transcript into Responses `input` items: messages, tool
/// results as `function_call_output`, and assistant tool calls as
/// `function_call` items.
fn input_items(messages: &[ChatMessage]) -> Vec<Value> {
    let mut items = Vec::with_capacity(messages.len());

    for message in messages {
        let role = match message.role {
            ChatRole::System | ChatRole::Developer => "developer",
            ChatRole::User => "user",
            ChatRole::Assistant => "assistant",
            ChatRole::Tool | ChatRole::Function => {
                items.push(function_call_output(message));
                continue;
            }
        };

        let text_part_type = if message.role == ChatRole::Assistant {
            "output_text"
        } else {
            "input_text"
        };
        let content = content_parts(&message.content, text_part_type);
        if !content.is_empty() {
            items.push(serde_json::json!({
                "type": "message",
                "role": role,
                "content": content,
            }));
        }

        if let Some(tool_calls) = &message.tool_calls {
            for call in tool_calls {
                items.push(serde_json::json!({
                    "type": "function_call",
                    "call_id": call.id,
                    "name": call.function.name,
                    "arguments": call.function.arguments,
                }));
            }
        }
    }

    items
}

fn function_call_output(message: &ChatMessage) -> Value {
    let call_id = message
        .tool_call_id
        .clone()
        .or_else(|| message.name.clone())
        .unwrap_or_default();
    let output = match &message.content {
        ChatContent::Text(text) => text.clone(),
        ChatContent::Parts(parts) => parts
            .iter()
            .filter_map(|part| part.text.as_ref())
            .cloned()
            .collect::<Vec<_>>()
            .join("\n"),
        ChatContent::Null => String::new(),
    };

    serde_json::json!({
        "type": "function_call_output",
        "call_id": call_id,
        "output": output,
    })
}

fn content_parts(content: &ChatContent, text_part_type: &str) -> Vec<Value> {
    let mut parts = Vec::new();
    match content {
        ChatContent::Text(text) => {
            if !text.is_empty() {
                parts.push(serde_json::json!({
                    "type": text_part_type,
                    "text": text,
                }));
            }
        }
        ChatContent::Parts(entries) => {
            for entry in entries {
                if let Some(text) = &entry.text
                    && !text.is_empty()
                {
                    parts.push(serde_json::json!({
                        "type": text_part_type,
                        "text": text,
                    }));
                } else if let Some(image) = &entry.image_url {
                    let mut part = serde_json::json!({
                        "type": "input_image",
                        "image_url": image.url,
                    });
                    if let Some(detail) = image.detail {
                        part["detail"] = serde_json::json!(detail);
                    }
                    parts.push(part);
                }
            }
        }
        ChatContent::Null => {}
    }
    parts
}

fn strip_codex_prefix(model: &str) -> &str {
    model
        .strip_prefix("openai_codex/")
        .or_else(|| model.strip_prefix("codex/"))
        .unwrap_or(model)
}

fn bearer_token(token: &str) -> String {
    format!("Bearer {token}")
}

fn apply_headers(
    request: reqwest::RequestBuilder,
    headers: &BTreeMap<&'static str, String>,
) -> reqwest::RequestBuilder {
    headers.iter().fold(request, |request, (name, value)| {
        match (
            HeaderName::from_bytes(name.as_bytes()),
            HeaderValue::from_str(value),
        ) {
            (Ok(name), Ok(value)) => request.header(name, value),
            _ => request,
        }
    })
}

fn token_refresh_is_due(credentials: &CodexCredentials, now: i64) -> bool {
    match credentials.token_expires_at {
        Some(expires_at) => now >= expires_at.saturating_sub(TOKEN_REFRESH_LEAD_MS),
        None => credentials
            .last_refreshed_at
            .is_none_or(|refreshed_at| now - refreshed_at >= TOKEN_REFRESH_FALLBACK_MS),
    }
}

fn payload_reports_invalid_grant(payload: &Value) -> bool {
    error_message(payload).is_some_and(|message| message.to_lowercase().contains("invalid_grant"))
}

/// The message of an upstream error body, which the API answers either as a
/// flat string or as the OpenAI `{ "error": { "message" } }` object.
fn error_message(payload: &Value) -> Option<String> {
    field_error_message(payload.get("error")?)
}

/// Reads one message out of an `error` value of either spelling.
fn field_error_message(error: &Value) -> Option<String> {
    if let Some(message) = error.as_str() {
        return Some(message.to_owned());
    }
    error
        .get("message")
        .or_else(|| error.get("code"))
        .and_then(Value::as_str)
        .map(str::to_owned)
}

/// One event of the upstream Responses SSE stream, tagged by its `type`.
/// Events the translator does not care about — and any event a newer upstream
/// grows — land in `Ignored` instead of failing the parse.
#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
enum ResponsesEvent {
    #[serde(rename = "response.output_text.delta")]
    OutputTextDelta { delta: String },
    #[serde(rename = "response.reasoning_text.delta")]
    ReasoningTextDelta { delta: String },
    #[serde(rename = "response.reasoning_summary_text.delta")]
    ReasoningSummaryTextDelta { delta: String },
    #[serde(rename = "response.output_item.added")]
    OutputItemAdded {
        output_index: Option<i64>,
        item: Value,
    },
    #[serde(rename = "response.function_call_arguments.delta")]
    FunctionCallArgumentsDelta {
        output_index: Option<i64>,
        delta: String,
    },
    #[serde(rename = "response.completed")]
    Completed { response: Value },
    #[serde(rename = "response.incomplete")]
    Incomplete { response: Value },
    #[serde(rename = "response.failed")]
    Failed { response: Value },
    #[serde(rename = "error")]
    Error {
        message: Option<String>,
        error: Option<Value>,
    },
    #[serde(other)]
    Ignored,
}

impl ResponsesEvent {
    /// The failure this event carries: the message of an `error` event, or the
    /// `response.error` payload of a failed response. A response that merely
    /// ran out of tokens carries no error.
    fn error(&self) -> Option<String> {
        match self {
            Self::Error { message, error } => message
                .clone()
                .or_else(|| error.as_ref().and_then(field_error_message)),
            Self::Failed { response } | Self::Incomplete { response } => response
                .get("error")
                .and_then(field_error_message)
                .filter(|message| !message.is_empty()),
            _ => None,
        }
    }
}

/// Why the turn ended, in the vocabulary of the chat protocol.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum FinishReason {
    Stop,
    ToolCalls,
    Length,
}

impl FinishReason {
    fn as_str(self) -> &'static str {
        match self {
            Self::Stop => "stop",
            Self::ToolCalls => "tool_calls",
            Self::Length => "length",
        }
    }
}

#[derive(Debug)]
enum DecodedFrame {
    Event(ResponsesEvent),
    /// A payload the decoder could not parse into an event; forwarded as-is.
    Raw,
    Done,
    Error(APIError),
}

/// Splits an SSE body into events across arbitrary TCP fragmentations: lines
/// accumulate until the blank line that ends an event.
#[derive(Default)]
struct EventDecoder {
    buffer: String,
    event_lines: Vec<String>,
    finished: bool,
}

impl EventDecoder {
    fn push(&mut self, bytes: &[u8]) -> Vec<DecodedFrame> {
        if self.finished {
            return Vec::new();
        }
        self.buffer.push_str(&String::from_utf8_lossy(bytes));
        let mut frames = Vec::new();

        while let Some(position) = self.buffer.find('\n') {
            let line = self.buffer[..position].trim_end_matches('\r').to_owned();
            self.buffer.drain(..=position);
            if line.is_empty() {
                if let Some(frame) = self.take_event() {
                    frames.push(frame);
                }
            } else {
                self.event_lines.push(line);
            }
        }

        frames
    }

    fn finish(&mut self) -> Vec<DecodedFrame> {
        if self.finished {
            return Vec::new();
        }
        if !self.buffer.is_empty() {
            self.event_lines.push(
                std::mem::take(&mut self.buffer)
                    .trim_end_matches('\r')
                    .to_owned(),
            );
        }

        self.take_event().into_iter().collect()
    }

    fn take_event(&mut self) -> Option<DecodedFrame> {
        let lines = std::mem::take(&mut self.event_lines);
        let payload = lines
            .iter()
            .filter_map(|line| line.strip_prefix("data:").map(str::trim_start))
            .collect::<Vec<_>>()
            .join("\n");
        if payload.is_empty() {
            return None;
        }
        if payload.trim() == "[DONE]" {
            self.finished = true;
            return Some(DecodedFrame::Done);
        }

        match serde_json::from_str::<Value>(&payload)
            .ok()
            .and_then(|value| serde_json::from_value::<ResponsesEvent>(value).ok())
        {
            Some(event) => match event.error() {
                Some(message) => Some(DecodedFrame::Error(APIError::new(500, message))),
                None => Some(DecodedFrame::Event(event)),
            },
            None => Some(DecodedFrame::Raw),
        }
    }
}

/// Feeds Responses events and produces OpenAI `chat.completion.chunk` values.
/// The buffered path runs the same translator with `emit = false`, folding the
/// accumulated state into one completion instead of chunks.
struct Translator {
    emit: bool,
    model: String,
    id: String,
    created: i64,
    content: String,
    reasoning: String,
    tool_calls: BTreeMap<usize, Value>,
    arguments: BTreeMap<usize, String>,
    tool_index_by_output: HashMap<i64, usize>,
    next_tool_index: usize,
    usage: Option<Value>,
    finish_reason: Option<FinishReason>,
}

impl Translator {
    fn new(model: &str) -> Self {
        Self {
            emit: true,
            model: model.to_owned(),
            id: format!("chatcmpl-{}", random_hex(16)),
            created: now_ms() / 1000,
            content: String::new(),
            reasoning: String::new(),
            tool_calls: BTreeMap::new(),
            arguments: BTreeMap::new(),
            tool_index_by_output: HashMap::new(),
            next_tool_index: 0,
            usage: None,
            finish_reason: None,
        }
    }

    fn accept(&mut self, frame: DecodedFrame) -> Result<Vec<Value>, APIError> {
        match frame {
            DecodedFrame::Event(event) => Ok(self.accept_event(event)),
            DecodedFrame::Raw | DecodedFrame::Done => Ok(Vec::new()),
            DecodedFrame::Error(error) => Err(error),
        }
    }

    fn accept_event(&mut self, event: ResponsesEvent) -> Vec<Value> {
        match event {
            ResponsesEvent::OutputTextDelta { delta } => {
                self.content.push_str(&delta);
                self.chunk(serde_json::json!({ "content": delta }))
            }
            ResponsesEvent::ReasoningTextDelta { delta }
            | ResponsesEvent::ReasoningSummaryTextDelta { delta } => {
                self.reasoning.push_str(&delta);
                self.chunk(serde_json::json!({ "reasoning": delta }))
            }
            ResponsesEvent::OutputItemAdded { output_index, item } => {
                if item.get("type").and_then(Value::as_str) != Some("function_call") {
                    return Vec::new();
                }
                let index = self.register_tool_call(&item, output_index);
                self.chunk(serde_json::json!({ "tool_calls": [self.tool_call_start(index)] }))
            }
            ResponsesEvent::FunctionCallArgumentsDelta {
                output_index,
                delta,
            } => {
                let Some(index) = self.tool_index(output_index) else {
                    return Vec::new();
                };
                self.arguments.entry(index).or_default().push_str(&delta);
                self.chunk(serde_json::json!({
                    "tool_calls": [{ "index": index, "function": { "arguments": delta } }]
                }))
            }
            ResponsesEvent::Completed { response } => {
                self.capture_usage(&response);
                self.finish_reason = Some(self.default_finish_reason());
                Vec::new()
            }
            ResponsesEvent::Incomplete { response } => {
                // A response cut off by `max_output_tokens` still is a normal
                // end of stream; the chat protocol reports it as `length`.
                self.capture_usage(&response);
                let reason = response
                    .get("incomplete_details")
                    .and_then(|details| details.get("reason"))
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                self.finish_reason = Some(if reason.contains("max_output") {
                    FinishReason::Length
                } else {
                    self.default_finish_reason()
                });
                Vec::new()
            }
            // Failures arrive as `DecodedFrame::Error` from the decoder; the
            // remaining variants carry nothing the translation needs.
            ResponsesEvent::Failed { .. }
            | ResponsesEvent::Error { .. }
            | ResponsesEvent::Ignored => Vec::new(),
        }
    }

    fn capture_usage(&mut self, response: &Value) {
        if let Some(usage) = response.get("usage").filter(|usage| !usage.is_null()) {
            self.usage = Some(normalize_usage(usage));
        }
    }

    fn register_tool_call(&mut self, item: &Value, output_index: Option<i64>) -> usize {
        let index = self.next_tool_index;
        self.next_tool_index += 1;
        if let Some(output_index) = output_index {
            self.tool_index_by_output.insert(output_index, index);
        }
        let call_id = item
            .get("call_id")
            .or_else(|| item.get("id"))
            .and_then(Value::as_str)
            .unwrap_or_default();
        let mut entry = serde_json::json!({
            "index": index,
            "type": "function",
            "function": {
                "name": item.get("name").and_then(Value::as_str).unwrap_or_default(),
                "arguments": "",
            }
        });
        if !call_id.is_empty() {
            entry["id"] = Value::String(call_id.to_owned());
        }
        self.tool_calls.insert(index, entry);
        index
    }

    fn tool_call_start(&self, index: usize) -> Value {
        let mut call = self
            .tool_calls
            .get(&index)
            .cloned()
            .unwrap_or_else(|| serde_json::json!({ "index": index, "type": "function" }));
        call["function"]["arguments"] = Value::String(String::new());
        call
    }

    fn tool_index(&self, output_index: Option<i64>) -> Option<usize> {
        output_index
            .and_then(|output| self.tool_index_by_output.get(&output))
            .copied()
    }

    fn default_finish_reason(&self) -> FinishReason {
        if self.next_tool_index > 0 {
            FinishReason::ToolCalls
        } else {
            FinishReason::Stop
        }
    }

    fn chunk(&self, delta: Value) -> Vec<Value> {
        if !self.emit {
            return Vec::new();
        }
        vec![serde_json::json!({
            "id": self.id,
            "object": "chat.completion.chunk",
            "created": self.created,
            "model": self.model,
            "choices": [{
                "index": 0,
                "delta": delta,
                "finish_reason": Value::Null,
            }],
        })]
    }

    /// The closing frames of a streamed turn: one chunk carrying the finish
    /// reason and usage, then the `data: [DONE]` terminator.
    fn finish_stream(&mut self) -> Vec<Bytes> {
        let finish_reason = self
            .finish_reason
            .unwrap_or_else(|| self.default_finish_reason());
        let mut chunk = serde_json::json!({
            "id": self.id,
            "object": "chat.completion.chunk",
            "created": self.created,
            "model": self.model,
            "choices": [{
                "index": 0,
                "delta": {},
                "finish_reason": finish_reason.as_str(),
            }],
        });
        if let Some(usage) = &self.usage {
            chunk["usage"] = usage.clone();
        }
        vec![encode_chunk(chunk), Bytes::from_static(b"data: [DONE]\n\n")]
    }

    fn finish_buffered(mut self, request: &ChatCompletionRequest) -> Result<Value, APIError> {
        for (index, arguments) in std::mem::take(&mut self.arguments) {
            if let Some(call) = self.tool_calls.get_mut(&index) {
                call["function"]["arguments"] = Value::String(arguments);
            }
        }
        let tool_calls: Vec<Value> = self.tool_calls.into_values().collect();
        let has_tool_calls = !tool_calls.is_empty();
        let mut message = serde_json::json!({
            "role": "assistant",
            "content": self.content,
        });
        if !self.reasoning.is_empty() {
            message["reasoning"] = Value::String(self.reasoning);
        }
        if has_tool_calls {
            message["tool_calls"] = Value::Array(tool_calls);
        }

        let usage = self.usage.unwrap_or_else(|| {
            estimate_usage(&request.messages, &message["content"]).to_openai_json()
        });

        Ok(serde_json::json!({
            "id": self.id,
            "object": "chat.completion",
            "created": self.created,
            "model": self.model,
            "choices": [{
                "index": 0,
                "message": message,
                "finish_reason": self
                    .finish_reason
                    .unwrap_or(if has_tool_calls {
                        FinishReason::ToolCalls
                    } else {
                        FinishReason::Stop
                    })
                    .as_str(),
            }],
            "usage": usage,
        }))
    }
}

/// Translates the upstream Responses SSE into OpenAI chat chunks, keeping the
/// line buffer across network reads and ending the client stream the way the
/// Chat Completions protocol requires.
fn translate_stream<S>(upstream: S, model: &str) -> ProviderStream
where
    S: Stream<Item = Result<Bytes, reqwest::Error>> + Send + 'static,
{
    type State<S> = Option<(Pin<Box<S>>, EventDecoder, Translator, VecDeque<Bytes>, bool)>;

    let state: State<S> = Some((
        Box::pin(upstream),
        EventDecoder::default(),
        Translator::new(model),
        VecDeque::new(),
        false,
    ));
    let events = futures_util::stream::unfold(state, |state| async move {
        let (mut upstream, mut decoder, mut translator, mut pending, mut ended) = state?;

        loop {
            if let Some(frame) = pending.pop_front() {
                return Some((frame, Some((upstream, decoder, translator, pending, ended))));
            }
            if ended {
                return None;
            }

            match tokio::time::timeout(STREAM_IDLE_TIMEOUT, upstream.next()).await {
                Ok(Some(Ok(bytes))) => {
                    for frame in decoder.push(&bytes) {
                        match translator.accept(frame) {
                            Ok(chunks) => {
                                pending.extend(chunks.into_iter().map(encode_chunk));
                            }
                            Err(error) => {
                                pending.push_back(sse::error_event_bytes(&error));
                                ended = true;
                                break;
                            }
                        }
                    }
                }
                Ok(Some(Err(error))) => {
                    let failure =
                        APIError::new(500, constants::providers::upstream_stream_failed(&error));
                    pending.push_back(sse::error_event_bytes(&failure));
                    ended = true;
                }
                Ok(None) => {
                    let mut frames = Vec::new();
                    let mut failure = None;
                    for frame in decoder.finish() {
                        match translator.accept(frame) {
                            Ok(chunks) => frames.extend(chunks.into_iter().map(encode_chunk)),
                            Err(error) => {
                                failure = Some(error);
                                break;
                            }
                        }
                    }
                    match failure {
                        Some(error) => frames.push(sse::error_event_bytes(&error)),
                        None => frames.extend(translator.finish_stream()),
                    }
                    pending.extend(frames);
                    ended = true;
                }
                Err(_) => {
                    let failure = APIError::new(
                        500,
                        constants::providers::upstream_stalled(STREAM_IDLE_TIMEOUT.as_secs()),
                    );
                    pending.push_back(sse::error_event_bytes(&failure));
                    ended = true;
                }
            }
        }
    });

    Box::pin(events)
}

fn encode_chunk(chunk: Value) -> Bytes {
    Bytes::from(format!("data: {chunk}\n\n"))
}

/// Folds a Responses usage object (`input_tokens` / `output_tokens`, with the
/// `*_tokens_details` sub-objects) into the OpenAI chat usage shape the client
/// protocol expects.
fn normalize_usage(usage: &Value) -> Value {
    let mut source = usage.clone();
    if let Some(object) = source.as_object_mut() {
        if let Some(cached) = usage
            .get("input_tokens_details")
            .and_then(|details| details.get("cached_tokens"))
            && !object.contains_key("prompt_tokens_details")
        {
            object.insert(
                "prompt_tokens_details".to_owned(),
                serde_json::json!({ "cached_tokens": cached }),
            );
        }
        if let Some(reasoning) = usage
            .get("output_tokens_details")
            .and_then(|details| details.get("reasoning_tokens"))
            && !object.contains_key("completion_tokens_details")
        {
            object.insert(
                "completion_tokens_details".to_owned(),
                serde_json::json!({ "reasoning_tokens": reasoning }),
            );
        }
    }
    UsageBreakdown::from_value(&source).to_openai_json()
}

fn estimate_usage(messages: &[ChatMessage], completion: &Value) -> UsageBreakdown {
    let prompt_chars: usize = messages
        .iter()
        .map(|message| match &message.content {
            ChatContent::Text(text) => text.chars().count(),
            ChatContent::Parts(parts) => parts
                .iter()
                .filter_map(|part| part.text.as_ref())
                .map(|text| text.chars().count())
                .sum(),
            ChatContent::Null => 0,
        })
        .sum();
    let completion_chars = completion.as_str().map(str::chars).map(Iterator::count);
    let prompt_tokens = (prompt_chars / 4).max(1) as i64;
    let completion_tokens = completion_chars.map(|chars| (chars / 4).max(1) as i64);

    UsageBreakdown {
        prompt_tokens,
        completion_tokens: completion_tokens.unwrap_or(1),
        total_tokens: prompt_tokens + completion_tokens.unwrap_or(1),
        ..Default::default()
    }
}

fn random_hex(length: usize) -> String {
    let mut bytes = vec![0u8; length];
    let _ = getrandom::fill(&mut bytes);
    hex::encode(bytes)
}

impl ProviderExecutor for CodexExecutor {
    fn as_any(&self) -> &dyn std::any::Any {
        self
    }

    fn id(&self) -> &'static str {
        CodexExecutor::id(self)
    }

    fn keys(&self) -> &'static [&'static str] {
        CodexExecutor::keys(self)
    }

    fn alias(&self) -> &'static str {
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

#[cfg(test)]
mod tests {
    use futures_util::StreamExt;
    use serde_json::json;

    use super::*;

    fn parse(value: Value) -> ChatCompletionRequest {
        serde_json::from_value(value).expect("request parses")
    }

    fn simple_request() -> ChatCompletionRequest {
        parse(json!({
            "model": "openai_codex/gpt-6.1-sol",
            "messages": [
                {"role": "system", "content": "be terse"},
                {"role": "user", "content": "hello"}
            ]
        }))
    }

    fn sse(events: &[Value]) -> String {
        let mut body = String::new();
        for event in events {
            body.push_str("event: ");
            body.push_str(event["type"].as_str().unwrap_or("message"));
            body.push_str("\ndata: ");
            body.push_str(&event.to_string());
            body.push_str("\n\n");
        }
        body
    }

    fn text_events() -> Vec<Value> {
        vec![
            json!({"type": "response.created", "response": {"id": "resp_1"}}),
            json!({"type": "response.output_text.delta", "delta": "Hello"}),
            json!({"type": "response.output_text.delta", "delta": " world"}),
            json!({
                "type": "response.completed",
                "response": {
                    "usage": {
                        "input_tokens": 5,
                        "output_tokens": 7,
                        "input_tokens_details": {"cached_tokens": 2}
                    }
                }
            }),
        ]
    }

    async fn collect(stream: ProviderStream) -> String {
        let frames: Vec<Bytes> = stream.collect().await;
        frames
            .iter()
            .map(|frame| String::from_utf8_lossy(frame))
            .collect()
    }

    #[test]
    fn executor_contract_uses_live_catalog_and_needs_a_connection() {
        let executor = CodexExecutor::new(
            CodexEndpoints::default(),
            None,
            UpstreamClient::new().expect("client"),
        );

        assert_eq!(executor.id(), "openai_codex");
        assert_eq!(executor.keys(), &["openai_codex", "codex"]);
        assert_eq!(executor.alias(), "openai_codex");
        assert!(
            executor.models().is_empty(),
            "the catalog is empty until a live fetch confirms models"
        );
        assert_eq!(
            executor.model_id_variants("openai_codex/GPT-6-Luna"),
            vec!["gpt-6-luna", "gpt-6.luna"]
        );
    }

    #[test]
    fn upstream_body_carries_the_responses_shape() {
        let mut request = simple_request();
        request.max_tokens = Some(256);
        request.reasoning_effort = Some("high".to_owned());

        let body = upstream_body("gpt-6.1-sol", &request).expect("body");

        assert_eq!(body["model"], "gpt-6.1-sol");
        assert_eq!(body["stream"], true);
        assert_eq!(body["store"], false);
        assert_eq!(body["max_output_tokens"], 256);
        assert_eq!(body["reasoning"]["effort"], "high");
        assert!(body.get("tools").is_none());
        assert!(body.get("text").is_none());

        let input = body["input"].as_array().expect("input array");
        assert_eq!(input.len(), 2);
        assert_eq!(input[0]["type"], "message");
        assert_eq!(input[0]["role"], "developer");
        assert_eq!(input[0]["content"][0]["type"], "input_text");
        assert_eq!(input[0]["content"][0]["text"], "be terse");
        assert_eq!(input[1]["role"], "user");
    }

    #[test]
    fn tools_and_tool_results_use_the_responses_item_shapes() {
        let request = parse(json!({
            "model": "openai_codex/gpt-6.1-sol",
            "messages": [
                {"role": "user", "content": "weather?"},
                {"role": "assistant", "content": null, "tool_calls": [
                    {"id": "call_1", "type": "function",
                     "function": {"name": "lookup", "arguments": "{\"q\":\"bmw\"}"}}
                ]},
                {"role": "tool", "tool_call_id": "call_1", "content": "sunny"}
            ],
            "tools": [
                {"type": "function", "function": {"name": "lookup",
                 "parameters": {"type": "object"}}}
            ],
            "tool_choice": "auto"
        }));

        let body = upstream_body("gpt-6.1-sol", &request).expect("body");

        assert_eq!(body["tool_choice"], "auto");
        assert_eq!(body["tools"][0]["type"], "function");
        assert_eq!(body["tools"][0]["name"], "lookup");
        assert_eq!(body["tools"][0]["parameters"]["type"], "object");
        assert!(
            body["tools"][0].get("function").is_none(),
            "Responses tools are flat, not nested under `function`"
        );

        let input = body["input"].as_array().expect("input array");
        assert_eq!(input[1]["type"], "function_call");
        assert_eq!(input[1]["call_id"], "call_1");
        assert_eq!(input[1]["name"], "lookup");
        assert_eq!(input[2]["type"], "function_call_output");
        assert_eq!(input[2]["call_id"], "call_1");
        assert_eq!(input[2]["output"], "sunny");
    }

    #[test]
    fn assistant_history_is_output_text_and_images_become_input_images() {
        let request = parse(json!({
            "model": "openai_codex/gpt-6.1-sol",
            "messages": [
                {"role": "user", "content": [
                    {"type": "text", "text": "what is this"},
                    {"type": "image_url", "image_url": {"url": "data:image/png;base64,AAA"}}
                ]},
                {"role": "assistant", "content": "it is a cat"}
            ]
        }));

        let body = upstream_body("gpt-6.1-sol", &request).expect("body");
        let input = body["input"].as_array().expect("input array");

        assert_eq!(input[0]["content"][0]["type"], "input_text");
        assert_eq!(input[0]["content"][1]["type"], "input_image");
        assert_eq!(
            input[0]["content"][1]["image_url"],
            "data:image/png;base64,AAA"
        );
        assert_eq!(input[1]["role"], "assistant");
        assert_eq!(input[1]["content"][0]["type"], "output_text");
    }

    #[test]
    fn reasoning_none_and_unknown_response_formats_are_dropped() {
        let request = parse(json!({
            "model": "openai_codex/gpt-6.1-sol",
            "messages": [{"role": "user", "content": "hi"}],
            "reasoning": {"effort": "none"},
            "response_format": {"type": "text"}
        }));

        let body = upstream_body("gpt-6.1-sol", &request).expect("body");

        assert!(body.get("reasoning").is_none());
        assert!(body.get("text").is_none());
    }

    #[test]
    fn json_schema_response_format_is_flattened_into_text_format() {
        let request = parse(json!({
            "model": "openai_codex/gpt-6.1-sol",
            "messages": [{"role": "user", "content": "hi"}],
            "response_format": {
                "type": "json_schema",
                "json_schema": {"name": "person", "schema": {"type": "object"}, "strict": true}
            }
        }));

        let body = upstream_body("gpt-6.1-sol", &request).expect("body");

        assert_eq!(body["text"]["format"]["type"], "json_schema");
        assert_eq!(body["text"]["format"]["name"], "person");
        assert_eq!(body["text"]["format"]["schema"]["type"], "object");
        assert_eq!(body["text"]["format"]["strict"], true);
    }

    #[test]
    fn decoder_reassembles_events_split_across_reads() {
        let payload = sse(&text_events());
        let mut decoder = EventDecoder::default();
        let mut frames = Vec::new();
        for chunk in payload.as_bytes().chunks(7) {
            frames.extend(decoder.push(chunk));
        }
        frames.extend(decoder.finish());

        assert_eq!(frames.len(), text_events().len());
        match &frames[1] {
            DecodedFrame::Event(ResponsesEvent::OutputTextDelta { delta }) => {
                assert_eq!(delta, "Hello")
            }
            other => panic!("expected data frame, got {other:?}"),
        }
    }

    #[test]
    fn failed_responses_and_error_events_become_stream_errors() {
        let failed = sse(&[json!({
            "type": "response.failed",
            "response": {"error": {"message": "quota blown"}}
        })]);
        let mut decoder = EventDecoder::default();
        let frames = decoder.push(failed.as_bytes());
        match &frames[0] {
            DecodedFrame::Error(error) => assert_eq!(error.message(), "quota blown"),
            other => panic!("expected error frame, got {other:?}"),
        }

        let errored = sse(&[json!({"type": "error", "message": "bad request"})]);
        let mut decoder = EventDecoder::default();
        let frames = decoder.push(errored.as_bytes());
        match &frames[0] {
            DecodedFrame::Error(error) => assert_eq!(error.message(), "bad request"),
            other => panic!("expected error frame, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn streaming_path_emits_chat_chunks_and_one_terminator() {
        let stream = futures_util::stream::iter([Ok::<Bytes, reqwest::Error>(Bytes::from(sse(
            &text_events(),
        )))]);
        let body = collect(translate_stream(stream, "gpt-6.1-sol")).await;

        assert!(body.contains("\"content\":\"Hello\""), "{body}");
        assert!(body.contains("\"content\":\" world\""), "{body}");
        assert!(body.contains("\"finish_reason\":\"stop\""), "{body}");
        assert!(body.contains("\"prompt_tokens\":5"), "{body}");
        assert!(body.contains("\"completion_tokens\":7"), "{body}");
        assert!(body.contains("\"cached_tokens\":2"), "{body}");
        assert!(body.contains("\"model\":\"gpt-6.1-sol\""), "{body}");
        assert_eq!(body.matches("data: [DONE]").count(), 1, "{body}");
    }

    #[tokio::test]
    async fn streaming_path_translates_function_calls_into_tool_call_deltas() {
        let events = vec![
            json!({"type": "response.output_item.added", "output_index": 1,
                   "item": {"type": "function_call", "call_id": "call_9",
                            "id": "fc_1", "name": "lookup", "arguments": ""}}),
            json!({"type": "response.function_call_arguments.delta", "output_index": 1,
                   "delta": "{\"q\":"}),
            json!({"type": "response.function_call_arguments.delta", "output_index": 1,
                   "delta": "\"bmw\"}"}),
            json!({"type": "response.completed", "response": {}}),
        ];
        let stream =
            futures_util::stream::iter([Ok::<Bytes, reqwest::Error>(Bytes::from(sse(&events)))]);
        let body = collect(translate_stream(stream, "gpt-6.1-sol")).await;

        assert!(body.contains("\"name\":\"lookup\""), "{body}");
        assert!(body.contains("\"arguments\":\"{\\\"q\\\":\""), "{body}");
        assert!(body.contains("\"finish_reason\":\"tool_calls\""), "{body}");
        assert_eq!(body.matches("data: [DONE]").count(), 1, "{body}");
    }

    #[tokio::test]
    async fn a_failed_response_ends_the_stream_with_an_error_event() {
        let stream =
            futures_util::stream::iter([Ok::<Bytes, reqwest::Error>(Bytes::from(sse(&[json!({
                "type": "response.failed",
                "response": {"error": {"message": "quota blown"}}
            })])))]);
        let body = collect(translate_stream(stream, "gpt-6.1-sol")).await;

        assert!(body.contains("quota blown"), "{body}");
        assert!(!body.contains("[DONE]"), "{body}");
    }

    #[test]
    fn buffered_translator_folds_text_tools_and_usage() {
        let mut translator = Translator::new("gpt-6.1-sol");
        translator.emit = false;
        let request = simple_request();

        let events = vec![
            json!({"type": "response.output_item.added", "output_index": 2,
                   "item": {"type": "function_call", "call_id": "call_1",
                            "id": "fc_1", "name": "lookup", "arguments": ""}}),
            json!({"type": "response.function_call_arguments.delta", "output_index": 2,
                   "delta": "{\"q\":\"bmw\"}"}),
            json!({"type": "response.output_text.delta", "delta": "checking"}),
            json!({
                "type": "response.completed",
                "response": {"usage": {"input_tokens": 5, "output_tokens": 7}}
            }),
        ];
        for event in events {
            translator
                .accept(DecodedFrame::Event(
                    serde_json::from_value(event).expect("event parses"),
                ))
                .expect("event accepted");
        }

        let completion = translator.finish_buffered(&request).expect("completion");
        assert_eq!(completion["object"], "chat.completion");
        assert_eq!(completion["model"], "gpt-6.1-sol");
        assert_eq!(completion["choices"][0]["message"]["content"], "checking");
        assert_eq!(completion["choices"][0]["finish_reason"], "tool_calls");
        assert_eq!(
            completion["choices"][0]["message"]["tool_calls"][0]["id"],
            "call_1"
        );
        assert_eq!(
            completion["choices"][0]["message"]["tool_calls"][0]["function"]["arguments"],
            "{\"q\":\"bmw\"}"
        );
        assert_eq!(completion["usage"]["prompt_tokens"], 5);
        assert_eq!(completion["usage"]["completion_tokens"], 7);
        assert_eq!(completion["usage"]["total_tokens"], 12);
    }

    #[test]
    fn an_incomplete_response_cut_by_the_token_budget_reports_length() {
        let mut translator = Translator::new("gpt-6.1-sol");
        translator.emit = false;
        translator
            .accept(DecodedFrame::Event(
                serde_json::from_value(json!({
                    "type": "response.incomplete",
                    "response": {
                        "incomplete_details": {"reason": "max_output_tokens"},
                        "usage": {"input_tokens": 3, "output_tokens": 4}
                    }
                }))
                .expect("event parses"),
            ))
            .expect("event accepted");

        let completion = translator
            .finish_buffered(&simple_request())
            .expect("completion");
        assert_eq!(completion["choices"][0]["finish_reason"], "length");
    }

    #[test]
    fn token_refresh_window_follows_the_node_lead_time() {
        let credentials = CodexCredentials {
            id: "codex-account".to_owned(),
            access_token: "access".to_owned(),
            refresh_token: Some("refresh".to_owned()),
            account_id: Some("acct".to_owned()),
            token_expires_at: Some(1_000_000),
            last_refreshed_at: None,
        };

        assert!(!token_refresh_is_due(
            &credentials,
            1_000_000 - 6 * 60 * 1000
        ));
        assert!(token_refresh_is_due(
            &credentials,
            1_000_000 - 4 * 60 * 1000
        ));

        let unknown = CodexCredentials {
            token_expires_at: None,
            ..credentials.clone()
        };
        let never_refreshed = CodexCredentials {
            last_refreshed_at: None,
            ..unknown.clone()
        };
        // No expiry and no refresh yet: refresh at once (the Node rule).
        assert!(token_refresh_is_due(&never_refreshed, 60 * 60 * 1000));
        // No expiry but refreshed an hour ago: only stale tokens are refreshed.
        let refreshed_now = CodexCredentials {
            last_refreshed_at: Some(60 * 60 * 1000),
            ..unknown.clone()
        };
        assert!(!token_refresh_is_due(&refreshed_now, 60 * 60 * 1000));
        let refreshed_long_ago = CodexCredentials {
            last_refreshed_at: Some(0),
            ..unknown.clone()
        };
        assert!(token_refresh_is_due(
            &refreshed_long_ago,
            13 * 60 * 60 * 1000
        ));
    }
}
