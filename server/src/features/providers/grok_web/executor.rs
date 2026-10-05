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
//! transport decision is documented at its code site.

use std::collections::VecDeque;
use std::sync::{Arc, RwLock};
use std::time::Duration;

use axum::body::Bytes;
use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream, connect_async};

use super::types::{
    GROK_WEB_KEYS, GROK_WEB_MODELS, GROK_WEB_PROVIDER, GROK_WEB_USER_AGENT, GrokWebEndpoints,
    session_capabilities,
};
use crate::clock::now_ms;
use crate::constants;
use crate::error::APIError;
use crate::features::gateway::model::{
    ChatCompletionRequest, ChatContent, ChatMessage, ChatRole, ToolCall, ToolChoice, ToolChoiceMode,
};
use crate::features::gateway::sse;
use crate::features::gateway::usage::UsageBreakdown;
use crate::features::providers::adapter::{ProviderAdapter, ProviderStream};
use crate::features::providers::executor::{BoxFuture, ProviderExecutor};
use crate::infrastructure::database::AppDatabase;
use crate::infrastructure::database::providers::{GrokWebCredentials, load_grok_web_credentials};
use crate::infrastructure::upstream::STREAM_IDLE_TIMEOUT;

/// Upper bound for the whole establishment phase (page probe excluded): WebSocket
/// handshake plus `session.create`/`conversation.attached` round trip. The live
/// client attaches in milliseconds; 15s only guards a wedged upstream.
const DEFAULT_SESSION_TIMEOUT: Duration = Duration::from_secs(15);

/// The WS text channel the assistant response arrives on, captured from the
/// live client. Text on any other channel is treated as reasoning.
const ASSISTANT_CHANNEL: &str = "CHANNEL_ASSISTANT_RESPONSE";

/// The concrete WebSocket this executor speaks over: TLS from `wss://`, plain
/// TCP from the fake upstream's `ws://`.
type GrokSocket = WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>;

/// Grok Web chat executor over the grok.com WebSocket transport.
#[derive(Clone)]
pub struct GrokWebExecutor {
    id: &'static str,
    keys: &'static [&'static str],
    endpoints: GrokWebEndpoints,
    database: Option<AppDatabase>,
    /// Redirect-none client the `x-userid` page probe runs on.
    probe_client: reqwest::Client,
    /// Advertised model ids, filled once a connection exists. The list is
    /// static, so `maybe_refresh` only tracks connection presence — without a
    /// connection the provider advertises no model, mirroring Qoder/Cline.
    catalog: Arc<RwLock<Vec<String>>>,
    session_timeout: Duration,
    idle_timeout: Duration,
}

/// Client for the `x-userid` page probe: redirect policy `none` so an invalid
/// cookie's `307` to `accounts.x.ai` stays visible as a status instead of
/// being followed and masked by a foreign `200`.
pub fn probe_client() -> Result<reqwest::Client, APIError> {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .user_agent(GROK_WEB_USER_AGENT)
        .build()
        .map_err(|error| {
            APIError::new(
                500,
                constants::providers::grok_web::page_probe_transport_failed(&error),
            )
        })
}

/// GETs `page_url` with the `sso` cookie and returns the issued `x-userid`.
/// Shared by the executor and the connect route so both validate a cookie the
/// same way.
pub async fn probe_uid(
    client: &reqwest::Client,
    page_url: &str,
    sso: &str,
    timeout: Duration,
) -> Result<String, APIError> {
    let response = client
        .get(page_url)
        .header(reqwest::header::COOKIE, format!("sso={sso}"))
        .timeout(timeout)
        .send()
        .await
        .map_err(|error| {
            if error.is_timeout() {
                APIError::new(
                    500,
                    constants::providers::grok_web::page_probe_transport_failed("timed out"),
                )
            } else {
                APIError::new(
                    500,
                    constants::providers::grok_web::page_probe_transport_failed(&error),
                )
            }
        })?;

    let status = response.status();
    if status.is_redirection() || status.as_u16() == 401 {
        return Err(APIError::new(
            401,
            constants::providers::grok_web::COOKIE_INVALID,
        ));
    }
    if status.as_u16() == 429 {
        return Err(APIError::new(
            429,
            constants::providers::grok_web::page_probe_failed(429),
        ));
    }
    if !status.is_success() {
        return Err(APIError::new(
            500,
            constants::providers::grok_web::page_probe_failed(status.as_u16()),
        ));
    }

    response
        .headers()
        .get_all(reqwest::header::SET_COOKIE)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .find_map(|cookie| {
            cookie
                .strip_prefix("x-userid=")
                .map(|rest| rest.split(';').next().unwrap_or(rest).to_owned())
        })
        .filter(|uid| !uid.is_empty())
        .ok_or_else(|| APIError::new(401, constants::providers::grok_web::UID_NOT_ISSUED))
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
        })
    }

    /// Overrides the establishment and stream-idle timeouts. Tests use this to
    /// exercise the stall paths without waiting out the production values.
    pub fn with_timeouts(mut self, session: Duration, idle: Duration) -> Self {
        self.session_timeout = session;
        self.idle_timeout = idle;
        self
    }

    pub fn id(&self) -> &'static str {
        self.id
    }

    pub fn keys(&self) -> &'static [&'static str] {
        self.keys
    }

    pub fn alias(&self) -> &'static str {
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
        let connected = matches!(load_grok_web_credentials(database).await, Ok(Some(_)));
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

/// Establishment state: a connected socket that has completed
/// `response.create`, ready to yield frames.
struct Session {
    ws: GrokSocket,
}

/// Mutable state of the streaming translation.
struct TranslateState {
    ws: GrokSocket,
    id: String,
    created: i64,
    model: String,
    pending: VecDeque<Bytes>,
    finished: bool,
    idle_timeout: Duration,
    prompt_tokens: i64,
    completion_chars: usize,
    /// When set, assistant text is accumulated in `buffer` instead of streamed,
    /// so a completed turn can be re-read as a tool envelope or as text.
    tool_mode: bool,
    buffer: String,
}

impl GrokWebExecutor {
    /// Loads credentials, probes the page for `x-userid`, opens the WebSocket,
    /// runs `session.create`, waits for `conversation.attached`, and sends
    /// `response.create`. The whole span is bounded by `session_timeout`.
    async fn establish(&self, model_id: &str, prompt: &str) -> Result<Session, APIError> {
        let credentials = self.credentials().await?;
        let uid = self.fetch_uid(&credentials.sso).await?;

        tokio::time::timeout(self.session_timeout, async {
            let mut ws = self.connect_ws(&uid, &credentials.sso).await?;
            send_json(
                &mut ws,
                &json!({
                    "event": {
                        "type": "session.create",
                        "event_id": format!("evt_init_{}", uuid::Uuid::new_v4()),
                        "session": {
                            "model": model_id,
                            "x_grok": session_capabilities()
                        }
                    }
                }),
            )
            .await?;

            let session_id = wait_for_attach(&mut ws).await?;

            send_json(
                &mut ws,
                &json!({
                    "session_id": session_id,
                    "event": {
                        "type": "response.create",
                        "event_id": format!("evt_resp_{}", now_ms()),
                        "item": {
                            "type": "message",
                            "role": "user",
                            "x_grok": {
                                "client_message_id": uuid::Uuid::new_v4().to_string(),
                                "input_chunks": [{ "text": { "text": prompt } }]
                            }
                        }
                    }
                }),
            )
            .await?;

            Ok::<_, APIError>(Session { ws })
        })
        .await
        .map_err(|_| APIError::new(500, constants::providers::grok_web::SESSION_TIMEOUT))?
    }

    async fn credentials(&self) -> Result<GrokWebCredentials, APIError> {
        let database = self
            .database
            .as_ref()
            .ok_or_else(|| APIError::new(500, constants::providers::grok_web::DATABASE_REQUIRED))?;

        load_grok_web_credentials(database)
            .await?
            .ok_or_else(|| APIError::new(401, constants::providers::grok_web::NOT_CONNECTED))
    }

    /// Probes the page for the `x-userid` cookie the WebSocket query string
    /// requires. Redirects are not followed: a valid session answers `200`
    /// plus the cookie, an invalid one answers `307` to `accounts.x.ai`.
    async fn fetch_uid(&self, sso: &str) -> Result<String, APIError> {
        probe_uid(
            &self.probe_client,
            &self.endpoints.page_url,
            sso,
            self.session_timeout,
        )
        .await
    }

    async fn connect_ws(&self, uid: &str, sso: &str) -> Result<GrokSocket, APIError> {
        let url = format!("{}?uid={}", self.endpoints.ws_url, uid);
        let mut request = url.as_str().into_client_request().map_err(|error| {
            APIError::new(500, constants::providers::could_not_build_request(&error))
        })?;

        let cookie = format!("sso={sso}; sso-rw={sso}; x-userid={uid}");
        let headers = [
            ("Cookie", cookie),
            ("Origin", "https://grok.com".to_owned()),
            ("User-Agent", GROK_WEB_USER_AGENT.to_owned()),
        ];
        for (name, value) in headers {
            let value = HeaderValue::from_str(&value)
                .map_err(|_| APIError::new(401, constants::providers::grok_web::COOKIE_INVALID))?;
            request.headers_mut().insert(name, value);
        }

        let (ws, _) = connect_async(request).await.map_err(handshake_error)?;
        Ok(ws)
    }
}

/// Maps a failed WebSocket handshake onto the frozen error envelope. The
/// observed failure for a dead cookie is HTTP 401 on the upgrade.
fn handshake_error(error: tokio_tungstenite::tungstenite::Error) -> APIError {
    use tokio_tungstenite::tungstenite::Error;

    match error {
        Error::Http(response) => match response.status().as_u16() {
            401 | 403 => APIError::new(401, constants::providers::grok_web::COOKIE_INVALID),
            429 => APIError::new(429, constants::providers::grok_web::handshake_failed(429)),
            status => APIError::new(
                500,
                constants::providers::grok_web::handshake_failed(status),
            ),
        },
        other => APIError::new(
            500,
            constants::providers::grok_web::handshake_failed_message(&other),
        ),
    }
}

async fn send_json(ws: &mut GrokSocket, value: &Value) -> Result<(), APIError> {
    ws.send(Message::Text(value.to_string().into()))
        .await
        .map_err(|error| APIError::new(500, constants::providers::upstream_stream_failed(&error)))
}

/// Reads events until `conversation.attached` yields the session id. Ignoring
/// the interleaved `session.created`/queue events matches what the live client
/// tolerates.
async fn wait_for_attach(ws: &mut GrokSocket) -> Result<String, APIError> {
    loop {
        let message = ws
            .next()
            .await
            .ok_or_else(|| APIError::new(500, constants::providers::grok_web::STREAM_ENDED))?
            .map_err(|error| {
                APIError::new(500, constants::providers::upstream_stream_failed(&error))
            })?;

        let Message::Text(text) = message else {
            continue;
        };
        let Ok(value) = serde_json::from_str::<Value>(text.as_ref()) else {
            continue;
        };

        if let Some(session_id) = value.get("session_id").and_then(Value::as_str)
            && value["event"]["type"] == "conversation.attached"
        {
            return Ok(session_id.to_owned());
        }
        if let Some(message) = event_error_message(&value) {
            return Err(APIError::new(500, message));
        }
    }
}

/// The three outcomes of one upstream frame that matter to translation.
enum WsFrame {
    Text(String),
    Reasoning(String),
    Completed,
    Failed(String),
    Errored(String),
    Ignored,
}

fn classify_message(message: Message) -> Result<WsFrame, APIError> {
    match message {
        Message::Text(text) => {
            let raw = text.to_string();
            // A malformed frame is skipped rather than failing the request,
            // mirroring the reference NDJSON reader.
            match serde_json::from_str::<Value>(&raw) {
                Ok(value) => Ok(classify_value(&value)),
                Err(_) => Ok(WsFrame::Ignored),
            }
        }
        Message::Close(_) => Err(APIError::new(
            500,
            constants::providers::grok_web::STREAM_ENDED,
        )),
        _ => Ok(WsFrame::Ignored),
    }
}

fn classify_value(value: &Value) -> WsFrame {
    if let Some(message) = event_error_message(value) {
        return WsFrame::Errored(message);
    }

    let event = &value["event"];
    match event["type"].as_str() {
        Some("response.chunk") => {
            let Some(text) = event["chunk"]["text"].as_object() else {
                return WsFrame::Ignored;
            };
            let Some(body) = text.get("text").and_then(Value::as_str) else {
                return WsFrame::Ignored;
            };
            if body.is_empty() {
                return WsFrame::Ignored;
            }
            // Only the assistant channel carries the answer; text observed on
            // any other channel is routed to reasoning so response text is
            // never polluted by phase markers. The assistant channel is the
            // only one the live free-tier probes produced, so other channels
            // remain an assumption flagged in the implementation report.
            let reasoning = text
                .get("channel")
                .and_then(Value::as_str)
                .is_some_and(|channel| channel != ASSISTANT_CHANNEL);
            if reasoning {
                WsFrame::Reasoning(body.to_owned())
            } else {
                WsFrame::Text(body.to_owned())
            }
        }
        Some("response.done") => {
            let response = &event["response"];
            let status = response["status"].as_str().unwrap_or_default();
            if status == "completed" {
                return WsFrame::Completed;
            }
            let reason = response["status_details"]["reason"]
                .as_str()
                .unwrap_or(status)
                .to_owned();
            WsFrame::Failed(reason)
        }
        Some(event_type) if event_type.contains("error") => WsFrame::Errored(
            event["message"]
                .as_str()
                .unwrap_or("Grok Web reported an upstream error")
                .to_owned(),
        ),
        _ => WsFrame::Ignored,
    }
}

/// Extracts a user-facing message from the two error shapes the reference
/// reader handled: a top-level `error` object and an error event.
fn event_error_message(value: &Value) -> Option<String> {
    if let Some(error) = value.get("error") {
        if let Some(message) = error.get("message").and_then(Value::as_str) {
            return Some(message.to_owned());
        }
        if let Some(message) = error.as_str() {
            return Some(message.to_owned());
        }
    }
    None
}

fn encode_frame(
    id: &str,
    created: i64,
    model: &str,
    delta: Value,
    finish_reason: Option<&str>,
    usage: Option<Value>,
) -> Bytes {
    let mut frame = json!({
        "id": id,
        "object": "chat.completion.chunk",
        "created": created,
        "model": model,
        "choices": [{
            "index": 0,
            "delta": delta,
            "finish_reason": finish_reason
        }]
    });
    if let Some(usage) = usage {
        frame["usage"] = usage;
    }
    Bytes::from(format!("data: {frame}\n\n"))
}

fn chunk_id() -> String {
    let mut bytes = [0u8; 16];
    let _ = getrandom::fill(&mut bytes);
    format!("chatcmpl-{}", hex::encode(bytes))
}

/// One function call the model asked for, decoded from its emulated JSON reply.
struct ParsedToolCall {
    name: String,
    arguments: String,
}

/// Whether the request carries at least one function tool that may be used.
/// `tool_choice: "none"` turns the whole mechanism off.
fn tools_active(request: &ChatCompletionRequest) -> bool {
    !matches!(
        request.tool_choice,
        Some(ToolChoice::Mode(ToolChoiceMode::None))
    ) && request
        .tools
        .as_ref()
        .is_some_and(|tools| !tools.is_empty())
}

/// The system section that teaches the model the emulated tool contract, or
/// `None` when the request carries no usable tools.
///
/// The grok.com WebSocket carries text only — its native tools are
/// connector/MCP toolsets the account has registered, with no request field for
/// arbitrary functions — so tools are declared in the prompt and the model's
/// JSON reply is parsed back into OpenAI `tool_calls`.
fn tool_instruction(request: &ChatCompletionRequest) -> Option<String> {
    if !tools_active(request) {
        return None;
    }
    let tools = request.tools.as_ref()?;

    let mut section = String::from(
        "You can call functions to fetch data you do not already know. Available functions:",
    );
    for tool in tools {
        let function = &tool.function;
        section.push_str("\n- ");
        section.push_str(&function.name);
        if let Some(description) = function
            .description
            .as_deref()
            .filter(|text| !text.trim().is_empty())
        {
            section.push_str(": ");
            section.push_str(description.trim());
        }
        if let Some(parameters) = &function.parameters {
            section.push_str("\n  parameters (JSON Schema): ");
            section.push_str(&serde_json::to_string(parameters).unwrap_or_default());
        }
    }

    section.push_str("\n\n");
    section.push_str(&tool_directive(request));
    section.push_str(
        "\nWhen you call functions, reply with ONLY a JSON object (no prose, no markdown) in exactly this shape: \
         {\"tool_calls\":[{\"name\":\"<function name>\",\"arguments\":{<arguments>}}]}. \
         The caller runs each function and sends the results back; never invent a result.",
    );
    Some(section)
}

/// The `tool_choice`-dependent instruction sentence.
fn tool_directive(request: &ChatCompletionRequest) -> String {
    match &request.tool_choice {
        Some(ToolChoice::Mode(ToolChoiceMode::Required)) => {
            "You MUST call at least one function now.".to_owned()
        }
        Some(ToolChoice::Named(named)) => {
            format!("You MUST call the function `{}` now.", named.function.name)
        }
        _ => "Call a function when it is needed; otherwise answer normally.".to_owned(),
    }
}

/// The full prompt: the flattened conversation, prefixed with the tool contract
/// when the request carries tools.
fn build_prompt(request: &ChatCompletionRequest) -> Result<String, APIError> {
    let base = flatten_messages(&request.messages)?;
    Ok(match tool_instruction(request) {
        Some(section) => format!("{section}\n\n{base}"),
        None => base,
    })
}

/// Rough token estimate (chars / 4) used because the upstream reports no usage.
fn estimate_tokens(text: &str) -> i64 {
    (text.chars().count() / 4).max(1) as i64
}

/// Decodes an emulated tool-call envelope from the assistant text. Accepts the
/// JSON alone, inside a ```json fence, or as the first balanced object in prose.
/// Anything without a non-empty, well-formed `tool_calls` array yields `None`.
fn parse_tool_calls(content: &str) -> Option<Vec<ParsedToolCall>> {
    let candidate = extract_first_object(content)?;
    let value: Value = serde_json::from_str(candidate).ok()?;
    let calls = value.get("tool_calls")?.as_array()?;
    if calls.is_empty() {
        return None;
    }

    let mut parsed = Vec::with_capacity(calls.len());
    for call in calls {
        let name = call.get("name").and_then(Value::as_str)?.trim();
        if name.is_empty() {
            return None;
        }
        let arguments = match call.get("arguments") {
            Some(Value::String(text)) => text.clone(),
            Some(value) => serde_json::to_string(value).ok()?,
            None => "{}".to_owned(),
        };
        parsed.push(ParsedToolCall {
            name: name.to_owned(),
            arguments,
        });
    }
    Some(parsed)
}

/// Returns the first balanced `{...}` object in `text`, ignoring braces inside
/// string literals. `None` when the text has no complete object.
fn extract_first_object(text: &str) -> Option<&str> {
    let start = text.find('{')?;
    let mut depth = 0usize;
    let mut in_string = false;
    let mut escaped = false;

    for (offset, byte) in text.as_bytes()[start..].iter().enumerate() {
        let index = start + offset;
        if in_string {
            if escaped {
                escaped = false;
            } else if *byte == b'\\' {
                escaped = true;
            } else if *byte == b'"' {
                in_string = false;
            }
            continue;
        }
        match *byte {
            b'"' => in_string = true,
            b'{' => depth += 1,
            b'}' => {
                depth -= 1;
                if depth == 0 {
                    return Some(&text[start..=index]);
                }
            }
            _ => {}
        }
    }
    None
}

fn tool_call_id() -> String {
    let mut bytes = [0u8; 12];
    let _ = getrandom::fill(&mut bytes);
    format!("call_{}", hex::encode(bytes))
}

/// The OpenAI `tool_calls` delta for a streaming frame.
fn tool_calls_delta(calls: &[ParsedToolCall]) -> Value {
    let entries: Vec<Value> = calls
        .iter()
        .enumerate()
        .map(|(index, call)| {
            json!({
                "index": index,
                "id": tool_call_id(),
                "type": "function",
                "function": { "name": call.name, "arguments": call.arguments }
            })
        })
        .collect();
    json!({ "tool_calls": entries })
}

/// A non-streaming completion whose only choice is a set of tool calls.
fn tool_call_response(
    model: &str,
    calls: &[ParsedToolCall],
    prompt_tokens: i64,
    reasoning: &str,
) -> Value {
    let tool_calls: Vec<Value> = calls
        .iter()
        .map(|call| {
            json!({
                "id": tool_call_id(),
                "type": "function",
                "function": { "name": call.name, "arguments": call.arguments }
            })
        })
        .collect();
    let call_chars: usize = calls
        .iter()
        .map(|call| call.name.chars().count() + call.arguments.chars().count())
        .sum();
    let completion_tokens = (call_chars / 4).max(1) as i64;
    let usage = UsageBreakdown {
        prompt_tokens,
        completion_tokens,
        total_tokens: prompt_tokens + completion_tokens,
        ..Default::default()
    };

    let mut message = json!({
        "role": "assistant",
        "content": Value::Null,
        "tool_calls": tool_calls
    });
    if !reasoning.is_empty() {
        message["reasoning_content"] = Value::String(reasoning.to_owned());
    }

    json!({
        "id": chunk_id(),
        "object": "chat.completion",
        "created": now_ms() / 1000,
        "model": model,
        "choices": [{ "index": 0, "message": message, "finish_reason": "tool_calls" }],
        "usage": usage.to_openai_json()
    })
}

/// Renders prior assistant tool calls back into the emulated envelope so a
/// follow-up turn shows the model the call it made before the results arrived.
fn render_calls_envelope(calls: &[ToolCall]) -> String {
    let rendered: Vec<Value> = calls
        .iter()
        .map(|call| {
            let arguments = serde_json::from_str::<Value>(&call.function.arguments)
                .unwrap_or_else(|_| Value::String(call.function.arguments.clone()));
            json!({ "name": call.function.name, "arguments": arguments })
        })
        .collect();
    json!({ "tool_calls": rendered }).to_string()
}

/// Collapses the OpenAI message list into the single text prompt the WebSocket
/// protocol accepts: every turn except the last user message is prefixed with
/// its role, mirroring the reference `parseOpenAIMessages`. Empty turns are
/// dropped; a prompt that ends up empty is a `400`.
fn flatten_messages(messages: &[ChatMessage]) -> Result<String, APIError> {
    // A `role: "tool"` turn answers a call by id; the id→name map lets the
    // flattened turn carry the function name the model recognises.
    let names: std::collections::HashMap<&str, &str> = messages
        .iter()
        .filter_map(|message| message.tool_calls.as_deref())
        .flatten()
        .map(|call| (call.id.as_str(), call.function.name.as_str()))
        .collect();

    let mut turns: Vec<(&str, String)> = Vec::new();

    for message in messages {
        let role = match message.role {
            ChatRole::System | ChatRole::Developer => "system",
            ChatRole::User => "user",
            ChatRole::Assistant => "assistant",
            ChatRole::Tool => "tool",
            ChatRole::Function => "function",
        };

        let mut text = content_text(&message.content)?;

        if role == "assistant" {
            if let Some(calls) = message
                .tool_calls
                .as_deref()
                .filter(|calls| !calls.is_empty())
            {
                let envelope = render_calls_envelope(calls);
                text = if text.trim().is_empty() {
                    envelope
                } else {
                    format!("{text}\n{envelope}")
                };
            }
        } else if role == "tool" && !text.trim().is_empty() {
            let label = message
                .tool_call_id
                .as_deref()
                .and_then(|id| names.get(id).copied())
                .unwrap_or("result");
            text = format!("tool result ({label}): {text}");
        }

        if !text.trim().is_empty() {
            turns.push((role, text));
        }
    }

    let last_user = turns
        .iter()
        .rposition(|(role, _)| *role == "user")
        .unwrap_or(usize::MAX);

    let rendered: Vec<String> = turns
        .iter()
        .enumerate()
        .map(|(index, (role, text))| {
            if index == last_user {
                text.clone()
            } else {
                format!("{role}: {text}")
            }
        })
        .collect();
    let prompt = rendered.join("\n\n");

    if prompt.trim().is_empty() {
        return Err(APIError::new(
            400,
            constants::providers::grok_web::EMPTY_QUERY,
        ));
    }
    Ok(prompt)
}

/// Extracts a message's text, rejecting image parts (the transport is
/// text-only; dropping one silently would let the model answer a prompt it
/// never saw).
fn content_text(content: &ChatContent) -> Result<String, APIError> {
    match content {
        ChatContent::Text(text) => Ok(text.clone()),
        ChatContent::Parts(parts) => {
            let mut text = String::new();
            for part in parts {
                if part.kind == crate::features::gateway::model::ContentPartType::ImageUrl {
                    return Err(APIError::new(
                        400,
                        constants::providers::grok_web::UNSUPPORTED_CONTENT,
                    ));
                }
                if let Some(part_text) = &part.text {
                    if !text.is_empty() {
                        text.push(' ');
                    }
                    text.push_str(part_text);
                }
            }
            Ok(text)
        }
        ChatContent::Null => Ok(String::new()),
    }
}

/// Validates a requested model against the advertised list. The registry's
/// prefix path resolves any `<provider>/<model>` without checking, and the
/// upstream accepts any `session.model` before failing at `response.done`, so
/// the client-side check is what turns a typo into a clean `404`.
fn resolve_model(model: &str) -> Result<String, APIError> {
    GROK_WEB_MODELS
        .iter()
        .find(|candidate| model.eq_ignore_ascii_case(candidate.id))
        .map(|candidate| candidate.id.to_owned())
        .ok_or_else(|| APIError::new(404, constants::gateway::model_not_registered(model)))
}

impl ProviderExecutor for GrokWebExecutor {
    fn as_any(&self) -> &dyn std::any::Any {
        self
    }

    fn id(&self) -> &'static str {
        GrokWebExecutor::id(self)
    }

    fn keys(&self) -> &'static [&'static str] {
        GrokWebExecutor::keys(self)
    }

    fn alias(&self) -> &'static str {
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

#[cfg(test)]
mod tests {
    use super::*;

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
    fn single_user_message_is_sent_bare() {
        let prompt = flatten_messages(&[message(
            ChatRole::User,
            ChatContent::Text("Hello".to_owned()),
        )])
        .expect("prompt");
        assert_eq!(prompt, "Hello");
    }

    #[test]
    fn system_and_history_turns_are_role_prefixed_except_the_last_user() {
        let prompt = flatten_messages(&[
            message(ChatRole::System, ChatContent::Text("Be brief".to_owned())),
            message(ChatRole::User, ChatContent::Text("First".to_owned())),
            message(ChatRole::Assistant, ChatContent::Text("Sure".to_owned())),
            message(ChatRole::User, ChatContent::Text("Second".to_owned())),
        ])
        .expect("prompt");
        assert_eq!(
            prompt,
            "system: Be brief\n\nuser: First\n\nassistant: Sure\n\nSecond"
        );
    }

    #[test]
    fn developer_role_flattens_as_system() {
        let prompt = flatten_messages(&[
            message(ChatRole::Developer, ChatContent::Text("Rules".to_owned())),
            message(ChatRole::User, ChatContent::Text("Hi".to_owned())),
        ])
        .expect("prompt");
        assert_eq!(prompt, "system: Rules\n\nHi");
    }

    #[test]
    fn empty_and_null_turns_are_dropped() {
        let prompt = flatten_messages(&[
            message(ChatRole::User, ChatContent::Text("   ".to_owned())),
            message(ChatRole::Assistant, ChatContent::Null),
            message(ChatRole::User, ChatContent::Text("Real".to_owned())),
        ])
        .expect("prompt");
        assert_eq!(prompt, "Real");
    }

    #[test]
    fn only_empty_content_is_a_400() {
        let error = flatten_messages(&[message(ChatRole::User, ChatContent::Text("".to_owned()))])
            .expect_err("empty prompt is rejected");
        assert_eq!(error.status(), 400);
    }

    #[test]
    fn image_parts_are_rejected_not_silently_dropped() {
        use crate::features::gateway::model::{ContentPart, ContentPartType, ImageUrl};

        let error = flatten_messages(&[message(
            ChatRole::User,
            ChatContent::Parts(vec![
                ContentPart {
                    kind: ContentPartType::Text,
                    text: Some("look".to_owned()),
                    image_url: None,
                    cache_control: None,
                },
                ContentPart {
                    kind: ContentPartType::ImageUrl,
                    text: None,
                    image_url: Some(ImageUrl {
                        url: "data:image/png;base64,AAAA".to_owned(),
                        detail: None,
                    }),
                    cache_control: None,
                },
            ]),
        )])
        .expect_err("images are unsupported");
        assert_eq!(error.status(), 400);
    }

    #[test]
    fn unknown_models_are_404_and_advertised_ids_resolve() {
        assert_eq!(resolve_model("fast").expect("fast"), "fast");
        assert_eq!(resolve_model("HEAVY").expect("heavy"), "heavy");
        let error = resolve_model("grok-9").expect_err("unknown");
        assert_eq!(error.status(), 404);
    }

    #[test]
    fn response_chunks_translate_by_channel() {
        let chunk = |channel: &str, text: &str| {
            serde_json::json!({
                "event": {
                    "type": "response.chunk",
                    "chunk": { "text": { "text": text, "channel": channel } }
                }
            })
        };
        assert!(matches!(
            classify_value(&chunk(ASSISTANT_CHANNEL, "zeta")),
            WsFrame::Text(text) if text == "zeta"
        ));
        assert!(matches!(
            classify_value(&chunk("CHANNEL_SOMETHING_ELSE", "think")),
            WsFrame::Reasoning(text) if text == "think"
        ));
        // Metadata-only and follow-up chunks carry no text and are ignored.
        assert!(matches!(
            classify_value(&serde_json::json!({
                "event": { "type": "response.chunk", "chunk": { "metadata": {} } }
            })),
            WsFrame::Ignored
        ));
    }

    #[test]
    fn done_frames_carry_status_and_reason() {
        let done = |status: &str, reason: Option<&str>| {
            let mut response = serde_json::json!({ "status": status });
            if let Some(reason) = reason {
                response["status_details"] = serde_json::json!({ "reason": reason });
            }
            serde_json::json!({ "event": { "type": "response.done", "response": response } })
        };
        assert!(matches!(
            classify_value(&done("completed", None)),
            WsFrame::Completed
        ));
        assert!(matches!(
            classify_value(&done("incomplete", Some("stream_error"))),
            WsFrame::Failed(reason) if reason == "stream_error"
        ));
    }

    #[test]
    fn error_shapes_surface_a_message() {
        let top_level = serde_json::json!({ "error": { "message": "boom" } });
        assert!(matches!(
            classify_value(&top_level),
            WsFrame::Errored(message) if message == "boom"
        ));
        let error_event = serde_json::json!({
            "event": { "type": "response.error", "message": "nope" }
        });
        assert!(matches!(
            classify_value(&error_event),
            WsFrame::Errored(message) if message == "nope"
        ));
    }

    #[test]
    fn framing_matches_the_openai_chunk_shape() {
        let frame = encode_frame(
            "chatcmpl-abc",
            1_700_000_000,
            "fast",
            serde_json::json!({ "content": "hi" }),
            None,
            None,
        );
        let text = String::from_utf8(frame.to_vec()).expect("utf8");
        assert!(text.starts_with("data: {"));
        assert!(text.ends_with("\n\n"));
        let value: Value = serde_json::from_str(text.trim_start_matches("data: ").trim_end())
            .expect("frame parses");
        assert_eq!(value["object"], "chat.completion.chunk");
        assert_eq!(value["model"], "fast");
        assert_eq!(value["choices"][0]["delta"]["content"], "hi");
    }

    fn request_with_tools(value: Value) -> ChatCompletionRequest {
        serde_json::from_value(value).expect("request parses")
    }

    #[test]
    fn parse_tool_calls_accepts_bare_fenced_and_embedded_envelopes() {
        let bare = r#"{"tool_calls":[{"name":"get_weather","arguments":{"city":"Jakarta"}}]}"#;

        let parsed = parse_tool_calls(bare).expect("bare parses");
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].name, "get_weather");
        assert_eq!(parsed[0].arguments, r#"{"city":"Jakarta"}"#);

        let fenced = format!("```json\n{bare}\n```");
        assert_eq!(parse_tool_calls(&fenced).expect("fenced parses").len(), 1);

        let embedded = format!("Sure.\n{bare}\nDone.");
        assert_eq!(
            parse_tool_calls(&embedded).expect("embedded parses")[0].name,
            "get_weather"
        );

        let string_arguments = r#"{"tool_calls":[{"name":"lookup","arguments":"{\"q\":\"x\"}"}]}"#;
        assert_eq!(
            parse_tool_calls(string_arguments).expect("string args")[0].arguments,
            r#"{"q":"x"}"#
        );
    }

    #[test]
    fn parse_tool_calls_rejects_prose_malformed_and_empty_lists() {
        assert!(parse_tool_calls("The weather is fine.").is_none());
        assert!(parse_tool_calls(r#"{"tool_calls":[]}"#).is_none());
        assert!(parse_tool_calls(r#"{"tool_calls":[{"arguments":{}}]}"#).is_none());
        assert!(parse_tool_calls(r#"{"tool_calls":[{"name":"   "}]}"#).is_none());
        assert!(parse_tool_calls("{not json}").is_none());
    }

    #[test]
    fn extract_first_object_ignores_braces_inside_strings() {
        assert_eq!(
            extract_first_object(r#"prefix {"a":"}"} suffix"#),
            Some(r#"{"a":"}"}"#)
        );
        assert!(extract_first_object("no object here").is_none());
    }

    #[test]
    fn tool_instruction_lists_the_tools_and_honours_tool_choice() {
        let auto = request_with_tools(serde_json::json!({
            "model": "grok-web/fast",
            "messages": [{ "role": "user", "content": "hi" }],
            "tools": [{ "type": "function", "function": {
                "name": "get_weather", "description": "Weather", "parameters": { "type": "object" }
            }}],
            "tool_choice": "auto"
        }));
        let section = tool_instruction(&auto).expect("section");
        assert!(section.contains("get_weather"));
        assert!(section.contains("Call a function when it is needed"));
        assert!(section.contains("tool_calls"));

        let required = request_with_tools(serde_json::json!({
            "model": "grok-web/fast",
            "messages": [{ "role": "user", "content": "hi" }],
            "tools": [{ "type": "function", "function": { "name": "get_weather" } }],
            "tool_choice": "required"
        }));
        assert!(
            tool_instruction(&required)
                .expect("section")
                .contains("MUST call at least one")
        );

        let named = request_with_tools(serde_json::json!({
            "model": "grok-web/fast",
            "messages": [{ "role": "user", "content": "hi" }],
            "tools": [{ "type": "function", "function": { "name": "get_weather" } }],
            "tool_choice": { "type": "function", "function": { "name": "get_weather" } }
        }));
        assert!(
            tool_instruction(&named)
                .expect("section")
                .contains("`get_weather`")
        );

        let none = request_with_tools(serde_json::json!({
            "model": "grok-web/fast",
            "messages": [{ "role": "user", "content": "hi" }],
            "tools": [{ "type": "function", "function": { "name": "get_weather" } }],
            "tool_choice": "none"
        }));
        assert!(tool_instruction(&none).is_none());
        assert!(!tools_active(&none));

        let without_tools = request_with_tools(serde_json::json!({
            "model": "grok-web/fast",
            "messages": [{ "role": "user", "content": "hi" }]
        }));
        assert!(!tools_active(&without_tools));
        assert!(tool_instruction(&without_tools).is_none());
    }

    #[test]
    fn assistant_tool_calls_and_results_flatten_back_into_the_prompt() {
        use crate::features::gateway::model::{ToolCallFunction, ToolCallKind};

        let messages = vec![
            message(
                ChatRole::User,
                ChatContent::Text("Weather in Jakarta?".to_owned()),
            ),
            ChatMessage {
                role: ChatRole::Assistant,
                content: ChatContent::Null,
                name: None,
                tool_calls: Some(vec![ToolCall {
                    id: "call-1".to_owned(),
                    kind: ToolCallKind::Function,
                    function: ToolCallFunction {
                        name: "get_weather".to_owned(),
                        arguments: r#"{"city":"Jakarta"}"#.to_owned(),
                    },
                }]),
                tool_call_id: None,
                cache_control: None,
            },
            ChatMessage {
                role: ChatRole::Tool,
                content: ChatContent::Text(r#"{"temp_c":32}"#.to_owned()),
                name: None,
                tool_calls: None,
                tool_call_id: Some("call-1".to_owned()),
                cache_control: None,
            },
            message(ChatRole::User, ChatContent::Text("And Bandung?".to_owned())),
        ];

        let prompt = flatten_messages(&messages).expect("prompt");
        assert!(prompt.contains("assistant: {"));
        assert!(prompt.contains("\"tool_calls\""));
        assert!(prompt.contains("get_weather"));
        assert!(prompt.contains(r#"{"city":"Jakarta"}"#));
        assert!(prompt.contains(r#"tool result (get_weather): {"temp_c":32}"#));
        assert!(prompt.ends_with("And Bandung?"));
    }
}
