//! Shared helpers for integration tests. Every helper here uses isolated
//! storage or a local fake upstream and must never reach a real provider or
//! `~/.srouter/srouter.db`.

#![allow(dead_code)]

use std::collections::{HashMap, HashSet};
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

use axum::{
    Json, Router,
    body::Body,
    extract::ConnectInfo,
    http::{Request, StatusCode, header},
    response::{IntoResponse, Response},
    routing::post,
};
use futures_util::future::BoxFuture;
use srouter_server::features::admin_auth::AdminSessionStore;
use srouter_server::features::api_keys::{APIKeyRecord, APIKeyStore};
use srouter_server::features::providers::{ProviderRegistry, adapters::opencode_zen};
use srouter_server::infrastructure::database::AppDatabase;
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
        opencode_zen::adapter_with_base_url(upstream.base_url()).expect("opencode_zen adapter"),
    );

    (
        upstream,
        AppState::with_security(test_config(), providers, security),
    )
}

/// Configuration pointing at the default temporary home used by state helpers.
pub fn test_config() -> APIConfig {
    let environment = HashMap::from([("HOME".to_owned(), "/tmp/srouter-test-home".to_owned())]);
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

    if streaming {
        let body = format!(
            "data: {{\"id\":\"chatcmpl-fake\",\"object\":\"chat.completion.chunk\",\"created\":1,\"model\":\"{model}\",\"choices\":[{{\"index\":0,\"delta\":{{\"content\":\"fake stream\"}}}}]}}\n\ndata: [DONE]\n\n"
        );

        return Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "text/event-stream")
            .body(Body::from(body))
            .expect("fake SSE response");
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
        "usage": { "prompt_tokens": 1, "completion_tokens": 2, "total_tokens": 3 },
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
