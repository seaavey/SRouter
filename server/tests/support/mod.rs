//! Shared helpers for integration tests. Every helper here uses isolated
//! storage or a local fake upstream and must never reach a real provider or
//! `~/.srouter/srouter.db`.

#![allow(dead_code)]

use std::collections::{HashMap, HashSet};
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex as StdMutex};

use axum::{
    Json, Router,
    body::{Body, Bytes},
    extract::{ConnectInfo, State},
    http::{HeaderMap, Request, StatusCode, header},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use futures_util::future::BoxFuture;
use srouter_server::features::admin_auth::AdminSessionStore;
use srouter_server::features::api_keys::{APIKeyRecord, APIKeyStore};
use srouter_server::features::providers::cline::{self, ClineEndpoints};
use srouter_server::features::providers::grok_web::{self, GrokWebEndpoints};
use srouter_server::features::providers::qoder::{self, QoderEndpoints};
use srouter_server::features::providers::{ProviderRegistry, opencode};
use srouter_server::infrastructure::database::AppDatabase;
use srouter_server::infrastructure::database::admin_auth::SQLxAdminAuthStore;
use srouter_server::infrastructure::database::api_keys::SQLxAPIKeyStore;
use srouter_server::infrastructure::database::providers::{
    ClineConnectionWrite, GrokWebConnectionWrite, QoderConnectionWrite, upsert_cline_connection,
    upsert_grok_web_connection, upsert_qoder_connection,
};
use srouter_server::{APIConfig, APIError, AppState, SecurityState};
use tokio::net::TcpListener;
use tokio::task::JoinHandle;
use tokio_tungstenite::tungstenite::Message as WsMessage;

static SEQUENCE: AtomicU64 = AtomicU64::new(0);

/// A unique temporary SQLite database removed when the value is dropped.
pub struct TestDatabase {
    directory: PathBuf,
    path: PathBuf,
}

impl TestDatabase {
    /// Creates a unique temporary directory holding an empty database path.
    pub fn new() -> std::io::Result<Self> {
        let directory = unique_temp_directory()?;

        Ok(Self {
            path: directory.join("srouter.db"),
            directory,
        })
    }

    /// The temporary SQLite file path.
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Configuration pointing at this temporary database. `DATABASE_URL` is
    /// intentionally absent so the SQLite backend is always selected.
    pub fn config(&self) -> Result<APIConfig, srouter_server::ConfigError> {
        let environment = HashMap::from([
            ("HOME".to_owned(), self.directory.display().to_string()),
            ("DATABASE_PATH".to_owned(), self.path.display().to_string()),
        ]);

        APIConfig::from_env_map(&environment)
    }

    /// Connects the application database layer to this temporary file.
    pub async fn connect(&self) -> Result<AppDatabase, APIError> {
        let config = self.config().expect("temporary database configuration");
        AppDatabase::connect(&config).await
    }
}

impl Drop for TestDatabase {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.directory);
    }
}

/// A local stand-in for an OpenAI-compatible upstream, served on a random
/// loopback port and aborted when dropped.
pub struct FakeUpstream {
    base_url: String,
    task: JoinHandle<()>,
}

impl FakeUpstream {
    pub async fn start() -> Self {
        let router = Router::new().route("/v1/chat/completions", post(fake_chat_completion));
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind the fake upstream");
        let address = listener.local_addr().expect("fake upstream address");

        let task = tokio::spawn(async move {
            let _ = axum::serve(listener, router).await;
        });

        Self {
            base_url: format!("http://{address}/v1"),
            task,
        }
    }

    /// The base URL to register on a provider adapter.
    pub fn base_url(&self) -> &str {
        &self.base_url
    }
}

impl Drop for FakeUpstream {
    fn drop(&mut self) {
        self.task.abort();
    }
}

/// Application state whose `opencode_zen` provider points at a local fake
/// upstream, so gateway tests never reach the network.
pub async fn app_state_with_fake_upstream() -> (FakeUpstream, AppState) {
    app_state_with_fake_upstream_and_security(SecurityState::unconfigured()).await
}

/// Same fake-upstream state with explicit security stores.
pub async fn app_state_with_fake_upstream_and_security(
    security: SecurityState,
) -> (FakeUpstream, AppState) {
    let upstream = FakeUpstream::start().await;
    let mut providers = ProviderRegistry::new();
    providers.register(
        opencode::adapter_with_base_url(upstream.base_url()).expect("opencode_zen adapter"),
    );

    (
        upstream,
        AppState::with_security(test_config(), providers, security),
    )
}

/// What the fake Qoder upstream remembers about the calls it served.
#[derive(Debug)]
pub struct FakeQoderState {
    /// Whether the device flow answers with a token instead of "still waiting".
    pub approve_device: bool,
    /// Whether the chat stream is written in many small pieces, so the
    /// translation has to reassemble a frame split across reads.
    pub fragment_chat: bool,
    /// Whether `model/list` answers slowly, to widen the window in which
    /// concurrent catalog fetchers would otherwise each start their own GET.
    pub slow_model_list: bool,
    pub chat_requests: usize,
    pub model_list_requests: usize,
    pub poll_requests: usize,
    pub last_encoded_body: String,
    pub last_model_key: String,
    pub last_sig_path: String,
    pub last_model_list_body_length: String,
    pub last_model_list_sig_path: String,
    pub model_catalog: serde_json::Value,
}

impl Default for FakeQoderState {
    fn default() -> Self {
        Self {
            approve_device: false,
            fragment_chat: false,
            slow_model_list: false,
            chat_requests: 0,
            model_list_requests: 0,
            poll_requests: 0,
            last_encoded_body: String::new(),
            last_model_key: String::new(),
            last_sig_path: String::new(),
            last_model_list_body_length: String::new(),
            last_model_list_sig_path: String::new(),
            model_catalog: serde_json::json!({ "chat": [] }),
        }
    }
}

type SharedQoderState = Arc<StdMutex<FakeQoderState>>;

/// A local stand-in for the Qoder gateway and its device-flow endpoints, served
/// on a random loopback port and aborted when dropped.
pub struct FakeQoderUpstream {
    base_url: String,
    state: SharedQoderState,
    task: JoinHandle<()>,
}

impl FakeQoderUpstream {
    pub async fn start() -> Self {
        let state: SharedQoderState = Arc::new(StdMutex::new(FakeQoderState::default()));
        let router = Router::new()
            .route(
                "/algo/api/v2/service/pro/sse/agent_chat_generation",
                post(qoder_chat),
            )
            .route("/algo/api/v2/model/list", get(qoder_model_list))
            .route("/api/v1/deviceToken/poll", get(qoder_device_poll))
            .route("/api/v1/userinfo", get(qoder_userinfo))
            .with_state(state.clone());
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind the fake qoder upstream");
        let address = listener.local_addr().expect("fake qoder upstream address");

        let task = tokio::spawn(async move {
            let _ = axum::serve(listener, router).await;
        });

        Self {
            base_url: format!("http://{address}"),
            state,
            task,
        }
    }

    /// The gateway root the provider adapter should be built against.
    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    /// Endpoints pointing every Qoder URL at this fake.
    pub fn endpoints(&self) -> QoderEndpoints {
        QoderEndpoints {
            base_url: self.base_url.clone(),
            login_url: "https://qoder.com/device/selectAccounts".to_owned(),
            device_token_url: format!("{}/api/v1/deviceToken/poll", self.base_url),
            userinfo_url: format!("{}/api/v1/userinfo", self.base_url),
        }
    }

    /// Runs an edit against the recorded state.
    pub fn with<F, R>(&self, edit: F) -> R
    where
        F: FnOnce(&mut FakeQoderState) -> R,
    {
        let mut state = self.state.lock().expect("fake qoder state");

        edit(&mut state)
    }

    /// Recorded chat requests.
    pub fn chat_requests(&self) -> usize {
        self.with(|state| state.chat_requests)
    }

    /// Recorded model-list requests.
    pub fn model_list_requests(&self) -> usize {
        self.with(|state| state.model_list_requests)
    }

    /// The encoded body of the most recent chat request.
    pub fn last_encoded_body(&self) -> String {
        self.with(|state| state.last_encoded_body.clone())
    }

    /// The `X-Model-Key` header of the most recent chat request.
    pub fn last_model_key(&self) -> String {
        self.with(|state| state.last_model_key.clone())
    }

    /// The `Cosy-Sigpath` header of the most recent chat request.
    pub fn last_sig_path(&self) -> String {
        self.with(|state| state.last_sig_path.clone())
    }

    /// The `Cosy-Bodylength` header of the most recent model-list request.
    pub fn model_list_body_length(&self) -> String {
        self.with(|state| state.last_model_list_body_length.clone())
    }

    /// The `Cosy-Sigpath` header of the most recent model-list request.
    pub fn model_list_sig_path(&self) -> String {
        self.with(|state| state.last_model_list_sig_path.clone())
    }
}

impl Drop for FakeQoderUpstream {
    fn drop(&mut self) {
        self.task.abort();
    }
}

/// State recorded by the Cline and WorkOS fake endpoints.
#[derive(Debug)]
pub struct FakeClineState {
    pub authenticate_mode: String,
    pub device_failure: bool,
    pub register_failure: bool,
    pub refresh_failure: bool,
    pub chat_mode: String,
    pub model_list_failure: bool,
    pub device_requests: usize,
    pub authenticate_requests: usize,
    pub register_requests: usize,
    pub refresh_requests: usize,
    pub chat_requests: usize,
    pub model_list_requests: usize,
    pub recommended_requests: usize,
    pub last_authorization: String,
    pub last_client_type: String,
    pub last_chat_body: serde_json::Value,
    pub last_device_form: String,
    pub last_authenticate_form: String,
    pub last_refresh_token: String,
    pub model_catalog: serde_json::Value,
    pub register_user_id: String,
    pub register_email: String,
    pub register_name: String,
    pub device_base_url: String,
}

impl Default for FakeClineState {
    fn default() -> Self {
        Self {
            authenticate_mode: "pending".to_owned(),
            device_failure: false,
            register_failure: false,
            refresh_failure: false,
            chat_mode: "default".to_owned(),
            model_list_failure: false,
            device_requests: 0,
            authenticate_requests: 0,
            register_requests: 0,
            refresh_requests: 0,
            chat_requests: 0,
            model_list_requests: 0,
            recommended_requests: 0,
            last_authorization: String::new(),
            last_client_type: String::new(),
            last_chat_body: serde_json::Value::Null,
            last_device_form: String::new(),
            last_authenticate_form: String::new(),
            last_refresh_token: String::new(),
            model_catalog: serde_json::json!({
                "object": "list",
                "data": [
                    { "id": "anthropic/claude-sonnet-5.5" },
                    { "id": "openai/gpt-5.2" }
                ]
            }),
            register_user_id: "user-1".to_owned(),
            register_email: "dev@example.com".to_owned(),
            register_name: "Dev".to_owned(),
            device_base_url: String::new(),
        }
    }
}

type SharedClineState = Arc<StdMutex<FakeClineState>>;

/// A local Cline API and WorkOS device-flow stand-in, aborted when dropped.
pub struct FakeClineUpstream {
    base_url: String,
    state: SharedClineState,
    task: JoinHandle<()>,
}

impl FakeClineUpstream {
    pub async fn start() -> Self {
        let state: SharedClineState = Arc::new(StdMutex::new(FakeClineState::default()));
        let router = Router::new()
            .route("/user_management/authorize/device", post(cline_device))
            .route("/user_management/authenticate", post(cline_authenticate))
            .route("/api/v1/auth/register", post(cline_register))
            .route("/api/v1/auth/refresh", post(cline_refresh))
            .route("/api/v1/chat/completions", post(cline_chat))
            .route("/api/v1/models", get(cline_models))
            .route(
                "/api/v1/ai/cline/recommended-models",
                get(cline_recommended_models),
            )
            .with_state(state.clone());
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind the fake Cline upstream");
        let address = listener.local_addr().expect("fake Cline upstream address");
        let base_url = format!("http://{address}");
        state.lock().expect("fake Cline state").device_base_url = base_url.clone();
        let task = tokio::spawn(async move {
            let _ = axum::serve(listener, router).await;
        });

        Self {
            base_url,
            state,
            task,
        }
    }

    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    pub fn endpoints(&self) -> ClineEndpoints {
        ClineEndpoints {
            workos_device_url: format!("{}/user_management/authorize/device", self.base_url),
            workos_authenticate_url: format!("{}/user_management/authenticate", self.base_url),
            api_base_url: format!("{}/api/v1", self.base_url),
        }
    }

    pub fn with<F, R>(&self, edit: F) -> R
    where
        F: FnOnce(&mut FakeClineState) -> R,
    {
        let mut state = self.state.lock().expect("fake Cline state");
        edit(&mut state)
    }

    pub fn chat_requests(&self) -> usize {
        self.with(|state| state.chat_requests)
    }

    pub fn model_list_requests(&self) -> usize {
        self.with(|state| state.model_list_requests)
    }
}

impl Drop for FakeClineUpstream {
    fn drop(&mut self) {
        self.task.abort();
    }
}

async fn cline_device(State(state): State<SharedClineState>, body: String) -> Response {
    let fail = {
        let mut state = state.lock().expect("fake Cline state");
        state.device_requests += 1;
        state.last_device_form = body;
        state.device_failure
    };
    if fail {
        return (StatusCode::INTERNAL_SERVER_ERROR, "device unavailable").into_response();
    }
    let base_url = state
        .lock()
        .expect("fake Cline state")
        .device_base_url
        .clone();
    Json(serde_json::json!({
        "device_code": "dev-1",
        "user_code": "ABCD-EFGH",
        "verification_uri": format!("{base_url}/device"),
        "verification_uri_complete": format!("{base_url}/device?user_code=ABCD-EFGH"),
        "expires_in": 300,
        "interval": 5
    }))
    .into_response()
}

async fn cline_authenticate(State(state): State<SharedClineState>, body: String) -> Response {
    let mode = {
        let mut state = state.lock().expect("fake Cline state");
        state.authenticate_requests += 1;
        state.last_authenticate_form = body;
        state.authenticate_mode.clone()
    };
    match mode.as_str() {
        "approved" => Json(serde_json::json!({
            "access_token": "workos-access",
            "refresh_token": "workos-refresh",
            "token_type": "Bearer"
        }))
        .into_response(),
        "denied" => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "error": "access_denied",
                "error_description": "access_denied"
            })),
        )
            .into_response(),
        _ => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "authorization_pending" })),
        )
            .into_response(),
    }
}

async fn cline_register(
    State(state): State<SharedClineState>,
    Json(_payload): Json<serde_json::Value>,
) -> Response {
    let (fail, user_id, email, name) = {
        let mut state = state.lock().expect("fake Cline state");
        state.register_requests += 1;
        (
            state.register_failure,
            state.register_user_id.clone(),
            state.register_email.clone(),
            state.register_name.clone(),
        )
    };
    if fail {
        return (StatusCode::INTERNAL_SERVER_ERROR, "register unavailable").into_response();
    }
    let mut envelope = cline_token_envelope();
    envelope["data"]["userInfo"]["clineUserId"] = serde_json::Value::String(user_id);
    envelope["data"]["userInfo"]["email"] = serde_json::Value::String(email);
    envelope["data"]["userInfo"]["name"] = serde_json::Value::String(name);
    Json(envelope).into_response()
}

async fn cline_refresh(
    State(state): State<SharedClineState>,
    Json(payload): Json<serde_json::Value>,
) -> Response {
    let refresh_token = payload
        .get("refreshToken")
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default()
        .to_owned();
    let fail = {
        let mut state = state.lock().expect("fake Cline state");
        state.refresh_requests += 1;
        state.last_refresh_token = refresh_token.clone();
        state.refresh_failure
    };
    // The real API rejects a refresh token carrying the header-only `workos:`
    // prefix, and a test row deliberately stores one.
    if refresh_token.starts_with("workos:") {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "data": "",
                "error": "failed to refresh token: invalid refresh token",
                "success": false
            })),
        )
            .into_response();
    }
    if fail {
        return (StatusCode::INTERNAL_SERVER_ERROR, "refresh unavailable").into_response();
    }
    Json(cline_token_envelope()).into_response()
}

fn cline_token_envelope() -> serde_json::Value {
    serde_json::json!({
        "success": true,
        "data": {
            "accessToken": "cline-access",
            "refreshToken": "cline-refresh",
            "tokenType": "Bearer",
            "expiresAt": "2026-12-31T00:00:00Z",
            "userInfo": {
                "clineUserId": "user-1",
                "email": "dev@example.com",
                "name": "Dev"
            }
        }
    })
}

async fn cline_models(State(state): State<SharedClineState>) -> Response {
    let (catalog, fail) = {
        let mut state = state.lock().expect("fake Cline state");
        state.model_list_requests += 1;
        (state.model_catalog.clone(), state.model_list_failure)
    };
    if fail {
        return (StatusCode::INTERNAL_SERVER_ERROR, "catalog unavailable").into_response();
    }
    Json(catalog).into_response()
}

async fn cline_recommended_models(State(state): State<SharedClineState>) -> Response {
    state.lock().expect("fake Cline state").recommended_requests += 1;
    Json(serde_json::json!({
        "free": [
            { "id": "cline-free/deepseek-v4.1-flash" },
            { "id": "cline-free/mimo-v2.6-flash" }
        ]
    }))
    .into_response()
}

async fn cline_chat(
    State(state): State<SharedClineState>,
    headers: HeaderMap,
    Json(payload): Json<serde_json::Value>,
) -> Response {
    let mode = {
        let mut state = state.lock().expect("fake Cline state");
        state.chat_requests += 1;
        state.last_authorization = header_text(&headers, "authorization");
        state.last_client_type = header_text(&headers, "x-client-type");
        state.last_chat_body = payload;
        state.chat_mode.clone()
    };

    let chunks = match mode.as_str() {
        "root_error" => vec![serde_json::json!({ "error": { "message": "boom" } })],
        "failure_envelope" => vec![serde_json::json!({
            "success": false,
            "error": "denied"
        })],
        "choice_error" => vec![serde_json::json!({
            "choices": [{
                "index": 0,
                "delta": {},
                "finish_reason": "error",
                "error": { "message": "boom" }
            }]
        })],
        "aggregate" => vec![
            serde_json::json!({
                "id": "chatcmpl-cline",
                "object": "chat.completion.chunk",
                "created": 1,
                "model": "anthropic/claude-sonnet-5.5",
                "choices": [{ "index": 0, "delta": { "reasoning": "think " } }]
            }),
            serde_json::json!({
                "id": "chatcmpl-cline",
                "object": "chat.completion.chunk",
                "created": 1,
                "model": "anthropic/claude-sonnet-5.5",
                "choices": [{
                    "index": 0,
                    "delta": { "content": "answer", "tool_calls": [{
                        "index": 0,
                        "id": "call-1",
                        "type": "function",
                        "function": { "name": "lookup", "arguments": "{\"q\":" }
                    }] }
                }]
            }),
            serde_json::json!({
                "id": "chatcmpl-cline",
                "object": "chat.completion.chunk",
                "created": 1,
                "model": "anthropic/claude-sonnet-5.5",
                "choices": [{ "index": 0, "delta": { "tool_calls": [{
                    "index": 0,
                    "function": { "arguments": "\"weather\"}" }
                }] } }],
                "usage": { "prompt_tokens": 8, "completion_tokens": 9, "total_tokens": 17, "cost": 0.25 }
            }),
            serde_json::json!({
                "choices": [{ "index": 0, "delta": {}, "finish_reason": "tool_calls" }]
            }),
        ],
        _ => vec![
            serde_json::json!({
                "id": "chatcmpl-cline",
                "object": "chat.completion.chunk",
                "created": 1,
                "model": "anthropic/claude-sonnet-5.5",
                "choices": [{ "index": 0, "delta": { "content": "Hello" } }]
            }),
            serde_json::json!({
                "id": "chatcmpl-cline",
                "object": "chat.completion.chunk",
                "created": 1,
                "model": "anthropic/claude-sonnet-5.5",
                "choices": [{ "index": 0, "delta": { "content": " world" } }]
            }),
            serde_json::json!({
                "id": "chatcmpl-cline",
                "object": "chat.completion.chunk",
                "created": 1,
                "model": "anthropic/claude-sonnet-5.5",
                "choices": [{ "index": 0, "delta": {}, "finish_reason": "stop" }],
                "usage": { "prompt_tokens": 5, "completion_tokens": 7, "total_tokens": 12 }
            }),
        ],
    };
    let mut sse = String::new();
    for chunk in chunks {
        sse.push_str("data: ");
        sse.push_str(&chunk.to_string());
        sse.push_str("\n\n");
    }
    sse.push_str("data: [DONE]\n\n");
    let body = if mode == "fragmented" {
        let pieces: Vec<Result<Bytes, std::io::Error>> = sse
            .as_bytes()
            .chunks(19)
            .map(|piece| Ok(Bytes::copy_from_slice(piece)))
            .collect();
        Body::from_stream(futures_util::stream::iter(pieces))
    } else {
        Body::from(sse)
    };
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "text/event-stream")
        .body(body)
        .expect("fake Cline stream")
}

/// Wraps one OpenAI chunk the way the real gateway sends it: an envelope whose
/// `body` is a stringified chunk.
fn qoder_envelope(chunk: &serde_json::Value) -> String {
    serde_json::json!({
        "headers": {},
        "body": chunk.to_string(),
        "statusCodeValue": 200
    })
    .to_string()
}

async fn qoder_chat(
    State(state): State<SharedQoderState>,
    headers: HeaderMap,
    body: String,
) -> Response {
    {
        let mut guard = state.lock().expect("fake qoder state");
        guard.chat_requests += 1;
        guard.last_encoded_body = body;
        guard.last_model_key = header_text(&headers, "x-model-key");
        guard.last_sig_path = header_text(&headers, "cosy-sigpath");
    }

    let chunks = [
        serde_json::json!({"choices": [{"index": 0, "delta": {"content": "Hello"}, "finish_reason": null}]}),
        serde_json::json!({"choices": [{"index": 0, "delta": {"content": " world"}, "finish_reason": null}]}),
        serde_json::json!({"choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}], "usage": {"prompt_tokens": 5, "completion_tokens": 7, "total_tokens": 12}}),
    ];
    let mut sse = String::new();
    for chunk in &chunks {
        sse.push_str("data: ");
        sse.push_str(&qoder_envelope(chunk));
        sse.push_str("\n\n");
    }
    sse.push_str("event: finish\n\n");

    let fragment = state.lock().expect("fake qoder state").fragment_chat;
    let body = if fragment {
        // One write per piece, so a frame really does span two reads.
        let pieces: Vec<Result<Bytes, std::io::Error>> = sse
            .as_bytes()
            .chunks(24)
            .map(|piece| Ok(Bytes::copy_from_slice(piece)))
            .collect();

        Body::from_stream(futures_util::stream::iter(pieces))
    } else {
        Body::from(sse)
    };

    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "text/event-stream")
        .body(body)
        .expect("fake qoder stream")
}

async fn qoder_model_list(State(state): State<SharedQoderState>, headers: HeaderMap) -> Response {
    let (catalog, slow) = {
        let mut guard = state.lock().expect("fake qoder state");
        guard.model_list_requests += 1;
        guard.last_model_list_body_length = header_text(&headers, "cosy-bodylength");
        guard.last_model_list_sig_path = header_text(&headers, "cosy-sigpath");

        (guard.model_catalog.clone(), guard.slow_model_list)
    };
    if slow {
        tokio::time::sleep(std::time::Duration::from_millis(150)).await;
    }

    Json(catalog).into_response()
}

async fn qoder_device_poll(State(state): State<SharedQoderState>) -> Response {
    let approved = {
        let mut guard = state.lock().expect("fake qoder state");
        guard.poll_requests += 1;
        guard.approve_device
    };

    if !approved {
        return StatusCode::ACCEPTED.into_response();
    }

    Json(serde_json::json!({
        "token": "dt-fixture-token",
        "refresh_token": "rt-fixture-token",
        "user_id": "user-fixture",
        "expires_in": 86_400
    }))
    .into_response()
}

async fn qoder_userinfo() -> Response {
    Json(serde_json::json!({
        "id": "user-fixture",
        "name": "Seaavey Dev",
        "email": "seaavey@example.com",
        "organization_id": "org-fixture"
    }))
    .into_response()
}

fn header_text(headers: &HeaderMap, name: &str) -> String {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_owned()
}

/// Keys the fake `model/list` serves, in the order the catalog sorts them. One
/// of them is an alias target, so the friendly-name path stays exercised.
pub const FAKE_QODER_KEYS: &[&str] = &["auto", "gfmodel", "qmodel", "qmodel_latest"];

/// Every id the fake catalog advertises, written by hand: the served keys plus
/// the display names that survive transcription. A test that counts rows against
/// this list cannot be satisfied by a catalog that invents or drops a name.
pub const FAKE_QODER_ADVERTISED: &[&str] = &[
    "auto",
    "gfmodel",
    "qmodel",
    "qmodel_latest",
    "qwen-plus",
    "qwen3.7-max",
];

/// A `model/list` body whose settings differ from the executor's defaults, so a
/// test can tell the upstream row from a fallback. The display names cover each
/// transcription rule: one equal to its key, one usable, one that differs from
/// the static alias table, and one carrying a character no model id may hold.
pub fn qoder_catalog_body() -> serde_json::Value {
    serde_json::json!({
        "chat": [
            {"key": "auto", "enable": true, "display_name": "Auto",
             "is_reasoning": false, "max_output_tokens": 8192},
            {"key": "qmodel_latest", "enable": true, "display_name": "Qwen3.7-Max",
             "max_output_tokens": 4096,
             "thinking_config": {"enabled": {"efforts": ["low"]}}},
            {"key": "qmodel", "enable": true, "display_name": "Qwen Plus"},
            {"key": "gfmodel", "enable": true, "display_name": "Goliath Fast & Free"},
            {"key": "turned-off", "enable": false, "display_name": "Hidden Model"}
        ]
    })
}

/// Stores the Qoder connection a signed request authenticates against. Without
/// it the catalog can never fill, because every fetch refuses before the network.
pub async fn connect_qoder(database: &TestDatabase) {
    let app_database = database.connect().await.expect("temporary database");

    upsert_qoder_connection(
        &app_database,
        &QoderConnectionWrite {
            id: "qoder_1".to_owned(),
            name: "Qoder (Seaavey Dev)".to_owned(),
            account_name: "Seaavey Dev".to_owned(),
            access_token: "dt-fixture-token".to_owned(),
            refresh_token: Some("rt-fixture-token".to_owned()),
            token_expires_at: Some(srouter_server::clock::now_ms() + 86_400_000),
            user_id: "user-fixture".to_owned(),
            email: "seaavey@example.com".to_owned(),
            organization_id: "org-fixture".to_owned(),
        },
    )
    .await
    .expect("connection stored");
}

/// A registry whose `qoder` adapter points at the fake upstream and can read
/// credentials from the given database.
pub fn qoder_registry(database: Option<AppDatabase>, fake: &FakeQoderUpstream) -> ProviderRegistry {
    // Both built-in drivers, exactly like `ProviderRegistry::with_database`.
    let mut providers = ProviderRegistry::new();
    providers.register(opencode::adapter().expect("opencode_zen adapter"));
    providers.register(
        qoder::adapter_with_endpoints(fake.endpoints(), database).expect("qoder adapter"),
    );

    providers
}

/// Application state whose `qoder` adapter points at the fake upstream, backed
/// by the given database so the device flow can store a connection.
pub fn qoder_state(
    database: AppDatabase,
    security: SecurityState,
    fake: &FakeQoderUpstream,
) -> AppState {
    let providers = qoder_registry(Some(database.clone()), fake);

    AppState::with_security(test_config(), providers, security).with_database(database)
}

/// Stores the fake Cline connection used by catalog and inference fixtures.
pub async fn connect_cline(database: &TestDatabase) {
    let app_database = database.connect().await.expect("temporary database");
    upsert_cline_connection(
        &app_database,
        &ClineConnectionWrite {
            id: "user-1".to_owned(),
            name: "Dev".to_owned(),
            access_token: "workos:cline-access".to_owned(),
            refresh_token: Some("cline-refresh".to_owned()),
            token_expires_at: Some(srouter_server::clock::now_ms() + 86_400_000),
            email: "dev@example.com".to_owned(),
        },
    )
    .await
    .expect("Cline connection stored");
}

/// A registry whose Cline adapter and WorkOS device flow share fake endpoints.
pub fn cline_registry(database: Option<AppDatabase>, fake: &FakeClineUpstream) -> ProviderRegistry {
    let mut providers = ProviderRegistry::new();
    providers.register(opencode::adapter().expect("opencode_zen adapter"));
    providers.register(
        cline::adapter_with_endpoints(fake.endpoints(), database).expect("cline adapter"),
    );
    providers
}

/// Application state wired to the fake Cline API and the given database.
pub fn cline_state(
    database: AppDatabase,
    security: SecurityState,
    fake: &FakeClineUpstream,
) -> AppState {
    let providers = cline_registry(Some(database.clone()), fake);
    AppState::with_security(test_config(), providers, security).with_database(database)
}

type SharedGrokState = Arc<StdMutex<FakeGrokState>>;

/// Recorded behavior of the fake Grok Web upstream: page-probe and WebSocket
/// legs are controlled independently so tests can isolate each failure path.
#[derive(Default)]
pub struct FakeGrokState {
    /// `ok`, `no_uid`, or `error` for the `GET /` probe.
    pub page_mode: String,
    /// `ok`, `stream_error`, `no_done`, or `reject` (handshake 401).
    pub ws_mode: String,
    pub page_requests: usize,
    pub last_page_cookie: String,
    pub ws_connections: usize,
    pub last_ws_cookie: String,
    pub last_ws_origin: String,
    pub last_ws_query: String,
    pub last_model: String,
    pub last_prompt: String,
    pub session_capabilities: Option<serde_json::Value>,
}

/// A local Grok Web stand-in: an HTTP leg for the `x-userid` page probe and a
/// WebSocket leg speaking the `session.create` chat protocol, aborted on drop.
pub struct FakeGrokUpstream {
    page_url: String,
    ws_url: String,
    state: SharedGrokState,
    http_task: JoinHandle<()>,
    ws_task: JoinHandle<()>,
}

impl FakeGrokUpstream {
    pub async fn start() -> Self {
        let state: SharedGrokState = Arc::new(StdMutex::new(FakeGrokState::default()));

        let router = Router::new()
            .route("/", get(grok_page_probe))
            .with_state(state.clone());
        let http_listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind the fake grok page probe");
        let http_address = http_listener.local_addr().expect("fake grok page address");
        let http_task = tokio::spawn(async move {
            let _ = axum::serve(http_listener, router).await;
        });

        let ws_listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind the fake grok websocket");
        let ws_address = ws_listener.local_addr().expect("fake grok ws address");
        let ws_state = state.clone();
        let ws_task = tokio::spawn(async move {
            grok_ws_accept_loop(ws_listener, ws_state).await;
        });

        Self {
            page_url: format!("http://{http_address}/"),
            ws_url: format!("ws://{ws_address}/ws"),
            state,
            http_task,
            ws_task,
        }
    }

    /// Endpoints pointing both Grok Web legs at this fake.
    pub fn endpoints(&self) -> GrokWebEndpoints {
        GrokWebEndpoints {
            page_url: self.page_url.clone(),
            ws_url: self.ws_url.clone(),
        }
    }

    /// Runs an edit against the recorded state.
    pub fn with<F, R>(&self, edit: F) -> R
    where
        F: FnOnce(&mut FakeGrokState) -> R,
    {
        edit(&mut self.state.lock().expect("fake grok state"))
    }

    /// Recorded page-probe requests.
    pub fn page_requests(&self) -> usize {
        self.with(|state| state.page_requests)
    }

    /// Recorded WebSocket handshakes.
    pub fn ws_connections(&self) -> usize {
        self.with(|state| state.ws_connections)
    }
}

impl Drop for FakeGrokUpstream {
    fn drop(&mut self) {
        self.http_task.abort();
        self.ws_task.abort();
    }
}

/// `GET /` issues `x-userid` only for the fixture cookie; a different cookie
/// redirects, mirroring the live probe.
async fn grok_page_probe(State(state): State<SharedGrokState>, headers: HeaderMap) -> Response {
    let cookie = header_text(&headers, "cookie");
    let mode = {
        let mut guard = state.lock().expect("fake grok state");
        guard.page_requests += 1;
        guard.last_page_cookie = cookie.clone();
        guard.page_mode.clone()
    };

    if mode == "error" {
        return Response::builder()
            .status(StatusCode::SERVICE_UNAVAILABLE)
            .body(Body::empty())
            .expect("fake grok probe error");
    }
    if mode != "no_uid" && cookie.contains("sso=fixture-valid") {
        return Response::builder()
            .status(StatusCode::OK)
            .header(
                header::SET_COOKIE,
                "x-userid=fake-uid-1234; Path=/; HttpOnly",
            )
            .body(Body::empty())
            .expect("fake grok probe success");
    }
    if mode == "no_uid" && cookie.contains("sso=") {
        return Response::builder()
            .status(StatusCode::OK)
            .body(Body::empty())
            .expect("fake grok probe without uid");
    }

    Response::builder()
        .status(StatusCode::SEE_OTHER)
        .header(header::LOCATION, "https://accounts.x.ai/")
        .body(Body::empty())
        .expect("fake grok probe redirect")
}

/// Accepts WebSocket connections until the listener is aborted.
async fn grok_ws_accept_loop(listener: TcpListener, state: SharedGrokState) {
    loop {
        let Ok((stream, _)) = listener.accept().await else {
            return;
        };
        let session_state = state.clone();
        tokio::spawn(async move {
            let _ = grok_ws_session(stream, session_state).await;
        });
    }
}

/// One fake chat conversation: `session.create` answers with
/// `conversation.attached`, then `response.create` is answered according to
/// `ws_mode`. Handshake headers are recorded, and `reject` answers 401.
#[allow(clippy::result_large_err)]
async fn grok_ws_session(
    stream: tokio::net::TcpStream,
    state: SharedGrokState,
) -> Result<(), Box<dyn std::error::Error>> {
    use futures_util::{SinkExt, StreamExt};

    let handshake_state = state.clone();
    let ws = tokio_tungstenite::accept_hdr_async(
        stream,
        move |request: &tokio_tungstenite::tungstenite::handshake::server::Request, response| {
            let cookie = request
                .headers()
                .get("cookie")
                .and_then(|value| value.to_str().ok())
                .unwrap_or_default()
                .to_owned();
            let origin = request
                .headers()
                .get("origin")
                .and_then(|value| value.to_str().ok())
                .unwrap_or_default()
                .to_owned();
            let query = request.uri().query().unwrap_or_default().to_owned();
            let reject = {
                let mut guard = handshake_state.lock().expect("fake grok state");
                guard.ws_connections += 1;
                guard.last_ws_cookie = cookie;
                guard.last_ws_origin = origin;
                guard.last_ws_query = query;
                guard.ws_mode == "reject"
            };
            if reject {
                let error = tokio_tungstenite::tungstenite::http::Response::builder()
                    .status(401)
                    .body(Some(String::from("cookie rejected")))
                    .expect("handshake rejection");
                return Err(error);
            }
            Ok(response)
        },
    )
    .await?;

    let (mut tx, mut rx) = ws.split();

    // session.create opens the conversation.
    let mut recorded = false;
    while let Some(message) = rx.next().await {
        let WsMessage::Text(text) = message? else {
            continue;
        };
        let value: serde_json::Value = serde_json::from_str(text.as_str())?;
        if value["event"]["type"] != "session.create" {
            continue;
        }
        {
            let mut guard = state.lock().expect("fake grok state");
            guard.last_model = value["event"]["session"]["model"]
                .as_str()
                .unwrap_or_default()
                .to_owned();
            guard.session_capabilities = Some(value["event"]["session"]["x_grok"].clone());
        }

        let attach = serde_json::json!({
            "session_id": "fake-session-1",
            "event": {
                "type": "conversation.attached",
                "event_id": "evt_attach_1",
                "conversation": { "id": "fake-conversation-1", "object": "realtime.conversation" },
                "mode": "new"
            }
        });
        tx.send(WsMessage::Text(attach.to_string().into())).await?;
        recorded = true;
        break;
    }
    if !recorded {
        return Ok(());
    }

    // response.create carries the flattened prompt.
    while let Some(message) = rx.next().await {
        let WsMessage::Text(text) = message? else {
            continue;
        };
        let value: serde_json::Value = serde_json::from_str(text.as_str())?;
        if value["event"]["type"] != "response.create" {
            continue;
        }
        let prompt = value["event"]["item"]["x_grok"]["input_chunks"][0]["text"]["text"]
            .as_str()
            .unwrap_or_default()
            .to_owned();
        state.lock().expect("fake grok state").last_prompt = prompt;
        break;
    }

    let mode = state.lock().expect("fake grok state").ws_mode.clone();
    let chunk = |text: &str| {
        serde_json::json!({
            "session_id": "fake-session-1",
            "event": {
                "type": "response.chunk",
                "event_id": "evt_chunk",
                "response_id": "fake-response-1",
                "item_id": "fake-item-1",
                "chunk": {
                    "text": { "text": text, "channel": "CHANNEL_ASSISTANT_RESPONSE" },
                    "metadata": { "step_id": 0, "phase_index": 1 }
                }
            }
        })
        .to_string()
    };
    let done = |status: &str, reason: Option<&str>| {
        let mut response = serde_json::json!({ "id": "fake-response-1", "status": status });
        if let Some(reason) = reason {
            response["status_details"] = serde_json::json!({ "reason": reason });
        }
        serde_json::json!({
            "session_id": "fake-session-1",
            "event": { "type": "response.done", "event_id": "evt_done", "response": response }
        })
        .to_string()
    };

    match mode.as_str() {
        "stream_error" => {
            tx.send(WsMessage::Text(done("failed", Some("stream_error")).into()))
                .await?;
        }
        "no_done" => {
            tx.send(WsMessage::Text(chunk("Hello").into())).await?;
            tx.send(WsMessage::Text(chunk(" world").into())).await?;
            // Close cleanly before response.done; the executor must not report success.
            tx.send(WsMessage::Close(None)).await?;
        }
        _ => {
            tx.send(WsMessage::Text(chunk("Hello").into())).await?;
            tx.send(WsMessage::Text(chunk(" world").into())).await?;
            tx.send(WsMessage::Text(done("completed", None).into()))
                .await?;
        }
    }
    tx.flush().await?;

    Ok(())
}

/// Stores the fixture Grok Web connection used by catalog and chat tests.
pub async fn connect_grok_web(database: &TestDatabase) {
    let app_database = database.connect().await.expect("temporary database");
    upsert_grok_web_connection(
        &app_database,
        &GrokWebConnectionWrite {
            id: "grok-web_fixture".to_owned(),
            name: "Grok Web".to_owned(),
            sso: "fixture-valid".to_owned(),
        },
    )
    .await
    .expect("Grok Web connection stored");
}

/// A registry whose `grok-web` adapter points at the fake upstream and can
/// read credentials from the given database.
pub fn grok_web_registry(
    database: Option<AppDatabase>,
    fake: &FakeGrokUpstream,
) -> ProviderRegistry {
    let mut providers = ProviderRegistry::new();
    providers.register(opencode::adapter().expect("opencode_zen adapter"));
    providers.register(
        grok_web::adapter_with_endpoints(fake.endpoints(), database).expect("grok-web adapter"),
    );
    providers
}

/// Application state wired to the fake Grok Web upstream and the given database.
pub fn grok_web_state(
    database: AppDatabase,
    security: SecurityState,
    fake: &FakeGrokUpstream,
) -> AppState {
    let providers = grok_web_registry(Some(database.clone()), fake);

    AppState::with_security(test_config(), providers, security).with_database(database)
}

/// Configuration pointing at the default temporary home used by state helpers.
pub fn test_config() -> APIConfig {
    let environment = HashMap::from([("HOME".to_owned(), "/tmp/srouter-test-home".to_owned())]);
    APIConfig::from_env_map(&environment).expect("test configuration")
}

/// `test_config` with `SROUTER_SECURE_COOKIES=true`, so responses should tag
/// the admin session cookie `Secure`.
pub fn test_secure_config() -> APIConfig {
    let environment = HashMap::from([
        ("HOME".to_owned(), "/tmp/srouter-test-home".to_owned()),
        ("SROUTER_SECURE_COOKIES".to_owned(), "true".to_owned()),
    ]);
    APIConfig::from_env_map(&environment).expect("test configuration")
}

/// State with an empty provider registry: every gateway request stops at model
/// resolution with `404`, so tests observe auth outcomes without any network.
pub fn empty_registry_state(security: SecurityState) -> AppState {
    AppState::with_security(test_config(), ProviderRegistry::new(), security)
}

/// Security state wired with fixture stores.
pub fn security_state(
    require_api_key: bool,
    keys: Vec<(String, APIKeyRecord)>,
    valid_session_hashes: Vec<String>,
) -> SecurityState {
    SecurityState::new(
        Arc::new(FixtureAPIKeyStore::new(require_api_key, keys)),
        Arc::new(FixtureAdminSessionStore::new(valid_session_hashes)),
    )
}

/// Security state backed by a real SQLx store on the temporary database, with
/// fixture admin sessions so key-CRUD tests can authenticate without seeding
/// the admin tables.
pub async fn sqlx_security_state(
    database: &TestDatabase,
    valid_session_hashes: Vec<String>,
) -> SecurityState {
    let app_database = database.connect().await.expect("temporary database");
    let store = Arc::new(SQLxAPIKeyStore::new(app_database));

    SecurityState::with_repository(
        store.clone(),
        Arc::new(FixtureAdminSessionStore::new(valid_session_hashes)),
        store,
    )
}

/// Security state with real SQLx API-key and admin-auth stores, both on the
/// temporary database. Used by the admin-auth and key-management tests.
pub async fn sqlx_admin_security_state(database: &TestDatabase) -> SecurityState {
    let app_database = database.connect().await.expect("temporary database");
    let api_key_store = Arc::new(SQLxAPIKeyStore::new(app_database.clone()));
    let admin_store = Arc::new(SQLxAdminAuthStore::new(app_database));

    SecurityState::with_repository(api_key_store.clone(), admin_store.clone(), api_key_store)
        .with_admin_auth(admin_store)
}

/// A fully permissive key record; tests override the fields they exercise.
pub fn api_key_record(id: &str) -> APIKeyRecord {
    APIKeyRecord {
        id: id.to_owned(),
        enabled: true,
        rate_limit: 0,
        quota_limit: 0.0,
        usage_tokens: 0.0,
        credit_limit: 0.0,
        usage_cost: 0.0,
        allowed_models: None,
    }
}

/// Key records are looked up by their raw value, so fixtures never hash keys.
pub struct FixtureAPIKeyStore {
    keys: HashMap<String, APIKeyRecord>,
    require_api_key: bool,
}

impl FixtureAPIKeyStore {
    pub fn new(require_api_key: bool, keys: Vec<(String, APIKeyRecord)>) -> Self {
        Self {
            keys: keys.into_iter().collect(),
            require_api_key,
        }
    }
}

impl APIKeyStore for FixtureAPIKeyStore {
    fn find_by_key<'a>(
        &'a self,
        key: &'a str,
    ) -> BoxFuture<'a, Result<Option<APIKeyRecord>, APIError>> {
        let record = self.keys.get(key).cloned();

        Box::pin(async move { Ok(record) })
    }

    fn require_api_key(&self) -> BoxFuture<'_, Result<bool, APIError>> {
        let required = self.require_api_key;

        Box::pin(async move { Ok(required) })
    }
}

/// Admin sessions are looked up by token hash, exactly like the SQLx store will.
pub struct FixtureAdminSessionStore {
    valid_hashes: HashSet<String>,
}

impl FixtureAdminSessionStore {
    pub fn new(valid_token_hashes: Vec<String>) -> Self {
        Self {
            valid_hashes: valid_token_hashes.into_iter().collect(),
        }
    }
}

impl AdminSessionStore for FixtureAdminSessionStore {
    fn has_valid_session<'a>(
        &'a self,
        token_hash: &'a str,
        _now_ms: i64,
    ) -> BoxFuture<'a, Result<bool, APIError>> {
        let valid = self.valid_hashes.contains(token_hash);

        Box::pin(async move { Ok(valid) })
    }
}

/// Injects a loopback peer, matching a request from the local machine.
pub fn with_loopback_client(mut request: Request<Body>) -> Request<Body> {
    request
        .extensions_mut()
        .insert(ConnectInfo(SocketAddr::from(([127, 0, 0, 1], 40_000))));

    request
}

/// Injects a public peer address, matching a remote client.
pub fn with_remote_client(mut request: Request<Body>, address: &str) -> Request<Body> {
    let socket: SocketAddr = format!("{address}:40000")
        .parse()
        .expect("remote test address");

    request.extensions_mut().insert(ConnectInfo(socket));

    request
}

/// JSON request builder shared by the middleware tests.
pub fn json_request(method: &str, uri: &str, body: serde_json::Value) -> Request<Body> {
    json_request_with_headers(method, uri, body, &[])
}

/// JSON request builder with extra headers.
pub fn json_request_with_headers(
    method: &str,
    uri: &str,
    body: serde_json::Value,
    headers: &[(&str, &str)],
) -> Request<Body> {
    let mut builder = Request::builder()
        .method(method)
        .uri(uri)
        .header(header::CONTENT_TYPE, "application/json");
    for (name, value) in headers {
        builder = builder.header(*name, *value);
    }

    builder
        .body(Body::from(serde_json::to_vec(&body).expect("request body")))
        .expect("request")
}

async fn fake_chat_completion(Json(payload): Json<serde_json::Value>) -> Response {
    let model = payload
        .get("model")
        .and_then(|value| value.as_str())
        .unwrap_or("unknown")
        .to_owned();
    let streaming = payload
        .get("stream")
        .and_then(|value| value.as_bool())
        .unwrap_or(false);

    // Failure trigger: the gateway must map upstream rejections instead of
    // forwarding the fake's status.
    if model == "upstream-fail" {
        return Response::builder()
            .status(StatusCode::UNAUTHORIZED)
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(r#"{"error":{"message":"denied by upstream"}}"#))
            .expect("fake upstream failure response");
    }

    // Mirrors the real upstream's free-tier gate: a non-space-bunny model
    // whose tool set lacks the harness `read` and `shell` tools is rejected
    // with 403 FreeTierError, exactly like opencode.ai/zen/v1.
    if !model.starts_with("space-bunny") {
        let tools = payload.get("tools").and_then(|value| value.as_array());
        let has_tool = |name: &str| {
            tools.is_some_and(|tools| {
                tools
                    .iter()
                    .any(|tool| tool["function"]["name"].as_str() == Some(name))
            })
        };
        if !(has_tool("read") && has_tool("shell")) {
            return Response::builder()
                .status(StatusCode::FORBIDDEN)
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    r#"{"type":"error","error":{"type":"FreeTierError","message":"Error from provider (Console): OpenCode's free tier can only be used from within OpenCode"}}"#,
                ))
                .expect("fake upstream gate response");
        }
    }

    if streaming {
        // Streams a tool call whose arguments arrive split across writes, the
        // way the real upstream fragments SSE chunks.
        if model == "tool-call-stream" {
            let chunks = [
                r#"{"id":"chatcmpl-toolcall","object":"chat.completion.chunk","created":1,"model":"tool-call-stream","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_lookup_1","type":"function","function":{"name":"lookup","arguments":""}}]}}]}"#,
                r#"{"id":"chatcmpl-toolcall","object":"chat.completion.chunk","created":1,"model":"tool-call-stream","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\"query\":"}}]}}]}"#,
                r#"{"id":"chatcmpl-toolcall","object":"chat.completion.chunk","created":1,"model":"tool-call-stream","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":" \"weather\"}"}}]}}]}"#,
                r#"{"id":"chatcmpl-toolcall","object":"chat.completion.chunk","created":1,"model":"tool-call-stream","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":5,"completion_tokens":6,"total_tokens":11}}"#,
            ];
            let mut sse = String::new();
            for chunk in chunks {
                sse.push_str("data: ");
                sse.push_str(chunk);
                sse.push_str("\n\n");
            }
            sse.push_str("data: [DONE]\n\n");

            let fragments: Vec<Vec<u8>> = sse.into_bytes().chunks(37).map(<[u8]>::to_vec).collect();
            let stream =
                futures_util::stream::unfold(fragments.into_iter(), |mut fragments| async move {
                    let fragment = fragments.next()?;
                    tokio::time::sleep(std::time::Duration::from_millis(5)).await;
                    Some((Ok::<_, std::convert::Infallible>(fragment), fragments))
                });

            return Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, "text/event-stream")
                .body(Body::from_stream(stream))
                .expect("fake tool-call SSE response");
        }

        // Simulates upstream TCP fragmentation: the first `data:` line is
        // split across writes, so a per-chunk parser drops the event.
        if model == "fragmented-stream" {
            let fragments = vec![
                String::from("data: {\"id\":\"chatcmpl-frag"),
                String::from(
                    "mented\",\"object\":\"chat.completion.chunk\",\"created\":1,\"model\":\"fragmented-stream\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"fragmented reply\"}}]}\n\n",
                ),
                String::from(
                    "data: {\"id\":\"chatcmpl-fragmented\",\"object\":\"chat.completion.chunk\",\"created\":1,\"model\":\"fragmented-stream\",\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":11,\"completion_tokens\":22,\"total_tokens\":33}}\n\n",
                ),
                String::from("data: [DONE]\n\n"),
            ];
            let stream =
                futures_util::stream::unfold(fragments.into_iter(), |mut fragments| async move {
                    let fragment = fragments.next()?;
                    tokio::time::sleep(std::time::Duration::from_millis(20)).await;
                    Some((
                        Ok::<_, std::convert::Infallible>(fragment.into_bytes()),
                        fragments,
                    ))
                });

            return Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, "text/event-stream")
                .body(Body::from_stream(stream))
                .expect("fragmented fake SSE response");
        }

        if model.contains("search") {
            let messages = payload.get("messages").and_then(|m| m.as_array());
            let has_tool_response = messages.is_some_and(|msgs| {
                msgs.iter()
                    .any(|msg| msg.get("role").and_then(|r| r.as_str()) == Some("tool"))
            });

            if has_tool_response {
                let chunk_done = serde_json::json!({
                    "id": "chatcmpl-stream-done",
                    "object": "chat.completion.chunk",
                    "created": 2,
                    "model": model,
                    "choices": [{
                        "index": 0,
                        "delta": {
                            "content": "Grounded streaming search response"
                        },
                        "finish_reason": "stop"
                    }]
                });
                let body = format!("data: {chunk_done}\n\ndata: [DONE]\n\n");
                return Response::builder()
                    .status(StatusCode::OK)
                    .header(header::CONTENT_TYPE, "text/event-stream")
                    .body(Body::from(body))
                    .expect("fake SSE response");
            } else {
                let chunk1 = serde_json::json!({
                    "id": "chatcmpl-stream-call",
                    "object": "chat.completion.chunk",
                    "created": 1,
                    "model": model,
                    "choices": [{
                        "index": 0,
                        "delta": {
                            "role": "assistant",
                            "tool_calls": [{
                                "index": 0,
                                "id": "call_search_stream_1",
                                "type": "function",
                                "function": {
                                    "name": "web_search",
                                    "arguments": "{\"query\":\"rust streaming\"}"
                                }
                            }]
                        }
                    }]
                });
                let chunk2 = serde_json::json!({
                    "id": "chatcmpl-stream-call",
                    "object": "chat.completion.chunk",
                    "created": 1,
                    "model": model,
                    "choices": [{
                        "index": 0,
                        "delta": {},
                        "finish_reason": "tool_calls"
                    }]
                });
                let body = format!("data: {chunk1}\n\ndata: {chunk2}\n\ndata: [DONE]\n\n");
                return Response::builder()
                    .status(StatusCode::OK)
                    .header(header::CONTENT_TYPE, "text/event-stream")
                    .body(Body::from(body))
                    .expect("fake SSE response");
            }
        }

        let body = format!(
            "data: {{\"id\":\"chatcmpl-fake\",\"object\":\"chat.completion.chunk\",\"created\":1,\"model\":\"{model}\",\"choices\":[{{\"index\":0,\"delta\":{{\"content\":\"fake stream\"}}}}]}}\n\ndata: [DONE]\n\n"
        );

        return Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "text/event-stream")
            .body(Body::from(body))
            .expect("fake SSE response");
    }

    if model.contains("search") {
        let messages = payload.get("messages").and_then(|m| m.as_array());
        let has_tool_response = messages.is_some_and(|msgs| {
            msgs.iter()
                .any(|msg| msg.get("role").and_then(|r| r.as_str()) == Some("tool"))
        });

        if has_tool_response {
            return Json(serde_json::json!({
                "id": "chatcmpl-search-done",
                "object": "chat.completion",
                "created": 2,
                "model": model,
                "choices": [{
                    "index": 0,
                    "message": {
                        "role": "assistant",
                        "content": "Grounded search response based on tool results"
                    },
                    "finish_reason": "stop"
                }],
                "usage": { "prompt_tokens": 50, "completion_tokens": 20, "total_tokens": 70 },
                "echo": payload
            }))
            .into_response();
        } else {
            return Json(serde_json::json!({
                "id": "chatcmpl-search-call",
                "object": "chat.completion",
                "created": 1,
                "model": model,
                "choices": [{
                    "index": 0,
                    "message": {
                        "role": "assistant",
                        "content": null,
                        "tool_calls": [{
                            "id": "call_search_123",
                            "type": "function",
                            "function": {
                                "name": "web_search",
                                "arguments": "{\"query\":\"rust async features\"}"
                            }
                        }]
                    },
                    "finish_reason": "tool_calls"
                }],
                "usage": { "prompt_tokens": 30, "completion_tokens": 15, "total_tokens": 45 },
                "echo": payload
            }))
            .into_response();
        }
    }

    Json(serde_json::json!({
        "id": "chatcmpl-fake",
        "object": "chat.completion",
        "created": 1,
        "model": model,
        "choices": [{
            "index": 0,
            "message": { "role": "assistant", "content": "fake upstream reply" },
            "finish_reason": "stop"
        }],
        "usage": if payload.get("prompt_cache_key").is_some() || model.contains("cached") {
            serde_json::json!({
                "prompt_tokens": 100,
                "completion_tokens": 20,
                "total_tokens": 120,
                "prompt_tokens_details": {
                    "cached_tokens": 80
                }
            })
        } else {
            serde_json::json!({ "prompt_tokens": 1, "completion_tokens": 2, "total_tokens": 3 })
        },
        // Echoes the request so tests can assert field forwarding; its
        // presence also proves unknown upstream fields survive the gateway.
        "echo": payload
    }))
    .into_response()
}

fn unique_temp_directory() -> std::io::Result<PathBuf> {
    let unique = format!(
        "srouter-test-{}-{}-{}",
        std::process::id(),
        SEQUENCE.fetch_add(1, Ordering::Relaxed),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    );

    let directory = std::env::temp_dir().join(unique);
    std::fs::create_dir_all(&directory)?;

    Ok(directory)
}
