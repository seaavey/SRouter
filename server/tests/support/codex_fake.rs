//! Codex fake upstream: the Responses SSE leg and the OAuth refresh leg.

use super::*;

type SharedCodexState = Arc<StdMutex<FakeCodexState>>;

/// Recorded behavior of the fake Codex upstream. The Responses SSE leg and the
/// OAuth refresh leg are controlled independently so a test can isolate one.
#[derive(Debug)]
pub struct FakeCodexState {
    /// `default`, `fragmented`, `tools`, `failed`, or `unauthorized`.
    pub chat_mode: String,
    pub refresh_failure: bool,
    pub chat_requests: usize,
    pub refresh_requests: usize,
    pub last_authorization: String,
    pub last_account_id: String,
    pub last_originator: String,
    pub last_chat_body: serde_json::Value,
    pub last_refresh_form: String,
}

impl Default for FakeCodexState {
    fn default() -> Self {
        Self {
            chat_mode: "default".to_owned(),
            refresh_failure: false,
            chat_requests: 0,
            refresh_requests: 0,
            last_authorization: String::new(),
            last_account_id: String::new(),
            last_originator: String::new(),
            last_chat_body: serde_json::Value::Null,
            last_refresh_form: String::new(),
        }
    }
}

/// A local stand-in for the Codex Responses endpoint and the OAuth token
/// endpoint, aborted when dropped.
pub struct FakeCodexUpstream {
    base_url: String,
    state: SharedCodexState,
    task: JoinHandle<()>,
}

impl FakeCodexUpstream {
    pub async fn start() -> Self {
        let state: SharedCodexState = Arc::new(StdMutex::new(FakeCodexState::default()));
        let router = Router::new()
            .route("/codex/responses", post(codex_responses))
            .route("/token", post(codex_token))
            .with_state(state.clone());
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind the fake Codex upstream");
        let address = listener.local_addr().expect("fake Codex upstream address");
        let base_url = format!("http://{address}");
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

    pub fn endpoints(&self) -> CodexEndpoints {
        CodexEndpoints {
            api_base_url: format!("{}/codex", self.base_url),
            token_url: format!("{}/token", self.base_url),
        }
    }

    pub fn with<F, R>(&self, edit: F) -> R
    where
        F: FnOnce(&mut FakeCodexState) -> R,
    {
        let mut state = self.state.lock().expect("fake Codex state");
        edit(&mut state)
    }

    pub fn chat_requests(&self) -> usize {
        self.with(|state| state.chat_requests)
    }

    pub fn refresh_requests(&self) -> usize {
        self.with(|state| state.refresh_requests)
    }
}

impl Drop for FakeCodexUpstream {
    fn drop(&mut self) {
        self.task.abort();
    }
}

async fn codex_responses(
    State(state): State<SharedCodexState>,
    headers: HeaderMap,
    Json(payload): Json<serde_json::Value>,
) -> Response {
    let mode = {
        let mut state = state.lock().expect("fake Codex state");
        state.chat_requests += 1;
        state.last_authorization = header_text(&headers, "authorization");
        state.last_account_id = header_text(&headers, "chatgpt-account-id");
        state.last_originator = header_text(&headers, "originator");
        state.last_chat_body = payload;
        state.chat_mode.clone()
    };

    if mode == "unauthorized" {
        let body = serde_json::json!({
            "error": {"message": "token revoked", "code": "invalid_api_key"}
        });
        return (StatusCode::UNAUTHORIZED, Json(body)).into_response();
    }

    let events = match mode.as_str() {
        "tools" => vec![
            serde_json::json!({
                "type": "response.output_item.added",
                "output_index": 1,
                "item": {"type": "function_call", "call_id": "call_9", "id": "fc_1",
                         "name": "lookup", "arguments": ""}
            }),
            serde_json::json!({
                "type": "response.function_call_arguments.delta",
                "output_index": 1,
                "delta": "{\"q\":"
            }),
            serde_json::json!({
                "type": "response.function_call_arguments.delta",
                "output_index": 1,
                "delta": "\"bmw\"}"
            }),
            serde_json::json!({
                "type": "response.completed",
                "response": {"usage": {"input_tokens": 5, "output_tokens": 7}}
            }),
        ],
        "failed" => vec![serde_json::json!({
            "type": "response.failed",
            "response": {"error": {"message": "quota blown"}}
        })],
        _ => vec![
            serde_json::json!({"type": "response.created", "response": {"id": "resp_1"}}),
            serde_json::json!({"type": "response.output_text.delta", "delta": "Hello"}),
            serde_json::json!({"type": "response.output_text.delta", "delta": " world"}),
            serde_json::json!({
                "type": "response.completed",
                "response": {"usage": {
                    "input_tokens": 5,
                    "output_tokens": 7,
                    "input_tokens_details": {"cached_tokens": 2}
                }}
            }),
        ],
    };

    let mut sse = String::new();
    for event in &events {
        sse.push_str("event: ");
        sse.push_str(event["type"].as_str().unwrap_or("message"));
        sse.push_str("\ndata: ");
        sse.push_str(&event.to_string());
        sse.push_str("\n\n");
    }

    // The upstream fragments SSE across TCP writes; the translation must
    // reassemble `data:` lines that span reads.
    let body = if mode == "fragmented" {
        let pieces: Vec<Result<Bytes, std::io::Error>> = sse
            .as_bytes()
            .chunks(17)
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
        .expect("response")
}

async fn codex_token(State(state): State<SharedCodexState>, body: String) -> Response {
    let failure = {
        let mut state = state.lock().expect("fake Codex state");
        state.refresh_requests += 1;
        state.last_refresh_form = body.clone();
        state.refresh_failure
    };

    if failure {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "invalid_grant"})),
        )
            .into_response();
    }

    // The authorization-code exchange is distinguished from the refresh grant so
    // the OAuth routes can be tested against the same `/token` leg.
    if body.contains("grant_type=authorization_code") {
        return Json(serde_json::json!({
            "access_token": "codex-access",
            "refresh_token": "codex-refresh",
            "id_token": fake_id_token("codex@example.com", "acct-1"),
            "expires_in": 3600,
            "token_type": "Bearer"
        }))
        .into_response();
    }

    Json(serde_json::json!({
        "access_token": "new-access",
        "refresh_token": "new-refresh",
        "expires_in": 3600,
        "token_type": "Bearer"
    }))
    .into_response()
}

/// An unsigned JWT whose payload carries the claims the identity reader uses.
fn fake_id_token(email: &str, account_id: &str) -> String {
    use base64::Engine;
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;

    let payload = serde_json::json!({
        "email": email,
        "https://api.openai.com/auth": {"chatgpt_account_id": account_id},
    })
    .to_string();

    format!("header.{}.signature", URL_SAFE_NO_PAD.encode(payload))
}

/// Stores an `openai_codex` connection with a session that is valid until
/// `expires_at` (milliseconds since the epoch).
pub async fn connect_codex(database: &TestDatabase, expires_at: Option<i64>) {
    let app_database = database.connect().await.expect("temporary database");
    upsert_codex_connection(
        &app_database,
        &CodexConnectionWrite {
            id: "codex-account".to_owned(),
            name: "Codex".to_owned(),
            access_token: "chatgpt-access".to_owned(),
            refresh_token: Some("chatgpt-refresh".to_owned()),
            account_id: Some("acct-1".to_owned()),
            token_expires_at: expires_at,
        },
    )
    .await
    .expect("Codex connection stored");
}

/// A registry whose Codex adapter points at the fake upstream.
pub fn codex_registry(database: Option<AppDatabase>, fake: &FakeCodexUpstream) -> ProviderRegistry {
    let mut providers = ProviderRegistry::new();
    providers.register(opencode::adapter().expect("opencode_zen adapter"));
    providers.register(
        codex::adapter_with_endpoints(fake.endpoints(), database).expect("codex adapter"),
    );
    providers
}
