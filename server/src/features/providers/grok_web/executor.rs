//! Grok Web executor: cookie session probe, WebSocket chat transport, and the
//! NDJSON-frame → OpenAI translation.
//!
//! Protocol provenance (live probes against grok.com 2026-10-01, independent
//! of `packages/*`): `GET /` with a valid `sso` cookie answers `200` plus
//! `Set-Cookie: x-userid=<uuid>`, an invalid cookie answers `307` to
//! `accounts.x.ai` with no `x-userid`, and `wss://grok.com/ws/mgw/?uid=<uuid>`
//! then carries `session.create` → `conversation.attached` →
//! `response.create` → `response.chunk`* → `response.done`. The upstream never
//! reports usage, tool calls, or a model fingerprint; content arrives as
//! `chunk.text.text` frames on the `CHANNEL_ASSISTANT_RESPONSE` channel.
//!
//! Everything here is private-protocol and may change without notice; each
//! transport decision is documented at its code site. The handshake lives in
//! [`super::auth`], frame classification in [`super::transport`], prompt
//! building in [`super::request`], and frame translation in
//! [`super::translate`].

use std::collections::VecDeque;
use std::sync::{Arc, RwLock};
use std::time::Duration;

use axum::body::Bytes;
use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use tokio_tungstenite::tungstenite::Message;

use super::auth::DEFAULT_SESSION_TIMEOUT;
use super::request::{build_prompt, resolve_model, tools_active};
use super::translate::{
    TranslateState, chunk_id, encode_frame, estimate_tokens, parse_tool_calls, tool_call_response,
    tool_calls_delta,
};
use super::transport::{WsFrame, classify_message, classify_value};
use super::types::{GROK_WEB_KEYS, GROK_WEB_MODELS, GROK_WEB_PROVIDER, GrokWebEndpoints};
use crate::clock::now_ms;
use crate::constants;
use crate::error::APIError;
use crate::features::providers::adapter::{ProviderAdapter, ProviderStream};
use crate::features::providers::executor::{BoxFuture, ProviderExecutor};
use crate::features::providers::rotation::AccountRotator;
use crate::infrastructure::database::AppDatabase;
use crate::infrastructure::database::providers::load_grok_web_credentials;
use crate::infrastructure::upstream::STREAM_IDLE_TIMEOUT;
use crate::protocol::model::ChatCompletionRequest;
use crate::protocol::sse;
use crate::protocol::usage::UsageBreakdown;

// Re-exported so `grok_web::executor::{probe_client, probe_uid}` keeps resolving
// for the connect route.
pub use super::auth::{probe_client, probe_uid};

/// Grok Web chat executor over the grok.com WebSocket transport.
#[derive(Clone)]
pub struct GrokWebExecutor {
    id: &'static str,
    keys: &'static [&'static str],
    pub(super) endpoints: GrokWebEndpoints,
    pub(super) database: Option<AppDatabase>,
    /// Redirect-none client the `x-userid` page probe runs on.
    pub(super) probe_client: reqwest::Client,
    /// Advertised model ids, filled once a connection exists. The list is
    /// static, so `maybe_refresh` only tracks connection presence — without a
    /// connection the provider advertises no model, mirroring Qoder/Cline.
    catalog: Arc<RwLock<Vec<String>>>,
    pub(super) session_timeout: Duration,
    idle_timeout: Duration,
    /// Rotation and cooldown state across this provider's accounts, shared by
    /// every clone of the adapter.
    pub(super) rotator: Arc<AccountRotator>,
}

impl GrokWebExecutor {
    fn new(endpoints: GrokWebEndpoints, database: Option<AppDatabase>) -> Result<Self, APIError> {
        Ok(Self {
            id: GROK_WEB_PROVIDER.id,
            keys: GROK_WEB_KEYS,
            endpoints,
            database,
            probe_client: probe_client()?,
            catalog: Arc::new(RwLock::new(Vec::new())),
            session_timeout: DEFAULT_SESSION_TIMEOUT,
            idle_timeout: STREAM_IDLE_TIMEOUT,
            rotator: AccountRotator::shared(),
        })
    }

    /// Overrides the establishment and stream-idle timeouts. Tests use this to
    /// exercise the stall paths without waiting out the production values.
    pub fn with_timeouts(mut self, session: Duration, idle: Duration) -> Self {
        self.session_timeout = session;
        self.idle_timeout = idle;
        self
    }

    pub fn id(&self) -> &str {
        self.id
    }

    pub fn keys(&self) -> &'static [&'static str] {
        self.keys
    }

    pub fn alias(&self) -> &str {
        GROK_WEB_PROVIDER.alias
    }

    pub fn models(&self) -> Vec<String> {
        self.catalog
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }

    pub fn endpoints(&self) -> &GrokWebEndpoints {
        &self.endpoints
    }

    /// Tracks connection presence so the static model list appears in the
    /// catalog only while a Grok Web cookie is stored. No upstream fetch is
    /// involved, so the list never goes stale and `force` changes nothing.
    pub async fn maybe_refresh(&self, _force: bool) {
        let Some(database) = self.database.as_ref() else {
            return;
        };
        let connected = matches!(load_grok_web_credentials(database).await, Ok(connections) if !connections.is_empty());
        let mut catalog = self.catalog.write().unwrap_or_else(|p| p.into_inner());
        if connected && catalog.is_empty() {
            *catalog = GROK_WEB_MODELS
                .iter()
                .map(|model| model.id.to_owned())
                .collect();
        } else if !connected && !catalog.is_empty() {
            catalog.clear();
        }
    }

    pub async fn chat_completion(
        &self,
        model: &str,
        request: &ChatCompletionRequest,
    ) -> Result<Value, APIError> {
        let model_id = resolve_model(model)?;
        let prompt = build_prompt(request)?;

        let mut session = self.establish(&model_id, &prompt).await?;
        let mut content = String::new();
        let mut reasoning = String::new();

        loop {
            let event = match tokio::time::timeout(self.idle_timeout, session.ws.next()).await {
                Ok(Some(Ok(message))) => message,
                Ok(Some(Err(error))) => {
                    return Err(APIError::new(
                        500,
                        constants::providers::upstream_stream_failed(&error),
                    ));
                }
                Ok(None) => {
                    return Err(APIError::new(
                        500,
                        constants::providers::grok_web::STREAM_ENDED,
                    ));
                }
                Err(_) => {
                    return Err(APIError::new(
                        500,
                        constants::providers::upstream_stalled(self.idle_timeout.as_secs()),
                    ));
                }
            };

            match classify_message(event)? {
                WsFrame::Text(text) => content.push_str(&text),
                WsFrame::Reasoning(text) => reasoning.push_str(&text),
                WsFrame::Completed => break,
                WsFrame::Failed(reason) => {
                    return Err(APIError::new(
                        500,
                        constants::providers::grok_web::response_failed(&reason),
                    ));
                }
                WsFrame::Errored(message) => {
                    return Err(APIError::new(500, message));
                }
                WsFrame::Ignored => {}
            }
        }

        let prompt_tokens = estimate_tokens(&prompt);

        // Tools are emulated through the text channel: a reply that parses as
        // the tool envelope becomes `tool_calls` instead of content.
        if tools_active(request)
            && let Some(calls) = parse_tool_calls(&content)
        {
            return Ok(tool_call_response(
                &model_id,
                &calls,
                prompt_tokens,
                &reasoning,
            ));
        }

        let mut message = json!({ "role": "assistant", "content": content });
        if !reasoning.is_empty() {
            message["reasoning_content"] = Value::String(reasoning);
        }

        let completion_tokens = (content.chars().count() / 4).max(1) as i64;
        let usage = UsageBreakdown {
            prompt_tokens,
            completion_tokens,
            total_tokens: prompt_tokens + completion_tokens,
            ..Default::default()
        };

        Ok(json!({
            "id": chunk_id(),
            "object": "chat.completion",
            "created": now_ms() / 1000,
            "model": model_id,
            "choices": [{
                "index": 0,
                "message": message,
                "finish_reason": "stop"
            }],
            "usage": usage.to_openai_json()
        }))
    }

    pub async fn chat_completion_stream(
        &self,
        model: &str,
        request: &ChatCompletionRequest,
    ) -> Result<ProviderStream, APIError> {
        let model_id = resolve_model(model)?;
        let prompt = build_prompt(request)?;

        // Everything up to `response.create` happens before the first byte is
        // yielded, so a failed handshake surfaces as `Err` and the gateway
        // turns it into an in-stream error event rather than a half stream.
        let session = self.establish(&model_id, &prompt).await?;

        let id = chunk_id();
        let created = now_ms() / 1000;
        let mut pending = VecDeque::new();
        // OpenAI streams open with a role frame; emit it before the first WS read.
        pending.push_back(encode_frame(
            &id,
            created,
            &model_id,
            json!({ "role": "assistant", "content": "" }),
            None,
            None,
        ));

        let state = TranslateState {
            ws: session.ws,
            id,
            created,
            model: model_id,
            pending,
            finished: false,
            idle_timeout: self.idle_timeout,
            prompt_tokens: estimate_tokens(&prompt),
            completion_chars: 0,
            // With tools the reply is buffered: it is only known to be a tool
            // envelope or plain text once the turn completes.
            tool_mode: tools_active(request),
            buffer: String::new(),
        };

        Ok(Box::pin(futures_util::stream::unfold(
            Some(state),
            |state| async move {
                let mut state = state?;

                loop {
                    if let Some(frame) = state.pending.pop_front() {
                        return Some((frame, Some(state)));
                    }
                    if state.finished {
                        return None;
                    }

                    let message = match tokio::time::timeout(state.idle_timeout, state.ws.next())
                        .await
                    {
                        Ok(Some(Ok(message))) => message,
                        Ok(Some(Err(error))) => {
                            let failure = APIError::new(
                                500,
                                constants::providers::upstream_stream_failed(&error),
                            );
                            state.pending.push_back(sse::error_event_bytes(&failure));
                            state.finished = true;
                            continue;
                        }
                        Ok(None) => {
                            // EOF before `response.done`: the upstream hung up mid
                            // answer, so report it instead of pretending success.
                            let failure =
                                APIError::new(500, constants::providers::grok_web::STREAM_ENDED);
                            state.pending.push_back(sse::error_event_bytes(&failure));
                            state.finished = true;
                            continue;
                        }
                        Err(_) => {
                            let failure = APIError::new(
                                500,
                                constants::providers::upstream_stalled(
                                    state.idle_timeout.as_secs(),
                                ),
                            );
                            state.pending.push_back(sse::error_event_bytes(&failure));
                            state.finished = true;
                            continue;
                        }
                    };

                    match message {
                        Message::Ping(_) => {
                            // tungstenite queues the pong at read time; flush it so
                            // the keepalive actually reaches the upstream.
                            let _ = state.ws.flush().await;
                        }
                        Message::Close(_) => {
                            if !state.finished {
                                let failure = APIError::new(
                                    500,
                                    constants::providers::grok_web::STREAM_ENDED,
                                );
                                state.pending.push_back(sse::error_event_bytes(&failure));
                                state.finished = true;
                            }
                        }
                        Message::Text(text) => {
                            let raw = text.to_string();
                            let Some(value) = serde_json::from_str::<Value>(&raw).ok() else {
                                // Malformed frames are skipped, mirroring the
                                // reference NDJSON reader; one bad frame must not
                                // kill a healthy stream.
                                continue;
                            };
                            match classify_value(&value) {
                                WsFrame::Text(token) => {
                                    if state.tool_mode {
                                        // Buffered: a tool envelope is only
                                        // recognisable once the turn completes.
                                        state.buffer.push_str(&token);
                                    } else {
                                        state.completion_chars += token.chars().count();
                                        state.pending.push_back(encode_frame(
                                            &state.id,
                                            state.created,
                                            &state.model,
                                            json!({ "content": token }),
                                            None,
                                            None,
                                        ));
                                    }
                                }
                                WsFrame::Reasoning(token) => {
                                    state.pending.push_back(encode_frame(
                                        &state.id,
                                        state.created,
                                        &state.model,
                                        json!({ "reasoning_content": token }),
                                        None,
                                        None,
                                    ));
                                }
                                WsFrame::Completed => {
                                    let output_chars = if state.tool_mode {
                                        state.buffer.chars().count()
                                    } else {
                                        state.completion_chars
                                    };
                                    let completion_tokens = (output_chars / 4).max(1) as i64;
                                    let usage = UsageBreakdown {
                                        prompt_tokens: state.prompt_tokens,
                                        completion_tokens,
                                        total_tokens: state.prompt_tokens + completion_tokens,
                                        ..Default::default()
                                    };

                                    if state.tool_mode {
                                        match parse_tool_calls(&state.buffer) {
                                            Some(calls) => {
                                                state.pending.push_back(encode_frame(
                                                    &state.id,
                                                    state.created,
                                                    &state.model,
                                                    tool_calls_delta(&calls),
                                                    None,
                                                    None,
                                                ));
                                                state.pending.push_back(encode_frame(
                                                    &state.id,
                                                    state.created,
                                                    &state.model,
                                                    json!({}),
                                                    Some("tool_calls"),
                                                    Some(usage.to_openai_json()),
                                                ));
                                            }
                                            None => {
                                                let text = std::mem::take(&mut state.buffer);
                                                state.pending.push_back(encode_frame(
                                                    &state.id,
                                                    state.created,
                                                    &state.model,
                                                    json!({ "content": text }),
                                                    None,
                                                    None,
                                                ));
                                                state.pending.push_back(encode_frame(
                                                    &state.id,
                                                    state.created,
                                                    &state.model,
                                                    json!({}),
                                                    Some("stop"),
                                                    Some(usage.to_openai_json()),
                                                ));
                                            }
                                        }
                                    } else {
                                        state.pending.push_back(encode_frame(
                                            &state.id,
                                            state.created,
                                            &state.model,
                                            json!({}),
                                            Some("stop"),
                                            Some(usage.to_openai_json()),
                                        ));
                                    }

                                    state
                                        .pending
                                        .push_back(Bytes::from_static(b"data: [DONE]\n\n"));
                                    state.finished = true;
                                }
                                WsFrame::Failed(reason) => {
                                    let failure = APIError::new(
                                        500,
                                        constants::providers::grok_web::response_failed(&reason),
                                    );
                                    state.pending.push_back(sse::error_event_bytes(&failure));
                                    state.finished = true;
                                }
                                WsFrame::Errored(message) => {
                                    state.pending.push_back(sse::error_event_bytes(
                                        &APIError::new(500, message),
                                    ));
                                    state.finished = true;
                                }
                                WsFrame::Ignored => {}
                            }
                        }
                        // Binary frames carry no text events on this transport.
                        _ => {}
                    }
                }
            },
        )))
    }
}

impl ProviderExecutor for GrokWebExecutor {
    fn as_any(&self) -> &dyn std::any::Any {
        self
    }

    fn id(&self) -> &str {
        GrokWebExecutor::id(self)
    }

    fn keys(&self) -> &'static [&'static str] {
        GrokWebExecutor::keys(self)
    }

    fn alias(&self) -> &str {
        GrokWebExecutor::alias(self)
    }

    fn models(&self) -> Vec<String> {
        GrokWebExecutor::models(self)
    }

    fn maybe_refresh(&self, force: bool) -> BoxFuture<'_, ()> {
        Box::pin(async move { GrokWebExecutor::maybe_refresh(self, force).await })
    }

    fn chat_completion<'a>(
        &'a self,
        model: &'a str,
        request: &'a ChatCompletionRequest,
    ) -> BoxFuture<'a, Result<Value, APIError>> {
        Box::pin(async move { GrokWebExecutor::chat_completion(self, model, request).await })
    }

    fn chat_completion_stream<'a>(
        &'a self,
        model: &'a str,
        request: &'a ChatCompletionRequest,
    ) -> BoxFuture<'a, Result<ProviderStream, APIError>> {
        Box::pin(async move { GrokWebExecutor::chat_completion_stream(self, model, request).await })
    }
}

/// Builds the adapter for the production endpoints.
pub fn adapter(database: Option<AppDatabase>) -> Result<ProviderAdapter, APIError> {
    adapter_with_endpoints(GrokWebEndpoints::default(), database)
}

/// Builds the adapter against explicit endpoints; tests point these at the
/// local fake.
pub fn adapter_with_endpoints(
    endpoints: GrokWebEndpoints,
    database: Option<AppDatabase>,
) -> Result<ProviderAdapter, APIError> {
    Ok(ProviderAdapter::new(GrokWebExecutor::new(
        endpoints, database,
    )?))
}
