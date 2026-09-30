//! Qoder executor: builds the COSY-signed upstream request and translates the
//! gateway's wrapped SSE envelope back into OpenAI frames.
//!
//! The upstream never speaks OpenAI on the wire: every frame is an envelope
//! holding a stringified OpenAI chunk, there is no `data: [DONE]`, and the
//! frames arrive fragmented across TCP reads. Both directions of that translation
//! live here so the gateway handlers only ever see OpenAI.

use std::collections::{BTreeMap, VecDeque};
use std::pin::Pin;
use std::sync::{Arc, RwLock, RwLockReadGuard, RwLockWriteGuard};

use axum::body::Bytes;
use futures_util::{Stream, StreamExt};
use reqwest::header::HeaderValue;
use serde_json::Value;

use crate::clock::now_ms;
use crate::constants;
use crate::error::APIError;
use crate::features::gateway::model::{
    ChatCompletionRequest, ChatContent, ChatMessage, ChatRole, ToolCall,
};
use crate::features::gateway::sse;
use crate::features::gateway::usage::UsageBreakdown;
use crate::features::providers::adapter::{
    ProviderAdapter, ProviderStream, upstream_error, upstream_status_error,
};
use crate::features::providers::qoder::catalog::{ModelConfig, QoderCatalog, SharedCatalog};
use crate::features::providers::qoder::cosy::{CosyIdentity, encode_body, sign};
use crate::features::providers::qoder::types::{
    QODER_DEFAULT_MAX_OUTPUT, QODER_KEYS, QODER_PROVIDER, QODER_USER_AGENT, QoderEndpoints,
    resolve_model_key,
};
use crate::infrastructure::database::AppDatabase;
use crate::infrastructure::database::providers::{QoderCredentials, load_qoder_credentials};
use crate::infrastructure::database::settings::{get_setting, set_setting};
use crate::infrastructure::upstream::{STREAM_IDLE_TIMEOUT, UpstreamClient};

/// The executor for Qoder models. It owns the endpoints, the live model
/// catalog, and the database handle its credentials are read from, because the
/// registry is built before `AppState` exists and cannot inject them later.
#[derive(Clone)]
pub struct QoderExecutor {
    id: &'static str,
    keys: &'static [&'static str],
    endpoints: QoderEndpoints,
    database: Option<AppDatabase>,
    client: UpstreamClient,
    catalog: SharedCatalog,
    machine_id: Arc<RwLock<Option<String>>>,
}

/// One request, ready to be sent: signed headers plus the encoded body.
struct PreparedRequest {
    url: String,
    model_key: String,
    source: String,
    encoded_body: String,
    headers: BTreeMap<&'static str, String>,
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
            catalog: QoderCatalog::shared_seed(),
            machine_id: Arc::new(RwLock::new(None)),
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

    /// Advertised model ids: the live snapshot, or the seed before the first
    /// successful fetch.
    pub fn models(&self) -> Vec<String> {
        read_catalog(&self.catalog).models.clone()
    }

    pub fn endpoints(&self) -> &QoderEndpoints {
        &self.endpoints
    }

    /// Spawns a catalog refresh when the snapshot is stale, or right away when
    /// `force` is set. Nothing awaits it, so no request ever waits on the list.
    pub fn maybe_refresh(&self, force: bool) {
        if self.database.is_none() || !(force || read_catalog(&self.catalog).is_stale()) {
            return;
        }

        let executor = self.clone();
        tokio::spawn(async move {
            let _ = executor.refresh_catalog().await;
        });
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
            .timeout(self.client.request_timeout())
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

    pub async fn chat_completion(
        &self,
        model: &str,
        request: &ChatCompletionRequest,
    ) -> Result<Value, APIError> {
        self.maybe_refresh(false);
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
        self.maybe_refresh(false);
        let prepared = self.prepare(model, request).await?;
        let response = self.send_chat(&prepared, false).await?;

        Ok(translate_stream(
            response.bytes_stream(),
            prepared.model_key,
        ))
    }

    /// Signs and sends one chat request. The body always asks for a stream: the
    /// upstream has no buffered chat endpoint.
    async fn send_chat(
        &self,
        prepared: &PreparedRequest,
        buffered: bool,
    ) -> Result<reqwest::Response, APIError> {
        let mut request = self
            .client
            .raw()
            .post(&prepared.url)
            .header("Content-Type", "application/json")
            .header("Accept", "text/event-stream")
            .header("Cache-Control", "no-cache")
            .header("Accept-Encoding", "identity")
            .header("User-Agent", QODER_USER_AGENT)
            .body(prepared.encoded_body.clone());
        if buffered {
            request = request.timeout(self.client.request_timeout());
        }
        if let Ok(model_key) = HeaderValue::from_str(&prepared.model_key) {
            request = request.header("X-Model-Key", model_key);
        }
        if let Ok(source) = HeaderValue::from_str(&prepared.source) {
            request = request.header("X-Model-Source", source);
        }
        let request = apply_headers(request, &prepared.headers);

        let response = request.send().await.map_err(upstream_error)?;
        let status = response.status();
        if !status.is_success() {
            let detail = response.text().await.unwrap_or_default();
            return Err(upstream_status_error(status, &detail));
        }

        Ok(response)
    }

    async fn prepare(
        &self,
        model: &str,
        request: &ChatCompletionRequest,
    ) -> Result<PreparedRequest, APIError> {
        let model_key = resolve_model_key(model);
        let config = {
            let catalog = read_catalog(&self.catalog);
            catalog
                .config_for(&model_key)
                .cloned()
                .unwrap_or_else(|| default_config(&model_key))
        };
        let credentials = self.credentials().await?;
        let machine_id = self.machine_id().await?;
        let body = build_body(&model_key, &config, &credentials, request);
        let encoded_body = encode_body(body.to_string().as_bytes());
        let url = self.endpoints.chat_url();
        let request_id = uuid::Uuid::new_v4().to_string();

        let headers = sign(
            &encoded_body,
            &url,
            &identity(&credentials, &machine_id),
            (now_ms() / 1000) as u64,
            &request_id,
        )?;

        Ok(PreparedRequest {
            url,
            model_key,
            source: config.source,
            encoded_body,
            headers,
        })
    }

    /// The stored Qoder credentials, refused when the token has lapsed.
    async fn credentials(&self) -> Result<QoderCredentials, APIError> {
        let database = self
            .database
            .as_ref()
            .ok_or_else(|| APIError::new(500, constants::providers::DATABASE_REQUIRED))?;
        let credentials = load_qoder_credentials(database)
            .await?
            .ok_or_else(|| APIError::new(401, constants::providers::qoder::NOT_CONNECTED))?;

        if credentials.is_expired(now_ms()) {
            return Err(APIError::new(
                401,
                constants::providers::qoder::TOKEN_EXPIRED,
            ));
        }

        Ok(credentials)
    }

    /// The machine id the COSY headers carry, cached for the life of the
    /// adapter so one request does not re-read it.
    async fn machine_id(&self) -> Result<String, APIError> {
        if let Some(cached) = read_opt(&self.machine_id) {
            return Ok(cached);
        }

        let database = self
            .database
            .as_ref()
            .ok_or_else(|| APIError::new(500, constants::providers::DATABASE_REQUIRED))?;
        let machine_id = machine_id_for(database).await?;

        *write_opt(&self.machine_id) = Some(machine_id.clone());

        Ok(machine_id)
    }
}

/// The machine id stored for this install, generated on first use. Both the
/// executor and the device-flow login read it, so the browser and the signed
/// requests present the same machine.
pub async fn machine_id_for(database: &AppDatabase) -> Result<String, APIError> {
    let setting = crate::features::providers::qoder::types::QODER_MACHINE_ID_SETTING;
    if let Some(stored) = get_setting(database, setting).await?
        && !stored.trim().is_empty()
    {
        return Ok(stored);
    }

    let generated = uuid::Uuid::new_v4().simple().to_string();
    set_setting(database, setting, &generated).await?;

    Ok(generated)
}

fn identity<'a>(credentials: &'a QoderCredentials, machine_id: &'a str) -> CosyIdentity<'a> {
    CosyIdentity {
        uid: &credentials.user_id,
        auth_token: &credentials.access_token,
        name: &credentials.name,
        email: &credentials.email,
        machine_id,
    }
}

fn default_config(key: &str) -> ModelConfig {
    ModelConfig {
        key: key.to_owned(),
        is_reasoning: false,
        max_output_tokens: QODER_DEFAULT_MAX_OUTPUT,
        source: "system".to_owned(),
    }
}

fn apply_headers(
    request: reqwest::RequestBuilder,
    headers: &BTreeMap<&'static str, String>,
) -> reqwest::RequestBuilder {
    let mut request = request;

    for (name, value) in headers {
        if let Ok(value) = HeaderValue::from_str(value) {
            request = request.header(*name, value);
        }
    }

    request
}

fn read_catalog(catalog: &SharedCatalog) -> RwLockReadGuard<'_, QoderCatalog> {
    catalog
        .read()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn write_catalog(catalog: &SharedCatalog) -> RwLockWriteGuard<'_, QoderCatalog> {
    catalog
        .write()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn read_opt(handle: &RwLock<Option<String>>) -> Option<String> {
    handle
        .read()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .clone()
}

fn write_opt(handle: &RwLock<Option<String>>) -> RwLockWriteGuard<'_, Option<String>> {
    handle
        .write()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Builds the upstream request body. The system prompt is lifted out of the
/// message list, and the ids the upstream groups a conversation by are derived
/// from the conversation itself so a retry keeps its session.
fn build_body(
    model_key: &str,
    config: &ModelConfig,
    credentials: &QoderCredentials,
    request: &ChatCompletionRequest,
) -> Value {
    let mut system = Vec::new();
    let mut messages = Vec::new();
    let mut last_user_text = String::new();

    for message in &request.messages {
        match message.role {
            ChatRole::System | ChatRole::Developer => {
                if let Some(text) = text_of(&message.content) {
                    system.push(text);
                }
            }
            ChatRole::User => {
                last_user_text = text_of(&message.content).unwrap_or_default();
                messages.push(user_message(message));
            }
            ChatRole::Assistant => messages.push(assistant_message(message)),
            ChatRole::Tool | ChatRole::Function => messages.push(tool_message(message)),
        }
    }

    let max_tokens = request
        .max_tokens
        .map(|value| i64::from(value).min(config.max_output_tokens))
        .unwrap_or(config.max_output_tokens)
        .max(1);
    let session_id = stable_hash(&["qoder-session", &credentials.user_id, model_key]);
    let record_id = stable_hash(&[
        "qoder-record",
        model_key,
        &serde_json::to_string(&messages).unwrap_or_default(),
        &serde_json::to_string(&request.tools).unwrap_or_default(),
        &format!("mt={max_tokens}"),
    ]);

    let tools = match &request.tools {
        Some(tools) => serde_json::to_value(tools).unwrap_or(Value::Null),
        None => Value::Array(Vec::new()),
    };

    serde_json::json!({
        "request_id": uuid::Uuid::new_v4(),
        "request_set_id": record_id,
        "chat_record_id": record_id,
        "session_id": session_id,
        "stream": true,
        "chat_task": "FREE_INPUT",
        "is_reply": true,
        "is_retry": false,
        "source": 1,
        "version": "3",
        "session_type": "qodercli",
        "agent_id": "agent_common",
        "task_id": "common",
        "code_language": "",
        "chat_prompt": "",
        "image_urls": null,
        "aliyun_user_type": "",
        "system": system.join("\n\n"),
        "messages": messages,
        "tools": tools,
        "parameters": { "max_tokens": max_tokens },
        "chat_context": {
            "chatPrompt": "",
            "imageUrls": null,
            "extra": {
                "context": [],
                "modelConfig": { "key": config.key, "is_reasoning": config.is_reasoning },
                "originalContent": last_user_text,
            },
            "features": [],
            "text": last_user_text,
        },
        "model_config": {
            "key": config.key,
            "is_reasoning": config.is_reasoning,
            "max_output_tokens": config.max_output_tokens,
            "source": config.source,
        },
        "business": {
            "product": "cli",
            "version": "1.0.0",
            "type": "agent",
            "stage": "start",
            "id": uuid::Uuid::new_v4(),
            "name": truncate(&last_user_text, 30),
            "begin_at": now_ms(),
        },
    })
}

fn user_message(message: &ChatMessage) -> Value {
    match &message.content {
        ChatContent::Text(text) => serde_json::json!({ "role": "user", "content": text }),
        ChatContent::Parts(_) => serde_json::json!({
            "role": "user",
            "content": message.content.clone(),
        }),
        ChatContent::Null => serde_json::json!({ "role": "user", "content": "" }),
    }
}

fn assistant_message(message: &ChatMessage) -> Value {
    let mut mapped = serde_json::json!({
        "role": "assistant",
        "content": match &message.content {
            ChatContent::Text(text) => Value::String(text.clone()),
            ChatContent::Null => Value::Null,
            ChatContent::Parts(_) => Value::String(text_of(&message.content).unwrap_or_default()),
        },
    });

    if let Some(tool_calls) = &message.tool_calls {
        mapped["tool_calls"] = Value::Array(tool_calls.iter().map(tool_call_json).collect());
    }

    mapped
}

fn tool_message(message: &ChatMessage) -> Value {
    let tool_call_id = message
        .tool_call_id
        .clone()
        .or_else(|| message.name.clone())
        .unwrap_or_default();

    serde_json::json!({
        "role": "tool",
        "tool_call_id": tool_call_id,
        "content": text_of(&message.content).unwrap_or_default(),
    })
}

fn tool_call_json(call: &ToolCall) -> Value {
    serde_json::json!({
        "id": call.id,
        "type": "function",
        "function": { "name": call.function.name, "arguments": call.function.arguments },
    })
}

fn text_of(content: &ChatContent) -> Option<String> {
    match content {
        ChatContent::Text(text) => Some(text.clone()),
        ChatContent::Null => None,
        ChatContent::Parts(parts) => {
            let text = parts
                .iter()
                .filter_map(|part| part.text.clone())
                .collect::<Vec<_>>()
                .join("");

            if text.is_empty() { None } else { Some(text) }
        }
    }
}

fn truncate(value: &str, limit: usize) -> String {
    value.chars().take(limit).collect()
}

/// Sixteen hex characters of a SHA-256 over the labelled inputs, which is what
/// the upstream uses to key a session or a record.
fn stable_hash(inputs: &[&str]) -> String {
    use sha2::{Digest, Sha256};

    let mut hasher = Sha256::new();
    for input in inputs {
        hasher.update(b"\0");
        hasher.update(input.as_bytes());
    }

    hex::encode(hasher.finalize())[..16].to_owned()
}

/// Extracts the payload of a `data:` line, or `None` for any other line.
fn data_payload(line: &str) -> Option<&str> {
    let trimmed = line.trim();
    let payload = trimmed.strip_prefix("data:")?.trim();

    if payload.is_empty() || payload == "[DONE]" {
        return None;
    }

    Some(payload)
}

/// Turns one upstream envelope into an OpenAI frame. An envelope reporting a
/// failed status becomes an in-stream error event instead of a chunk.
fn translate_envelope(
    payload: &str,
    translator: &EnvelopeTranslator,
) -> Option<Result<Bytes, APIError>> {
    let envelope: Value = serde_json::from_str(payload).ok()?;
    let status = envelope
        .get("statusCodeValue")
        .and_then(Value::as_i64)
        .unwrap_or(200);
    let body = envelope.get("body").and_then(Value::as_str).unwrap_or("");

    if status != 200 {
        return Some(Err(APIError::new(
            500,
            constants::providers::upstream_stream_error(status as u16, body),
        )));
    }

    if body.is_empty() || body == "[DONE]" {
        return None;
    }

    let inner: Value = serde_json::from_str(body).ok()?;
    let chunk = translator.normalize(inner);

    Some(Ok(Bytes::from(format!("data: {chunk}\n\n"))))
}

/// Accumulates the upstream stream and emits OpenAI frames. The buffer spans
/// network reads, because the upstream splits a `data:` line across chunks.
struct EnvelopeTranslator {
    buffer: String,
    model: String,
    chunk_id: String,
    created: i64,
    finished: bool,
}

impl EnvelopeTranslator {
    fn new(model: &str) -> Self {
        Self {
            buffer: String::new(),
            model: model.to_owned(),
            chunk_id: format!("chatcmpl-{}", random_hex(16)),
            created: now_ms() / 1000,
            finished: false,
        }
    }

    fn push(&mut self, bytes: &[u8]) -> Vec<Result<Bytes, APIError>> {
        if self.finished {
            return Vec::new();
        }

        self.buffer.push_str(&String::from_utf8_lossy(bytes));
        let mut output = Vec::new();

        while let Some(position) = self.buffer.find('\n') {
            let line = self.buffer[..position].trim_end_matches('\r').to_owned();
            self.buffer.drain(..=position);

            if let Some(payload) = data_payload(&line)
                && let Some(frame) = translate_envelope(payload, self)
            {
                output.push(frame);
            }
        }

        output
    }

    fn finish(&mut self) -> Vec<Result<Bytes, APIError>> {
        if self.finished {
            return Vec::new();
        }
        self.finished = true;

        let mut output = Vec::new();
        let rest = std::mem::take(&mut self.buffer);
        if let Some(payload) = data_payload(&rest)
            && let Some(frame) = translate_envelope(payload, self)
        {
            output.push(frame);
        }

        // The upstream never terminates the stream itself, and the gateway
        // forwards provider bytes verbatim, so the terminator is added here.
        output.push(Ok(Bytes::from("data: [DONE]\n\n")));

        output
    }

    /// Fills in the fields a client expects on every chunk. The upstream omits
    /// them because its own consumers read only the delta.
    fn normalize(&self, mut chunk: Value) -> Value {
        if !chunk.is_object() {
            chunk = serde_json::json!({ "choices": [] });
        }

        let object = chunk.as_object_mut().expect("chunk is an object");
        object
            .entry("id")
            .or_insert_with(|| Value::String(self.chunk_id.clone()));
        object
            .entry("object")
            .or_insert_with(|| Value::String("chat.completion.chunk".to_owned()));
        object
            .entry("created")
            .or_insert_with(|| Value::Number(self.created.into()));
        object
            .entry("model")
            .or_insert_with(|| Value::String(self.model.clone()));

        if let Some(choices) = object.get_mut("choices").and_then(Value::as_array_mut) {
            for (index, choice) in choices.iter_mut().enumerate() {
                if let Some(choice) = choice.as_object_mut() {
                    choice.entry("index").or_insert_with(|| index.into());
                }
            }
        }

        Value::Object(std::mem::take(object))
    }
}

/// The unfold state: the upstream, the translator, frames waiting to be
/// emitted, and whether the stream is finished.
type TranslateState<S> = Option<(
    Pin<Box<S>>,
    EnvelopeTranslator,
    VecDeque<Result<Bytes, APIError>>,
    bool,
)>;

/// Wraps the upstream byte stream in the envelope translation, keeping the
/// stall and transport guarantees the other providers have.
fn translate_stream<S>(upstream: S, model: String) -> ProviderStream
where
    S: Stream<Item = Result<Bytes, reqwest::Error>> + Send + 'static,
{
    let upstream: Pin<Box<S>> = Box::pin(upstream);
    let state: TranslateState<S> = Some((
        upstream,
        EnvelopeTranslator::new(&model),
        VecDeque::new(),
        false,
    ));

    let events = futures_util::stream::unfold(state, |state| async move {
        let (mut upstream, mut translator, mut pending, mut stalled) = state?;

        loop {
            if let Some(frame) = pending.pop_front() {
                let bytes = match frame {
                    Ok(bytes) => bytes,
                    Err(error) => sse::error_event_bytes(&error),
                };
                return Some((bytes, Some((upstream, translator, pending, stalled))));
            }

            if stalled {
                return None;
            }

            match tokio::time::timeout(STREAM_IDLE_TIMEOUT, upstream.next()).await {
                Ok(Some(Ok(bytes))) => {
                    pending.extend(translator.push(&bytes));
                }
                Ok(Some(Err(error))) => {
                    let failure =
                        APIError::new(500, constants::providers::upstream_stream_failed(&error));
                    pending.push_back(Err(failure));
                    stalled = true;
                }
                Ok(None) => {
                    pending.extend(translator.finish());
                    stalled = true;
                }
                Err(_) => {
                    let failure = APIError::new(
                        500,
                        constants::providers::upstream_stalled(STREAM_IDLE_TIMEOUT.as_secs()),
                    );
                    pending.push_back(Err(failure));
                    stalled = true;
                }
            }
        }
    });

    Box::pin(events)
}

/// Aggregates the upstream stream into one buffered `chat.completion`.
struct Aggregator {
    model: String,
    id: String,
    created: i64,
    content: String,
    reasoning: String,
    finish_reason: Option<String>,
    usage: Option<Value>,
    tool_calls: BTreeMap<usize, Value>,
    arguments: BTreeMap<usize, String>,
    failed: Option<APIError>,
}

impl Aggregator {
    fn new(model: &str) -> Self {
        Self {
            model: model.to_owned(),
            id: format!("chatcmpl-{}", random_hex(16)),
            created: now_ms() / 1000,
            content: String::new(),
            reasoning: String::new(),
            finish_reason: None,
            usage: None,
            tool_calls: BTreeMap::new(),
            arguments: BTreeMap::new(),
            failed: None,
        }
    }

    /// Accepts one upstream envelope payload. An error envelope stops the
    /// aggregation and is returned to the caller.
    fn accept(&mut self, payload: &str) -> Result<(), APIError> {
        if let Some(failure) = &self.failed {
            return Err(APIError::new(500, failure.message()));
        }

        let envelope: Value = serde_json::from_str(payload).unwrap_or(Value::Null);
        let status = envelope
            .get("statusCodeValue")
            .and_then(Value::as_i64)
            .unwrap_or(200);
        let body = envelope.get("body").and_then(Value::as_str).unwrap_or("");

        if status != 200 {
            let failure = APIError::new(
                500,
                constants::providers::upstream_stream_error(status as u16, body),
            );
            self.failed = Some(failure.clone());
            return Err(failure);
        }

        if body.is_empty() || body == "[DONE]" {
            return Ok(());
        }

        let Ok(chunk) = serde_json::from_str::<Value>(body) else {
            return Ok(());
        };

        if let Some(usage) = chunk.get("usage").filter(|value| !value.is_null()) {
            self.usage = Some(usage.clone());
        }

        let Some(choice) = chunk
            .get("choices")
            .and_then(Value::as_array)
            .and_then(|c| c.first())
        else {
            return Ok(());
        };

        if let Some(reason) = choice.get("finish_reason").and_then(Value::as_str) {
            self.finish_reason = Some(reason.to_owned());
        }

        let Some(delta) = choice.get("delta") else {
            return Ok(());
        };

        if let Some(content) = delta.get("content").and_then(Value::as_str) {
            self.content.push_str(content);
        }
        if let Some(reasoning) = delta
            .get("reasoning_content")
            .or_else(|| delta.get("reasoning"))
            .and_then(Value::as_str)
        {
            self.reasoning.push_str(reasoning);
        }

        for item in delta
            .get("tool_calls")
            .and_then(Value::as_array)
            .map(Vec::as_slice)
            .unwrap_or_default()
        {
            let index = item.get("index").and_then(Value::as_u64).unwrap_or(0) as usize;
            let entry = self.tool_calls.entry(index).or_insert_with(|| {
                serde_json::json!({
                    "index": index,
                    "type": "function",
                    "function": { "name": "", "arguments": "" }
                })
            });

            if let Some(id) = item.get("id").and_then(Value::as_str) {
                entry["id"] = Value::String(id.to_owned());
            }
            if let Some(name) = item
                .get("function")
                .and_then(|f| f.get("name"))
                .and_then(Value::as_str)
            {
                entry["function"]["name"] = Value::String(name.to_owned());
            }
            if let Some(arguments) = item
                .get("function")
                .and_then(|f| f.get("arguments"))
                .and_then(Value::as_str)
            {
                self.arguments.entry(index).or_default().push_str(arguments);
            }
        }

        Ok(())
    }

    fn finish(mut self, request: &ChatCompletionRequest) -> Result<Value, APIError> {
        if let Some(failure) = self.failed.take() {
            return Err(failure);
        }

        for (index, arguments) in self.arguments {
            if let Some(entry) = self.tool_calls.get_mut(&index) {
                entry["function"]["arguments"] = Value::String(arguments);
            }
        }

        let tool_calls: Vec<Value> = self.tool_calls.into_values().collect();
        let has_tool_calls = !tool_calls.is_empty();
        let mut message = serde_json::json!({ "role": "assistant", "content": self.content });

        if !self.reasoning.is_empty() {
            message["reasoning_content"] = Value::String(self.reasoning);
        }
        if has_tool_calls {
            message["tool_calls"] = Value::Array(tool_calls);
        }

        let usage = match self.usage {
            Some(upstream) => UsageBreakdown::from_value(&upstream).to_openai_json(),
            None => estimate_usage(&request.messages, &self.content).to_openai_json(),
        };

        Ok(serde_json::json!({
            "id": self.id,
            "object": "chat.completion",
            "created": self.created,
            "model": self.model,
            "choices": [{
                "index": 0,
                "message": message,
                "finish_reason": self.finish_reason.unwrap_or_else(|| {
                    if has_tool_calls { "tool_calls".to_owned() } else { "stop".to_owned() }
                })
            }],
            "usage": usage
        }))
    }
}

fn estimate_usage(messages: &[ChatMessage], completion: &str) -> UsageBreakdown {
    let prompt_chars: usize = messages
        .iter()
        .map(|message| match &message.content {
            ChatContent::Text(text) => text.chars().count(),
            ChatContent::Parts(parts) => parts
                .iter()
                .filter_map(|part| part.text.as_ref().map(|text| text.chars().count()))
                .sum(),
            ChatContent::Null => 0,
        })
        .sum();
    let prompt_tokens = (prompt_chars / 4).max(1) as i64;
    let completion_tokens = (completion.chars().count() / 4).max(1) as i64;

    UsageBreakdown {
        prompt_tokens,
        completion_tokens,
        total_tokens: prompt_tokens + completion_tokens,
        ..Default::default()
    }
}

fn random_hex(length: usize) -> String {
    let mut bytes = vec![0u8; length];
    let _ = getrandom::fill(&mut bytes);

    hex::encode(bytes)
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

    Ok(ProviderAdapter::Qoder(QoderExecutor::new(
        endpoints, database, client,
    )))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{Aggregator, EnvelopeTranslator, build_body, data_payload, resolve_model_key};
    use crate::features::gateway::model::ChatCompletionRequest;
    use crate::features::providers::qoder::catalog::ModelConfig;
    use crate::infrastructure::database::providers::QoderCredentials;

    fn credentials() -> QoderCredentials {
        QoderCredentials {
            access_token: "device-token".to_owned(),
            refresh_token: None,
            token_expires_at: None,
            user_id: "user-1".to_owned(),
            name: "Tester".to_owned(),
            email: "tester@example.com".to_owned(),
        }
    }

    fn config(key: &str) -> ModelConfig {
        ModelConfig {
            key: key.to_owned(),
            is_reasoning: false,
            max_output_tokens: 32_768,
            source: "system".to_owned(),
        }
    }

    fn request() -> ChatCompletionRequest {
        serde_json::from_value(json!({
            "model": "qd/auto",
            "messages": [
                {"role": "system", "content": "be brief"},
                {"role": "developer", "content": "stay on topic"},
                {"role": "user", "content": "hi"},
                {"role": "assistant", "content": "hello"},
                {"role": "assistant", "content": null, "tool_calls": [
                    {"id": "call-1", "type": "function", "function": {"name": "search", "arguments": "{}"}}
                ]},
                {"role": "tool", "tool_call_id": "call-1", "content": "result"}
            ],
            "max_tokens": 100_000
        }))
        .expect("request parses")
    }

    #[test]
    fn the_body_lifts_the_system_prompt_and_keeps_the_conversation() {
        let body = build_body("auto", &config("auto"), &credentials(), &request());

        assert_eq!(body["system"], "be brief\n\nstay on topic");
        assert_eq!(body["messages"].as_array().expect("messages").len(), 4);
        assert_eq!(body["messages"][0]["role"], "user");
        assert_eq!(body["messages"][3]["role"], "tool");
        assert_eq!(body["messages"][3]["tool_call_id"], "call-1");
        assert_eq!(body["model_config"]["key"], "auto");
        assert_eq!(body["chat_context"]["text"], "hi");
        assert_eq!(body["business"]["name"], "hi");
    }

    #[test]
    fn the_requested_budget_is_clamped_to_the_model_output_cap() {
        let body = build_body("auto", &config("auto"), &credentials(), &request());

        assert_eq!(body["parameters"]["max_tokens"], 32_768);
        assert_eq!(
            body["model_config"]["max_output_tokens"], 32_768,
            "the cap is reported alongside the budget"
        );
    }

    #[test]
    fn session_and_record_ids_are_stable_for_the_same_conversation() {
        let request = request();
        let first = build_body("auto", &config("auto"), &credentials(), &request);
        let second = build_body("auto", &config("auto"), &credentials(), &request);

        assert_eq!(first["session_id"], second["session_id"]);
        assert_eq!(first["chat_record_id"], second["chat_record_id"]);
        assert_eq!(first["session_id"].as_str().expect("hash").len(), 16);
        assert_ne!(
            first["request_id"], second["request_id"],
            "each attempt needs its own request id"
        );
    }

    #[test]
    fn the_body_carries_the_catalog_reasoning_flag() {
        let mut config = config("auto");
        config.is_reasoning = true;

        let body = build_body("auto", &config, &credentials(), &request());

        assert_eq!(body["model_config"]["is_reasoning"], true);
        assert_eq!(
            body["chat_context"]["extra"]["modelConfig"]["is_reasoning"],
            true
        );
    }

    #[test]
    fn aliases_resolve_before_the_catalog_lookup() {
        assert_eq!(resolve_model_key("qwen3.7-max"), "qmodel_latest");
        assert_eq!(resolve_model_key("qmodel_latest"), "qmodel_latest");
    }

    #[test]
    fn only_data_lines_carry_a_payload() {
        assert_eq!(data_payload("data: {}"), Some("{}"));
        assert_eq!(data_payload("data:[DONE]"), None);
        assert_eq!(data_payload("event: finish"), None);
        assert_eq!(data_payload("data: "), None);
    }

    /// One upstream frame: an envelope holding a stringified chunk.
    fn envelope(body: &str, status: i64) -> String {
        let encoded = serde_json::to_string(body).expect("body encodes");

        format!("data: {{\"headers\":{{}},\"body\":{encoded},\"statusCodeValue\":{status}}}")
    }

    #[test]
    fn the_translator_fills_the_fields_a_client_reads() {
        let mut translator = EnvelopeTranslator::new("auto");
        let payload = envelope(
            r#"{"choices":[{"index":0,"delta":{"content":"hel"},"finish_reason":null}]}"#,
            200,
        );
        let frames = translator.push(format!("{payload}\n").as_bytes());

        assert_eq!(frames.len(), 1);
        let frame = frames[0].as_ref().expect("frame");
        let text = String::from_utf8(frame.to_vec()).expect("utf8");
        let json: serde_json::Value =
            serde_json::from_str(text.trim_start_matches("data: ")).expect("chunk parses");

        assert_eq!(json["object"], "chat.completion.chunk");
        assert_eq!(json["model"], "auto");
        assert!(json["id"].as_str().expect("id").starts_with("chatcmpl-"));
        assert_eq!(json["choices"][0]["index"], 0);
        assert_eq!(json["choices"][0]["delta"]["content"], "hel");
    }

    #[test]
    fn frames_split_across_reads_are_reassembled() {
        let mut translator = EnvelopeTranslator::new("auto");
        let payload = envelope(
            r#"{"choices":[{"index":0,"delta":{"content":"hi"},"finish_reason":null}]}"#,
            200,
        );
        let cut = payload.len() / 2;

        assert!(
            translator.push(&payload.as_bytes()[..cut]).is_empty(),
            "a partial line emits nothing"
        );
        let frames = translator.push(format!("{}\n", &payload[cut..]).as_bytes());
        assert_eq!(frames.len(), 1);

        let finished = translator.finish();
        assert_eq!(
            String::from_utf8(
                finished
                    .last()
                    .expect("terminator")
                    .as_ref()
                    .expect("bytes")
                    .to_vec(),
            )
            .expect("utf8"),
            "data: [DONE]\n\n"
        );
    }

    #[test]
    fn a_failed_envelope_becomes_an_error_event() {
        let mut translator = EnvelopeTranslator::new("auto");
        let payload = envelope("upstream exploded", 503);
        let frames = translator.push(format!("{payload}\n").as_bytes());

        assert_eq!(frames.len(), 1);
        let error = frames[0].as_ref().expect_err("error envelope fails");
        assert_eq!(error.status(), 500);
        assert!(error.message().contains("503"));
    }

    #[test]
    fn the_aggregator_reassembles_fragmented_tool_calls() {
        let request = serde_json::from_value::<ChatCompletionRequest>(json!({
            "model": "auto",
            "messages": [{"role": "user", "content": "search for it"}]
        }))
        .expect("request parses");
        let mut aggregator = Aggregator::new("auto");

        for fragment in [
            r#"{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"name":"search","arguments":""}}]},"finish_reason":null}]}"#,
            r#"{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\"q\""}}]},"finish_reason":null}]}"#,
            r#"{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":":\"rust\"}"}}]},"finish_reason":"tool_calls"}]}"#,
        ] {
            let payload = envelope(fragment, 200);

            aggregator
                .accept(payload.trim_start_matches("data: "))
                .expect("chunk accepts");
        }

        let response = aggregator.finish(&request).expect("response builds");
        let call = &response["choices"][0]["message"]["tool_calls"][0];

        assert_eq!(response["object"], "chat.completion");
        assert_eq!(response["choices"][0]["finish_reason"], "tool_calls");
        assert_eq!(call["id"], "call-1");
        assert_eq!(call["function"]["name"], "search");
        assert_eq!(call["function"]["arguments"], r#"{"q":"rust"}"#);
        assert!(
            response["usage"]["total_tokens"]
                .as_i64()
                .expect("usage estimated")
                > 0
        );
    }
}
