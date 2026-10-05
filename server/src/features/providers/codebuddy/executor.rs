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

use std::collections::{BTreeMap, VecDeque};
use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;

use axum::body::Bytes;
use futures_util::{Stream, StreamExt};
use reqwest::header::{HeaderName, HeaderValue};
use serde_json::{Value, json};

use crate::clock::now_ms;
use crate::constants;
use crate::error::APIError;
use crate::features::gateway::model::ChatCompletionRequest;
use crate::features::gateway::sse;
use crate::features::providers::adapter::{
    ProviderAdapter, ProviderStream, upstream_error, upstream_status_error,
    upstream_stream_status_error,
};
use crate::features::providers::codebuddy::catalog::{
    CodeBuddyCatalog, SharedCatalog, read_catalog, write_catalog,
};
use crate::features::providers::codebuddy::types::{CodeBuddyEndpoints, Flavor};
use crate::features::providers::executor::{BoxFuture, ProviderExecutor};
use crate::infrastructure::database::AppDatabase;
use crate::infrastructure::database::providers::{
    CodeBuddyCredentials, load_codebuddy_credentials,
};
use crate::infrastructure::upstream::{STREAM_IDLE_TIMEOUT, UpstreamClient};

pub const CATALOG_REQUEST_TIMEOUT: Duration = Duration::from_secs(10);

struct PreparedRequest {
    url: String,
    model_key: String,
    encoded_body: String,
    headers: BTreeMap<&'static str, String>,
}

/// CodeBuddy's live catalog and credential-backed OpenAI-compatible transport.
#[derive(Clone)]
pub struct CodeBuddyExecutor {
    flavor: Flavor,
    endpoints: CodeBuddyEndpoints,
    database: Option<AppDatabase>,
    client: UpstreamClient,
    pub catalog: SharedCatalog,
    catalog_refresh_lock: Arc<tokio::sync::Mutex<()>>,
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

    /// An empty catalog waits for the shared fetch; a populated one refreshes in
    /// the background. The catalog is gated on the flavor's exact connection, so
    /// the global and China adapters never advertise each other's models.
    pub async fn maybe_refresh(&self, force: bool) {
        let Some(database) = self.database.as_ref() else {
            return;
        };
        match load_codebuddy_credentials(database, self.flavor.provider_id()).await {
            Ok(Some(_)) => {}
            Ok(None) => {
                *write_catalog(&self.catalog) = CodeBuddyCatalog::empty();
                return;
            }
            Err(_) => return,
        }

        if read_catalog(&self.catalog).is_empty() {
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
        let credentials = self.credentials().await?;
        let mut headers = self.base_headers();
        headers.insert("Accept", "application/json".to_owned());
        headers.insert("Authorization", bearer_token(&credentials.access_token));
        let response = apply_headers(
            self.client
                .raw()
                .get(&self.endpoints.config_url)
                .timeout(CATALOG_REQUEST_TIMEOUT),
            &headers,
        )
        .send()
        .await
        .map_err(upstream_error)?;
        let status = response.status();

        if !status.is_success() {
            let detail = response.text().await.unwrap_or_default();
            return Err(upstream_status_error(status, &detail));
        }

        let payload = response.json::<Value>().await.map_err(|error| {
            APIError::new(500, constants::providers::could_not_decode_response(&error))
        })?;
        if let Some(catalog) = CodeBuddyCatalog::parse_config(&payload) {
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

    async fn chat_response(
        &self,
        model: &str,
        request: &ChatCompletionRequest,
        buffered: bool,
    ) -> Result<(reqwest::Response, PreparedRequest), APIError> {
        let prepared = self.prepare(model, request).await?;
        let mut builder = self
            .client
            .raw()
            .post(&prepared.url)
            .body(prepared.encoded_body.clone());
        if buffered {
            builder = builder.timeout(self.client.request_timeout());
        }
        let response = apply_headers(builder, &prepared.headers)
            .send()
            .await
            .map_err(upstream_error)?;
        let status = response.status();
        if !status.is_success() {
            let detail = response.text().await.unwrap_or_default();
            return Err(if buffered {
                upstream_status_error(status, &detail)
            } else {
                upstream_stream_status_error(status, &detail)
            });
        }

        Ok((response, prepared))
    }

    async fn prepare(
        &self,
        model: &str,
        request: &ChatCompletionRequest,
    ) -> Result<PreparedRequest, APIError> {
        let credentials = self.credentials().await?;
        let model_key = strip_provider_prefix(model.trim()).to_owned();
        let body = transform_body(&model_key, request)?;
        let encoded_body = serde_json::to_string(&body).map_err(|error| {
            APIError::new(500, constants::providers::could_not_build_request(&error))
        })?;
        let mut headers = self.base_headers();
        headers.insert("Content-Type", "application/json".to_owned());
        headers.insert("Authorization", bearer_token(&credentials.access_token));

        Ok(PreparedRequest {
            url: self.endpoints.chat_url.clone(),
            model_key,
            encoded_body,
            headers,
        })
    }

    /// The header vocabulary the Node oracle sets on every request, minus the
    /// per-request `Content-Type`/`Accept`/`Authorization`.
    fn base_headers(&self) -> BTreeMap<&'static str, String> {
        let mut headers = BTreeMap::new();
        headers.insert("User-Agent", self.flavor.user_agent().to_owned());
        headers.insert("X-Product", "SaaS".to_owned());
        headers.insert("X-IDE-Type", self.flavor.ide_name().to_owned());
        headers.insert("X-IDE-Name", self.flavor.ide_name().to_owned());
        headers.insert("x-requested-with", "XMLHttpRequest".to_owned());
        headers.insert("x-codebuddy-request", "1".to_owned());
        if let Some(domain) = self.endpoints.domain {
            headers.insert("X-Domain", domain.to_owned());
        }
        headers
    }

    async fn credentials(&self) -> Result<CodeBuddyCredentials, APIError> {
        let database = self.database.as_ref().ok_or_else(|| {
            APIError::new(500, constants::providers::codebuddy::DATABASE_REQUIRED)
        })?;

        load_codebuddy_credentials(database, self.flavor.provider_id())
            .await?
            .ok_or_else(|| APIError::new(401, constants::providers::codebuddy::NOT_CONNECTED))
    }
}

fn bearer_token(token: &str) -> String {
    format!("Bearer {token}")
}

/// Node's `stripProviderPrefix` drops everything up to the first slash. The
/// registry already hands over a bare id, so this only matters for a direct
/// call; CodeBuddy ids carry no slash.
fn strip_provider_prefix(model: &str) -> &str {
    model.split_once('/').map_or(model, |(_, rest)| rest)
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

/// Rewrites a request into the shape CodeBuddy upstream expects. Mirrors
/// `transformRequestBody` in the Node oracle field for field.
fn transform_body(model_key: &str, request: &ChatCompletionRequest) -> Result<Value, APIError> {
    let mut body = serde_json::to_value(request).map_err(|error| {
        APIError::new(500, constants::providers::could_not_build_request(&error))
    })?;
    body["model"] = Value::String(model_key.to_owned());
    // CodeBuddy upstream is stream-only and rejects a non-streaming request.
    body["stream"] = Value::Bool(true);

    // A disabled effort is dropped; any real level asks for an automatic
    // reasoning summary.
    if let Some(effort) = request.reasoning_effort.as_deref() {
        if effort == "none" || effort == "off" {
            if let Some(object) = body.as_object_mut() {
                object.remove("reasoning_effort");
            }
        } else {
            body["reasoning_summary"] = Value::String("auto".to_owned());
        }
    }

    let source = body
        .get("messages")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut messages = build_messages(&source);
    apply_response_format(&mut body, request, &mut messages);
    body["messages"] = Value::Array(messages);

    Ok(body)
}

/// The leading identity prompt plus the caller's own system/developer turns,
/// with user strings rewritten to typed text blocks.
fn build_messages(source: &[Value]) -> Vec<Value> {
    let mut system_prompts: Vec<String> = Vec::new();
    for message in source {
        if is_system_role(message)
            && let Some(content) = message.get("content").and_then(Value::as_str)
        {
            let trimmed = content.trim();
            if !trimmed.is_empty() {
                system_prompts.push(trimmed.to_owned());
            }
        }
    }

    let combined_system = if system_prompts.is_empty() {
        "You are CodeBuddy Code.".to_owned()
    } else {
        format!("You are CodeBuddy Code.\n\n{}", system_prompts.join("\n\n"))
    };

    let mut messages = vec![json!({ "role": "system", "content": combined_system })];
    for message in source {
        if is_system_role(message) {
            continue;
        }
        let mut message = message.clone();
        if message.get("role").and_then(Value::as_str) == Some("user")
            && let Some(text) = message.get("content").and_then(Value::as_str)
        {
            message["content"] = json!([{ "type": "text", "text": text }]);
        }
        messages.push(message);
    }

    messages
}

/// Drops `response_format` (upstream ignores it) and mirrors the schema or the
/// JSON directive into the last user turn, the only lever these models follow.
fn apply_response_format(
    body: &mut Value,
    request: &ChatCompletionRequest,
    messages: &mut [Value],
) {
    let Some(format) = request.response_format.as_ref() else {
        return;
    };
    if format.kind != "json_schema" && format.kind != "json_object" {
        return;
    }

    if let Some(object) = body.as_object_mut() {
        object.remove("response_format");
    }

    let directive = if format.kind == "json_object" {
        "Respond only in valid JSON.".to_owned()
    } else {
        match format.json_schema.as_ref() {
            Some(value) => {
                let schema = value.get("schema").unwrap_or(value);
                format!(
                    "You must respond with valid JSON matching this schema:\n{}",
                    serde_json::to_string_pretty(schema).unwrap_or_default()
                )
            }
            None => String::new(),
        }
    };

    if !directive.is_empty() {
        append_to_last_user(messages, &directive);
    }
}

fn append_to_last_user(messages: &mut [Value], directive: &str) {
    for message in messages.iter_mut().rev() {
        if message.get("role").and_then(Value::as_str) != Some("user") {
            continue;
        }
        match message.get_mut("content") {
            Some(Value::Array(parts)) => {
                for part in parts.iter_mut().rev() {
                    if part.get("type").and_then(Value::as_str) == Some("text")
                        && let Some(text) = part.get("text").and_then(Value::as_str)
                    {
                        part["text"] = Value::String(format!("{text}\n\n{directive}"));
                        break;
                    }
                }
            }
            Some(Value::String(text)) => {
                message["content"] = Value::String(format!("{text}\n\n{directive}"));
            }
            _ => {}
        }
        break;
    }
}

fn is_system_role(message: &Value) -> bool {
    matches!(
        message.get("role").and_then(Value::as_str),
        Some("system" | "developer")
    )
}

#[derive(Debug)]
enum DecodedFrame {
    Data(Value),
    Done,
    Error(APIError),
}

/// Splits the upstream body into trimmed lines and decodes each one, handling
/// both OpenAI `data: {...}` framing and raw NDJSON lines (Node's `streamLines`
/// + `parseDataLine`). Malformed JSON is skipped, exactly as the oracle does.
#[derive(Default)]
struct LineDecoder {
    buffer: String,
    finished: bool,
}

impl LineDecoder {
    fn push(&mut self, bytes: &[u8]) -> Vec<DecodedFrame> {
        if self.finished {
            return Vec::new();
        }
        self.buffer.push_str(&String::from_utf8_lossy(bytes));
        let mut frames = Vec::new();

        while let Some(position) = self.buffer.find('\n') {
            let line = self.buffer[..position].trim().to_owned();
            self.buffer.drain(..=position);
            if let Some(frame) = self.decode_line(&line) {
                frames.push(frame);
                if self.finished {
                    break;
                }
            }
        }

        frames
    }

    fn finish(&mut self) -> Vec<DecodedFrame> {
        if self.finished {
            return Vec::new();
        }
        let line = self.buffer.trim().to_owned();
        self.buffer.clear();
        self.decode_line(&line).into_iter().collect()
    }

    fn decode_line(&mut self, line: &str) -> Option<DecodedFrame> {
        let payload = line.strip_prefix("data:").map(str::trim).unwrap_or(line);
        if payload.is_empty() {
            return None;
        }
        if payload == "[DONE]" {
            self.finished = true;
            return Some(DecodedFrame::Done);
        }

        let Ok(value) = serde_json::from_str::<Value>(payload) else {
            return None;
        };
        if let Some(message) = stream_error_message(&value) {
            self.finished = true;
            return Some(DecodedFrame::Error(APIError::new(500, message)));
        }
        Some(DecodedFrame::Data(value))
    }
}

fn stream_error_message(value: &Value) -> Option<String> {
    if let Some(error) = value.get("error").filter(|error| !error.is_null()) {
        if let Some(message) = error.as_str() {
            return Some(message.to_owned());
        }
        if let Some(message) = error
            .get("message")
            .or_else(|| error.get("code"))
            .and_then(Value::as_str)
        {
            return Some(message.to_owned());
        }
    }

    let choice = value.get("choices")?.as_array()?.first()?;
    if choice.get("finish_reason").and_then(Value::as_str) != Some("error") {
        return None;
    }

    choice
        .get("error")
        .and_then(|error| {
            error
                .get("message")
                .or_else(|| error.get("code"))
                .and_then(Value::as_str)
                .or_else(|| error.as_str())
        })
        .map(str::to_owned)
        .or_else(|| Some("CodeBuddy stream failed".to_owned()))
}

fn translate_stream<S>(upstream: S) -> ProviderStream
where
    S: Stream<Item = Result<Bytes, reqwest::Error>> + Send + 'static,
{
    type State<S> = Option<(Pin<Box<S>>, LineDecoder, VecDeque<Bytes>, bool)>;

    let state: State<S> = Some((
        Box::pin(upstream),
        LineDecoder::default(),
        VecDeque::new(),
        false,
    ));
    let events = futures_util::stream::unfold(state, |state| async move {
        let (mut upstream, mut decoder, mut pending, mut done) = state?;

        loop {
            if let Some(frame) = pending.pop_front() {
                return Some((frame, Some((upstream, decoder, pending, done))));
            }
            if done {
                return None;
            }

            match tokio::time::timeout(STREAM_IDLE_TIMEOUT, upstream.next()).await {
                Ok(Some(Ok(bytes))) => {
                    let mut saw_done = false;
                    for frame in decoder.push(&bytes) {
                        if matches!(frame, DecodedFrame::Done) {
                            saw_done = true;
                        }
                        pending.push_back(encode_frame(frame));
                    }
                    if saw_done {
                        done = true;
                    }
                }
                Ok(Some(Err(error))) => {
                    let failure =
                        APIError::new(500, constants::providers::upstream_stream_failed(&error));
                    pending.push_back(sse::error_event_bytes(&failure));
                    done = true;
                }
                Ok(None) => {
                    let mut saw_done = false;
                    for frame in decoder.finish() {
                        if matches!(frame, DecodedFrame::Done) {
                            saw_done = true;
                        }
                        pending.push_back(encode_frame(frame));
                    }
                    if !saw_done {
                        pending.push_back(Bytes::from_static(b"data: [DONE]\n\n"));
                    }
                    done = true;
                }
                Err(_) => {
                    let failure = APIError::new(
                        500,
                        constants::providers::upstream_stalled(STREAM_IDLE_TIMEOUT.as_secs()),
                    );
                    pending.push_back(sse::error_event_bytes(&failure));
                    done = true;
                }
            }
        }
    });

    Box::pin(events)
}

fn encode_frame(frame: DecodedFrame) -> Bytes {
    match frame {
        DecodedFrame::Data(value) => Bytes::from(format!("data: {value}\n\n")),
        DecodedFrame::Done => Bytes::from_static(b"data: [DONE]\n\n"),
        DecodedFrame::Error(error) => sse::error_event_bytes(&error),
    }
}

#[derive(Default)]
struct ToolCallAccumulator {
    id: String,
    name: String,
    arguments: String,
}

struct Aggregator {
    model: String,
    id: String,
    created: i64,
    content: String,
    reasoning: String,
    finish_reason: Option<String>,
    usage: Option<Value>,
    tool_calls: BTreeMap<usize, ToolCallAccumulator>,
}

impl Aggregator {
    fn new(model: &str) -> Self {
        let now = now_ms();
        Self {
            model: model.to_owned(),
            id: format!("chatcmpl-{now}"),
            created: now / 1000,
            content: String::new(),
            reasoning: String::new(),
            finish_reason: None,
            usage: None,
            tool_calls: BTreeMap::new(),
        }
    }

    fn accept(&mut self, frame: DecodedFrame) -> Result<(), APIError> {
        match frame {
            DecodedFrame::Data(value) => self.accept_value(value),
            DecodedFrame::Done => Ok(()),
            DecodedFrame::Error(error) => Err(error),
        }
    }

    fn accept_value(&mut self, value: Value) -> Result<(), APIError> {
        if let Some(usage) = value.get("usage").filter(|usage| !usage.is_null()) {
            self.usage = Some(usage.clone());
        }

        let Some(choice) = value
            .get("choices")
            .and_then(Value::as_array)
            .and_then(|choices| choices.first())
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
        let reasoning = match delta.get("reasoning_content").and_then(Value::as_str) {
            Some(text) if !text.is_empty() => Some(text),
            _ => delta.get("reasoning").and_then(Value::as_str),
        };
        if let Some(reasoning) = reasoning {
            self.reasoning.push_str(reasoning);
        }

        for call in delta
            .get("tool_calls")
            .and_then(Value::as_array)
            .map(Vec::as_slice)
            .unwrap_or_default()
        {
            let index = call.get("index").and_then(Value::as_u64).unwrap_or(0) as usize;
            let entry = self.tool_calls.entry(index).or_default();
            // Upstream repeats the call on every argument chunk with an empty
            // id/name, so only a non-empty value may overwrite the one that
            // introduced it (Node's `if (tc.id)` / `if (name)` truthiness).
            if let Some(id) = call.get("id").and_then(Value::as_str)
                && !id.is_empty()
            {
                entry.id = id.to_owned();
            }
            if let Some(name) = call
                .get("function")
                .and_then(|function| function.get("name"))
                .and_then(Value::as_str)
                && !name.is_empty()
            {
                entry.name = name.to_owned();
            }
            if let Some(arguments) = call
                .get("function")
                .and_then(|function| function.get("arguments"))
                .and_then(Value::as_str)
            {
                entry.arguments.push_str(arguments);
            }
        }

        Ok(())
    }

    fn finish(self) -> Value {
        let tool_calls: Vec<Value> = self
            .tool_calls
            .into_values()
            .map(|entry| {
                json!({
                    "id": entry.id,
                    "type": "function",
                    "function": { "name": entry.name, "arguments": entry.arguments }
                })
            })
            .collect();
        let has_tool_calls = !tool_calls.is_empty();

        // Reasoning-only models (glm-5.3, kimi-k3) can finish with no content;
        // the reasoning text is the only answer the caller can be given.
        let effective_content = if !self.content.is_empty() {
            Value::String(self.content.clone())
        } else if !self.reasoning.is_empty() {
            Value::String(self.reasoning.clone())
        } else {
            Value::Null
        };

        let mut message = json!({
            "role": "assistant",
            "content": effective_content,
        });
        if !self.reasoning.is_empty() {
            message["reasoning_content"] = Value::String(self.reasoning);
        }
        if has_tool_calls {
            message["tool_calls"] = Value::Array(tool_calls);
        }

        let mut response = json!({
            "id": self.id,
            "object": "chat.completion",
            "created": self.created,
            "model": self.model,
            "choices": [{
                "index": 0,
                "message": message,
                "finish_reason": self.finish_reason.unwrap_or_else(|| "stop".to_owned()),
            }],
        });
        if let Some(usage) = self.usage {
            response["usage"] = usage;
        }

        response
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

#[cfg(test)]
mod tests {
    use super::*;

    fn request(value: Value) -> ChatCompletionRequest {
        serde_json::from_value(value).expect("request parses")
    }

    fn simple_request() -> ChatCompletionRequest {
        request(json!({
            "model": "codebuddy/gpt-5.6-astra",
            "messages": [{"role": "user", "content": "hello"}]
        }))
    }

    #[test]
    fn executor_contract_uses_flavor_metadata_and_public_catalog() {
        let global = CodeBuddyExecutor::new(
            Flavor::Global,
            Flavor::Global.endpoints(),
            None,
            UpstreamClient::new().expect("client"),
        );
        let china = CodeBuddyExecutor::new(
            Flavor::China,
            Flavor::China.endpoints(),
            None,
            UpstreamClient::new().expect("client"),
        );

        assert_eq!(global.id(), "codebuddy");
        assert_eq!(global.keys(), &["codebuddy"]);
        assert_eq!(global.alias(), "codebuddy");
        assert!(global.models().is_empty());

        assert_eq!(china.id(), "codebuddy-cn");
        assert_eq!(china.keys(), &["codebuddy-cn"]);
        assert_eq!(china.alias(), "codebuddy-cn");
        assert!(china.models().is_empty());
    }

    #[test]
    fn transform_uses_the_bare_model_and_always_streams() {
        let body = transform_body("gpt-5.6-astra", &simple_request()).expect("body builds");

        assert_eq!(body["model"], "gpt-5.6-astra");
        assert_eq!(body["stream"], true);
    }

    #[test]
    fn transform_prepends_the_identity_prompt_and_keeps_caller_system_turns() {
        let body = transform_body(
            "gpt-5.6-astra",
            &request(json!({
                "model": "codebuddy/gpt-5.6-astra",
                "messages": [
                    {"role": "system", "content": "Be terse."},
                    {"role": "developer", "content": "Prefer JSON."},
                    {"role": "user", "content": "hi"}
                ]
            })),
        )
        .expect("body builds");

        assert_eq!(body["messages"][0]["role"], "system");
        assert_eq!(
            body["messages"][0]["content"],
            "You are CodeBuddy Code.\n\nBe terse.\n\nPrefer JSON."
        );
        assert_eq!(body["messages"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn transform_rewrites_user_strings_to_typed_blocks() {
        let body = transform_body("gpt-5.6-astra", &simple_request()).expect("body builds");

        assert_eq!(body["messages"][1]["role"], "user");
        assert_eq!(
            body["messages"][1]["content"],
            json!([{"type": "text", "text": "hello"}])
        );
    }

    #[test]
    fn transform_drops_a_disabled_effort_and_summarizes_a_real_one() {
        let disabled = transform_body(
            "gpt-5.6-astra",
            &request(json!({
                "model": "codebuddy/gpt-5.6-astra",
                "messages": [{"role": "user", "content": "hi"}],
                "reasoning_effort": "none"
            })),
        )
        .expect("body builds");
        assert!(disabled.get("reasoning_effort").is_none());
        assert!(disabled.get("reasoning_summary").is_none());

        let enabled = transform_body(
            "gpt-5.6-astra",
            &request(json!({
                "model": "codebuddy/gpt-5.6-astra",
                "messages": [{"role": "user", "content": "hi"}],
                "reasoning_effort": "high"
            })),
        )
        .expect("body builds");
        assert_eq!(enabled["reasoning_summary"], "auto");
        assert_eq!(enabled["reasoning_effort"], "high");
    }

    #[test]
    fn transform_mirrors_a_json_object_format_into_the_last_user_turn() {
        let body = transform_body(
            "gpt-5.6-astra",
            &request(json!({
                "model": "codebuddy/gpt-5.6-astra",
                "messages": [{"role": "user", "content": "hi"}],
                "response_format": {"type": "json_object"}
            })),
        )
        .expect("body builds");

        assert!(body.get("response_format").is_none());
        assert_eq!(
            body["messages"][1]["content"][0]["text"],
            "hi\n\nRespond only in valid JSON."
        );
    }

    #[test]
    fn transform_mirrors_a_json_schema_format_into_the_last_user_turn() {
        let body = transform_body(
            "gpt-5.6-astra",
            &request(json!({
                "model": "codebuddy/gpt-5.6-astra",
                "messages": [{"role": "user", "content": "hi"}],
                "response_format": {
                    "type": "json_schema",
                    "json_schema": {"schema": {"type": "object", "properties": {"ok": {"type": "boolean"}}}}
                }
            })),
        )
        .expect("body builds");

        assert!(body.get("response_format").is_none());
        let text = body["messages"][1]["content"][0]["text"]
            .as_str()
            .expect("text part");
        assert!(text.starts_with("hi\n\nYou must respond with valid JSON matching this schema:\n"));
        assert!(text.contains("\"type\": \"object\""));
    }

    #[test]
    fn a_disabled_effort_is_absent_from_the_serialized_body() {
        // `reasoning_effort` is skipped when None; the drop path only removes a
        // value the caller actually sent.
        let body = transform_body(
            "gpt-5.6-astra",
            &request(json!({
                "model": "codebuddy/gpt-5.6-astra",
                "messages": [{"role": "user", "content": "hi"}],
                "reasoning_effort": "off"
            })),
        )
        .expect("body builds");
        assert!(body.get("reasoning_effort").is_none());
    }

    #[test]
    fn line_decoder_reads_data_frames_and_ndjson_and_done_once() {
        let mut decoder = LineDecoder::default();
        let frames = decoder.push(b"data: {\"choices\":[{\"delta\":{\"content\":\"a\"}}]}\n");
        assert!(
            matches!(&frames[0], DecodedFrame::Data(value) if value["choices"][0]["delta"]["content"] == "a")
        );

        let frames =
            decoder.push(b"{\"choices\":[{\"delta\":{\"content\":\"b\"}}]}\ndata: [DONE]\n");
        assert!(matches!(&frames[0], DecodedFrame::Data(_)));
        assert!(matches!(&frames[1], DecodedFrame::Done));
        assert!(decoder.finish().is_empty());
    }

    #[test]
    fn line_decoder_reassembles_a_fragmented_line() {
        let mut decoder = LineDecoder::default();
        assert!(decoder.push(b"data: {\"choices\":[{").is_empty());
        let frames = decoder.push(b"\"delta\":{\"content\":\"hi\"}}]}\n\n");
        assert!(
            matches!(&frames[0], DecodedFrame::Data(value) if value["choices"][0]["delta"]["content"] == "hi")
        );
    }

    #[test]
    fn an_error_frame_becomes_an_error() {
        let mut decoder = LineDecoder::default();
        let frames = decoder.push(b"data: {\"error\":{\"message\":\"boom\"}}\n");
        assert!(matches!(&frames[0], DecodedFrame::Error(error) if error.message() == "boom"));
    }

    #[test]
    fn aggregator_reassembles_content_reasoning_tools_finish_and_usage() {
        let mut aggregator = Aggregator::new("gpt-5.6-astra");
        for value in [
            json!({"choices":[{"delta":{"content":"hel","reasoning_content":"why "},"finish_reason":null}]}),
            json!({"choices":[{"delta":{"content":"lo","reasoning_content":"not","tool_calls":[{"index":0,"id":"call-1","function":{"name":"search","arguments":"{\"q\""}}]},"finish_reason":null}]}),
            json!({"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":":\"rust\"}"}}]},"finish_reason":"tool_calls"}]}),
            json!({"choices":[],"usage":{"prompt_tokens":2,"completion_tokens":3,"total_tokens":5}}),
        ] {
            aggregator
                .accept(DecodedFrame::Data(value))
                .expect("chunk accepts");
        }

        let response = aggregator.finish();
        assert_eq!(response["object"], "chat.completion");
        assert_eq!(response["model"], "gpt-5.6-astra");
        assert_eq!(response["choices"][0]["message"]["content"], "hello");
        assert_eq!(
            response["choices"][0]["message"]["reasoning_content"],
            "why not"
        );
        assert_eq!(
            response["choices"][0]["message"]["tool_calls"][0]["function"]["arguments"],
            r#"{"q":"rust"}"#
        );
        assert!(
            response["choices"][0]["message"]["tool_calls"][0]
                .get("index")
                .is_none(),
            "the Node shape omits the tool-call index"
        );
        assert_eq!(response["choices"][0]["finish_reason"], "tool_calls");
        assert_eq!(response["usage"]["total_tokens"], 5);
    }

    #[test]
    fn a_repeated_blank_tool_call_name_does_not_erase_the_one_that_named_it() {
        // The real upstream stream names the call once, then repeats it with an
        // empty `name` on every argument chunk. Those blanks must not overwrite.
        let mut aggregator = Aggregator::new("deepseek-v4.1-flash");
        for value in [
            json!({"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"name":"get_weather","arguments":""}}]},"finish_reason":null}]}),
            json!({"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"","arguments":"{\"city\""}}]},"finish_reason":null}]}),
            json!({"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"","arguments":":\"Jakarta\"}"}}]},"finish_reason":"tool_calls"}]}),
        ] {
            aggregator
                .accept(DecodedFrame::Data(value))
                .expect("chunk accepts");
        }

        let response = aggregator.finish();
        let call = &response["choices"][0]["message"]["tool_calls"][0];
        assert_eq!(call["id"], "call-1");
        assert_eq!(call["function"]["name"], "get_weather");
        assert_eq!(call["function"]["arguments"], r#"{"city":"Jakarta"}"#);
    }

    #[test]
    fn aggregator_falls_back_to_reasoning_then_null_content() {
        let mut reasoning_only = Aggregator::new("glm-5.3");
        reasoning_only
            .accept(DecodedFrame::Data(json!({
                "choices": [{"delta": {"reasoning_content": "thinking"}, "finish_reason": null}]
            })))
            .expect("chunk accepts");
        let response = reasoning_only.finish();
        assert_eq!(response["choices"][0]["message"]["content"], "thinking");
        assert_eq!(
            response["choices"][0]["message"]["reasoning_content"],
            "thinking"
        );

        let mut empty = Aggregator::new("glm-5.3");
        empty
            .accept(DecodedFrame::Data(json!({
                "choices": [{"delta": {}, "finish_reason": "stop"}]
            })))
            .expect("chunk accepts");
        let response = empty.finish();
        assert!(response["choices"][0]["message"]["content"].is_null());
        assert!(response.get("usage").is_none());
    }

    #[test]
    fn an_error_frame_aborts_aggregation() {
        let mut aggregator = Aggregator::new("gpt-5.6-astra");
        let error = aggregator
            .accept(DecodedFrame::Error(APIError::new(500, "boom")))
            .expect_err("error frame fails");
        assert_eq!(error.message(), "boom");
    }
}
