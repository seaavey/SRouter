//! CodeBuddy's state-and-poll OAuth flow for the global and China endpoints.

use std::time::Duration;

use axum::Extension;
use axum::body::Bytes;
use axum::extract::{RawQuery, State};
use axum::response::{IntoResponse, Redirect, Response};
use axum::routing::get;
use axum::{Json, Router};
use serde::Serialize;
use serde_json::Value;

use super::{
    ConnectedProvider, PollFailure, PollResponse, Protocol, account_suffix, query_params,
    require_database, state_from_body,
};
use crate::clock::now_ms;
use crate::constants;
use crate::error::APIError;
use crate::infrastructure::database::oauth_sessions::{
    SESSION_TTL_MS, claim_session, cleanup_expired_sessions, delete_session, release_session,
    save_session,
};
use crate::infrastructure::database::providers::{
    CodeBuddyConnectionWrite, upsert_codebuddy_connection,
};
use crate::infrastructure::upstream::UpstreamClient;
use crate::state::AppState;

const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const GLOBAL_BASE_URL: &str = "https://www.codebuddy.ai/v2/chat/completions";
const CN_BASE_URL: &str = "https://copilot.tencent.com/v2/chat/completions";
const GLOBAL_USER_AGENT: &str = "IDE/2.63.2 CodeBuddy/2.63.2";
const CN_USER_AGENT: &str = "CLI/2.96.0 CodeBuddy/2.96.0";

#[derive(Clone, Debug)]
pub struct CodeBuddyAuthEndpoints {
    pub global_state_url: String,
    pub global_token_url: String,
    pub cn_state_url: String,
    pub cn_token_url: String,
    pub global_origin: String,
    pub global_domain: String,
    pub cn_origin: String,
    pub cn_domain: String,
}

impl Default for CodeBuddyAuthEndpoints {
    fn default() -> Self {
        Self {
            global_state_url: "https://www.codebuddy.ai/v2/plugin/auth/state?platform=ide"
                .to_owned(),
            global_token_url: "https://www.codebuddy.ai/v2/plugin/auth/token".to_owned(),
            cn_state_url: "https://copilot.tencent.com/v2/plugin/auth/state?platform=CLI&ioa=1"
                .to_owned(),
            cn_token_url: "https://copilot.tencent.com/v2/plugin/auth/token".to_owned(),
            global_origin: "https://www.codebuddy.ai".to_owned(),
            global_domain: "www.codebuddy.ai".to_owned(),
            cn_origin: "https://www.codebuddy.cn".to_owned(),
            cn_domain: "www.codebuddy.cn".to_owned(),
        }
    }
}

#[derive(Clone, Copy)]
enum Flavor {
    Global,
    China,
}

impl Flavor {
    fn provider_id(self) -> &'static str {
        match self {
            Self::Global => "codebuddy",
            Self::China => "codebuddy-cn",
        }
    }

    fn display_name(self) -> &'static str {
        match self {
            Self::Global => "CodeBuddy",
            Self::China => "CodeBuddy CN",
        }
    }

    fn base_url(self) -> &'static str {
        match self {
            Self::Global => GLOBAL_BASE_URL,
            Self::China => CN_BASE_URL,
        }
    }

    fn user_agent(self) -> &'static str {
        match self {
            Self::Global => GLOBAL_USER_AGENT,
            Self::China => CN_USER_AGENT,
        }
    }

    fn state_url(self, endpoints: &CodeBuddyAuthEndpoints) -> &str {
        match self {
            Self::Global => &endpoints.global_state_url,
            Self::China => &endpoints.cn_state_url,
        }
    }

    fn token_url(self, endpoints: &CodeBuddyAuthEndpoints) -> &str {
        match self {
            Self::Global => &endpoints.global_token_url,
            Self::China => &endpoints.cn_token_url,
        }
    }

    fn origin(self, endpoints: &CodeBuddyAuthEndpoints) -> &str {
        match self {
            Self::Global => &endpoints.global_origin,
            Self::China => &endpoints.cn_origin,
        }
    }

    fn domain(self, endpoints: &CodeBuddyAuthEndpoints) -> &str {
        match self {
            Self::Global => &endpoints.global_domain,
            Self::China => &endpoints.cn_domain,
        }
    }
}

#[derive(Serialize, schemars::JsonSchema)]
pub(crate) struct CodeBuddyLoginResponse {
    authorize_url: String,
    state: String,
}

pub fn create_codebuddy_login_router() -> Router<AppState> {
    create_codebuddy_login_router_with_endpoints(CodeBuddyAuthEndpoints::default())
}

pub fn create_codebuddy_login_router_with_endpoints(
    endpoints: CodeBuddyAuthEndpoints,
) -> Router<AppState> {
    Router::new()
        .route("/auth/codebuddy/login", get(global_login))
        .route("/auth/codebuddy/poll", get(global_poll).post(global_poll))
        .route("/auth/codebuddy-cn/login", get(cn_login))
        .route("/auth/codebuddy-cn/poll", get(cn_poll).post(cn_poll))
        .layer(Extension(endpoints))
}

async fn global_login(
    Extension(endpoints): Extension<CodeBuddyAuthEndpoints>,
    State(state): State<AppState>,
    RawQuery(query): RawQuery,
) -> Result<Response, APIError> {
    login(Flavor::Global, &endpoints, &state, query.as_deref()).await
}

async fn cn_login(
    Extension(endpoints): Extension<CodeBuddyAuthEndpoints>,
    State(state): State<AppState>,
    RawQuery(query): RawQuery,
) -> Result<Response, APIError> {
    login(Flavor::China, &endpoints, &state, query.as_deref()).await
}

async fn login(
    flavor: Flavor,
    endpoints: &CodeBuddyAuthEndpoints,
    state: &AppState,
    query: Option<&str>,
) -> Result<Response, APIError> {
    let database = require_database(state, constants::database::OAUTH_SESSIONS_DATABASE_REQUIRED)?;
    cleanup_expired_sessions(database, now_ms() - SESSION_TTL_MS).await?;
    let authorization = request_authorization(flavor, endpoints)
        .await
        .map_err(|message| {
            APIError::new(
                500,
                format!(
                    "Failed to initiate {} login: {message}",
                    flavor.display_name()
                ),
            )
        })?;
    save_session(database, &authorization.state, "", "", "").await?;
    let body = CodeBuddyLoginResponse {
        authorize_url: authorization.authorize_url,
        state: authorization.state,
    };

    if query_params(query).get("format").map(String::as_str) == Some("json") {
        return Ok(Json(body).into_response());
    }
    Ok(Redirect::to(&body.authorize_url).into_response())
}

async fn global_poll(
    Extension(endpoints): Extension<CodeBuddyAuthEndpoints>,
    State(state): State<AppState>,
    RawQuery(query): RawQuery,
    body: Bytes,
) -> Result<Json<PollResponse>, APIError> {
    poll(Flavor::Global, &endpoints, &state, query.as_deref(), &body).await
}

async fn cn_poll(
    Extension(endpoints): Extension<CodeBuddyAuthEndpoints>,
    State(state): State<AppState>,
    RawQuery(query): RawQuery,
    body: Bytes,
) -> Result<Json<PollResponse>, APIError> {
    poll(Flavor::China, &endpoints, &state, query.as_deref(), &body).await
}

async fn poll(
    flavor: Flavor,
    endpoints: &CodeBuddyAuthEndpoints,
    state: &AppState,
    query: Option<&str>,
    body: &[u8],
) -> Result<Json<PollResponse>, APIError> {
    let state_token = query_params(query)
        .get("state")
        .cloned()
        .or_else(|| state_from_body(body))
        .ok_or_else(|| APIError::new(400, constants::providers::codebuddy::MISSING_STATE))?;
    let database = require_database(state, constants::database::OAUTH_SESSIONS_DATABASE_REQUIRED)?;
    let Some(_) = claim_session(database, &state_token).await? else {
        return Ok(Json(PollResponse::pending(Some(
            constants::providers::codebuddy::SESSION_EXPIRED.to_owned(),
        ))));
    };

    match poll_token(flavor, endpoints, &state_token).await {
        Ok(None) | Err(PollFailure::Pending) => {
            release_session(database, &state_token).await?;
            Ok(Json(PollResponse::pending(None)))
        }
        Err(PollFailure::Message(message)) => {
            release_session(database, &state_token).await?;
            Ok(Json(PollResponse::pending(Some(message))))
        }
        Err(PollFailure::Fatal(error)) => {
            release_session(database, &state_token).await?;
            Err(error)
        }
        Ok(Some(tokens)) => {
            let timestamp = now_ms();
            let id = format!("{}_{timestamp}", flavor.provider_id());
            let name = format!(
                "{} (Account #{})",
                flavor.display_name(),
                account_suffix(timestamp)
            );
            let provider = ConnectedProvider {
                id: id.clone(),
                provider_id: flavor.provider_id().to_owned(),
                name: name.clone(),
                category: "oauth".to_owned(),
                protocol: Protocol::OpenAI,
                enabled: true,
                created_at: timestamp,
            };
            upsert_codebuddy_connection(
                database,
                &CodeBuddyConnectionWrite {
                    id,
                    provider_id: flavor.provider_id().to_owned(),
                    name,
                    access_token: tokens.access_token,
                    refresh_token: tokens.refresh_token,
                    token_expires_at: Some(timestamp + tokens.expires_in * 1000),
                    base_url: flavor.base_url().to_owned(),
                },
            )
            .await?;
            delete_session(database, &state_token).await?;
            Ok(Json(PollResponse::ok(provider)))
        }
    }
}

struct Authorization {
    state: String,
    authorize_url: String,
}

async fn request_authorization(
    flavor: Flavor,
    endpoints: &CodeBuddyAuthEndpoints,
) -> Result<Authorization, String> {
    let client = UpstreamClient::new().map_err(|error| error.message().to_owned())?;
    let response = client
        .raw()
        .post(flavor.state_url(endpoints))
        .timeout(REQUEST_TIMEOUT)
        .headers(headers(flavor, endpoints))
        .json(&serde_json::json!({}))
        .send()
        .await
        .map_err(|error| format!("CodeBuddy state request failed: {error}"))?;
    let status = response.status();
    if !status.is_success() {
        let detail = response.text().await.unwrap_or_default();
        return Err(format!(
            "CodeBuddy state request failed ({}): {detail}",
            status.as_u16()
        ));
    }
    let payload = response
        .json::<Value>()
        .await
        .map_err(|error| format!("CodeBuddy state response could not be decoded: {error}"))?;
    if payload.get("code").and_then(Value::as_i64) != Some(0) {
        return Err(format!(
            "CodeBuddy state error: {}",
            payload
                .get("msg")
                .and_then(Value::as_str)
                .unwrap_or("missing state/authUrl")
        ));
    }

    let data = payload.get("data").unwrap_or(&Value::Null);
    let state = non_empty_string(data, "state")
        .ok_or_else(|| "CodeBuddy state response is missing state".to_owned())?;
    let authorize_url = non_empty_string(data, "authUrl")
        .ok_or_else(|| "CodeBuddy state response is missing authUrl".to_owned())?;
    Ok(Authorization {
        state,
        authorize_url,
    })
}

struct CodeBuddyTokens {
    access_token: String,
    refresh_token: Option<String>,
    expires_in: i64,
}

async fn poll_token(
    flavor: Flavor,
    endpoints: &CodeBuddyAuthEndpoints,
    state: &str,
) -> Result<Option<CodeBuddyTokens>, PollFailure> {
    let mut url = url::Url::parse(flavor.token_url(endpoints)).map_err(|error| {
        PollFailure::Fatal(APIError::new(
            500,
            constants::providers::could_not_build_request(error),
        ))
    })?;
    url.query_pairs_mut().append_pair("state", state);
    let client = UpstreamClient::new().map_err(PollFailure::Fatal)?;
    let response = client
        .raw()
        .get(url)
        .timeout(REQUEST_TIMEOUT)
        .headers(headers(flavor, endpoints))
        .send()
        .await
        .map_err(|error| PollFailure::Message(format!("Request failed: {error}")))?;
    let status = response.status();
    if status.as_u16() == 202 || status.as_u16() == 404 {
        return Ok(None);
    }
    if !status.is_success() {
        return Err(PollFailure::Message(format!(
            "Request failed ({})",
            status.as_u16()
        )));
    }
    let payload = response.json::<Value>().await.map_err(|error| {
        PollFailure::Message(format!(
            "CodeBuddy token response could not be decoded: {error}"
        ))
    })?;
    let code = response_code(&payload);
    if code == Some(11217) {
        return Ok(None);
    }
    if code != Some(0) {
        return Err(PollFailure::Message(
            payload
                .get("msg")
                .and_then(Value::as_str)
                .unwrap_or("unknown_error")
                .to_owned(),
        ));
    }

    let data = payload.get("data").unwrap_or(&Value::Null);
    let access_token = non_empty_string(data, "accessToken").ok_or_else(|| {
        PollFailure::Message(constants::providers::codebuddy::EMPTY_TOKEN.to_owned())
    })?;
    Ok(Some(CodeBuddyTokens {
        access_token,
        refresh_token: non_empty_string(data, "refreshToken"),
        expires_in: data
            .get("expiresIn")
            .and_then(Value::as_i64)
            .filter(|seconds| *seconds > 0)
            .unwrap_or(86_400),
    }))
}

fn headers(flavor: Flavor, endpoints: &CodeBuddyAuthEndpoints) -> reqwest::header::HeaderMap {
    use reqwest::header::{HeaderMap, HeaderName, HeaderValue};

    let mut headers = HeaderMap::new();
    for (name, value) in [
        ("accept", "application/json"),
        ("content-type", "application/json"),
        ("x-requested-with", "XMLHttpRequest"),
        ("x-no-authorization", "true"),
        ("x-no-user-id", "true"),
        ("x-no-enterprise-id", "true"),
        ("x-no-department-info", "true"),
        ("x-product", "SaaS"),
    ] {
        headers.insert(
            HeaderName::from_static(name),
            HeaderValue::from_static(value),
        );
    }
    headers.insert(
        reqwest::header::ORIGIN,
        HeaderValue::from_str(flavor.origin(endpoints))
            .unwrap_or_else(|_| HeaderValue::from_static("https://www.codebuddy.ai")),
    );
    headers.insert(
        reqwest::header::REFERER,
        HeaderValue::from_str(&format!("{}/", flavor.origin(endpoints)))
            .unwrap_or_else(|_| HeaderValue::from_static("https://www.codebuddy.ai/")),
    );
    headers.insert(
        HeaderName::from_static("x-domain"),
        HeaderValue::from_str(flavor.domain(endpoints))
            .unwrap_or_else(|_| HeaderValue::from_static("www.codebuddy.ai")),
    );
    headers.insert(
        reqwest::header::USER_AGENT,
        HeaderValue::from_static(flavor.user_agent()),
    );
    headers
}

fn response_code(payload: &Value) -> Option<i64> {
    payload
        .get("code")
        .or_else(|| {
            payload
                .get("response")
                .and_then(|response| response.get("data"))
                .and_then(|data| data.get("code"))
        })
        .or_else(|| {
            payload
                .get("response")
                .and_then(|response| response.get("code"))
        })
        .and_then(Value::as_i64)
}

fn non_empty_string(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}
