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
use srouter_server::features::providers::qoder::{self, QoderEndpoints};
use srouter_server::features::providers::{ProviderRegistry, opencode};
use srouter_server::infrastructure::database::AppDatabase;
use srouter_server::infrastructure::database::admin_auth::SQLxAdminAuthStore;
use srouter_server::infrastructure::database::api_keys::SQLxAPIKeyStore;
use srouter_server::infrastructure::database::providers::{
    QoderConnectionWrite, upsert_qoder_connection,
};
use srouter_server::{APIConfig, APIError, AppState, SecurityState};
use tokio::net::TcpListener;
use tokio::task::JoinHandle;

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
pub const FAKE_QODER_KEYS: &[&str] = &["auto", "qmodel", "qmodel_latest"];

/// A `model/list` body whose settings differ from the executor's defaults, so a
/// test can tell the upstream row from a fallback.
pub fn qoder_catalog_body() -> serde_json::Value {
    serde_json::json!({
        "chat": [
            {"key": "auto", "enable": true, "is_reasoning": false, "max_output_tokens": 8192},
            {"key": "qmodel_latest", "enable": true, "max_output_tokens": 4096,
             "thinking_config": {"enabled": {"efforts": ["low"]}}},
            {"key": "qmodel", "enable": true},
            {"key": "turned-off", "enable": false}
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
