//! Isolated load-test server for SRouter.
//!
//! Boots the real gateway router against a throwaway temp SQLite database and a
//! local fake OpenAI-compatible upstream (both bound to random loopback ports),
//! then listens on an ephemeral port and prints the base URL + API key as JSON
//! on stdout. Load drivers (k6) point at that base URL, so no request ever
//! reaches a real provider or the live `~/.srouter/srouter.db`.
//!
//! Usage:
//!   cargo run --manifest-path server/Cargo.toml --bin loadtest_server -- --port 0
//!   # parse stdout line 1 (JSON) for {"base_url":"http://127.0.0.1:PORT","api_key":"..."}
//!   # runs until SIGINT/SIGTERM; on exit the temp DB is removed.

use std::collections::HashMap;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;

use futures_util::future::BoxFuture;
use serde_json::json;
use srouter_server::{
    APIConfig, APIError, AppDatabase, AppState, ProviderRegistry, SecurityState,
    app::create_router,
    features::admin_auth::{EmptyAdminAuthRepository, EmptySessionStore},
    features::api_keys::{APIKeyRecord, APIKeyStore, EmptyAPIKeyRepository},
};
use tokio::net::TcpListener;

/// The API key this server accepts. A fresh install's `require_api_key`
/// setting defaults to false and only loopback bypasses auth, but our driver
/// comes from 127.0.0.1 so any of that is fine. This secret makes intent
/// explicit and keeps a stray remote caller out.
const LOADTEST_API_KEY: &str = "sr-live-loadtest-00000000-0000-0000-0000-000000000000";

/// A tiny `APIKeyStore` that answers for exactly one hardcoded key.
struct OneKeyStore;

impl APIKeyStore for OneKeyStore {
    fn find_by_key<'a>(
        &'a self,
        key: &'a str,
    ) -> BoxFuture<'a, Result<Option<APIKeyRecord>, APIError>> {
        Box::pin(async move {
            Ok(if key == LOADTEST_API_KEY {
                Some(APIKeyRecord {
                    id: "loadtest-key".to_owned(),
                    user_id: None,
                    enabled: true,
                    owner_enabled: true,
                    rate_limit: 0,
                    quota_limit: 0.0,
                    usage_tokens: 0.0,
                    credit_limit: 0.0,
                    usage_cost: 0.0,
                    allowed_models: None,
                })
            } else {
                None
            })
        })
    }

    fn require_api_key(&self) -> BoxFuture<'_, Result<bool, APIError>> {
        Box::pin(async { Ok(false) })
    }
}

/// A local OpenAI-compatible fake upstream: answers `POST /v1/chat/completions`
/// with a non-streaming completion for normal requests and a minimal SSE stream
/// for `stream:true` ones, so the gateway's full hot path runs without ever
/// reaching a real provider.
async fn start_fake_upstream() -> Result<String, APIError> {
    use axum::{
        Router,
        body::Bytes,
        extract::State,
        http::HeaderMap,
        response::{IntoResponse, Response},
        routing::post,
    };

    async fn chat(State(_): State<()>, _headers: HeaderMap, _body: Bytes) -> Response {
        // The opencode executor always sends `stream:true` upstream and
        // aggregates the SSE deltas into a non-streaming response for buffered
        // callers, so the fake always replies with SSE. The gateway handles both
        // the buffered-aggregation and the streaming-passthrough paths.
        let body = concat!(
            "data: {\"id\":\"fake\",\"object\":\"chat.completion.chunk\",\"created\":1,\"model\":\"fake\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"content\":\"hi\"},\"finish_reason\":null}]}\n\n",
            "data: {\"id\":\"fake\",\"object\":\"chat.completion.chunk\",\"created\":1,\"model\":\"fake\",\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}]}\n\n",
            "data: [DONE]\n\n",
        );
        (
            [(axum::http::header::CONTENT_TYPE, "text/event-stream")],
            body,
        )
            .into_response()
    }

    let app = Router::new()
        .route("/chat/completions", post(chat))
        .with_state(());
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|error| APIError::new(500, format!("bind fake upstream: {error}")))?;
    let addr = listener
        .local_addr()
        .map_err(|error| APIError::new(500, format!("fake upstream addr: {error}")))?;
    tokio::spawn(async move {
        let _ = axum::serve(listener, app).await;
    });
    Ok(format!("http://{addr}"))
}

fn parse_port() -> u16 {
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        if arg == "--port"
            && let Some(value) = args.next()
            && let Ok(port) = value.parse()
        {
            return port;
        }
    }
    0
}

/// A temp directory that is removed when the value is dropped.
struct TempDir {
    path: PathBuf,
}

impl TempDir {
    fn new() -> Result<Self, APIError> {
        let unique = format!(
            "srouter-loadtest-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        );
        let path = std::env::temp_dir().join(unique);
        std::fs::create_dir_all(&path)
            .map_err(|error| APIError::new(500, format!("tempdir: {error}")))?;
        Ok(Self { path })
    }

    fn path(&self) -> &PathBuf {
        &self.path
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

#[tokio::main]
async fn main() -> Result<(), APIError> {
    let port = parse_port();

    let directory = TempDir::new()?;
    let db_path: PathBuf = directory.path().join("srouter.db");
    let environment: HashMap<String, String> = HashMap::from([
        ("HOME".to_owned(), directory.path().display().to_string()),
        ("DATABASE_PATH".to_owned(), db_path.display().to_string()),
    ]);
    let config = APIConfig::from_env_map(&environment)
        .map_err(|error| APIError::new(500, format!("config: {error}")))?;
    let database = AppDatabase::connect(&config).await?;

    let security = SecurityState::with_repository(
        Arc::new(OneKeyStore),
        Arc::new(EmptySessionStore),
        Arc::new(EmptyAPIKeyRepository),
    )
    .with_admin_auth(Arc::new(EmptyAdminAuthRepository));

    // Real registry, but the opencode provider is repointed at the local fake
    // so the model id `beam-free` resolves to it instead of the network.
    let upstream_url = start_fake_upstream().await?;
    let mut providers = ProviderRegistry::new();
    providers.register(
        srouter_server::features::providers::opencode::adapter_with_base_url(&upstream_url, None)?,
    );

    let state = AppState::with_security(config, providers, security).with_database(database);
    let router = create_router(state);

    let listener = TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], port)))
        .await
        .map_err(|error| APIError::new(500, format!("bind: {error}")))?;
    let addr = listener
        .local_addr()
        .map_err(|error| APIError::new(500, format!("addr: {error}")))?;
    println!(
        "{}",
        json!({
            "base_url": format!("http://{addr}"),
            "api_key": LOADTEST_API_KEY,
        })
    );

    let shutdown = async {
        let _ = tokio::signal::ctrl_c().await;
    };
    axum::serve(
        listener,
        router.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown)
    .await
    .map_err(|error| APIError::new(500, format!("serve: {error}")))?;
    Ok(())
}
