//! The Qoder device flow: start a login, poll it until the browser approves,
//! and store the resulting connection.
//!
//! The upstream talks a device flow rather than a redirect: the browser opens
//! `qoder.com/device/selectAccounts`, and this server polls `deviceToken/poll`
//! with the state as nonce until the approval lands. The session row carries the
//! PKCE verifier the poll needs and is claimed while one poll is in flight.

use axum::body::Bytes;
use axum::extract::{RawQuery, State};
use axum::response::{IntoResponse, Redirect, Response};
use axum::routing::get;
use axum::{Json, Router};
use serde::Serialize;
use serde_json::Value;

use super::{
    ConnectedProvider, PollFailure, PollResponse, Protocol, error_page, parse_callback,
    pkce_challenge, pkce_verifier, query_params, state_from_body, success_page,
};
use crate::clock::now_ms;
use crate::constants;
use crate::error::APIError;
use crate::features::providers::qoder::executor::machine_id_for;
use crate::features::providers::qoder::types::{QODER_PROVIDER, QODER_USER_AGENT, QoderEndpoints};
use crate::infrastructure::database::AppDatabase;
use crate::infrastructure::database::oauth_sessions::{
    SESSION_TTL_MS, claim_session, cleanup_expired_sessions, delete_session, release_session,
    save_session,
};
use crate::infrastructure::database::providers::{QoderConnectionWrite, upsert_qoder_connection};
use crate::infrastructure::upstream::UpstreamClient;
use crate::state::AppState;

/// Default lifetime of a device token when the upstream does not state one.
const DEFAULT_TOKEN_TTL_MS: i64 = 30 * 24 * 60 * 60 * 1000;

/// The success message the Qoder callback answers with (frozen wording).
const QODER_OAUTH_SUCCESS: &str = "Login Qoder Berhasil!";

/// Routes the admin session guards: starting a login and polling it.
pub fn create_qoder_login_router() -> Router<AppState> {
    Router::new()
        .route("/auth/qoder/login", get(login))
        .route("/auth/qoder/poll", get(poll).post(poll))
}

/// The public JSON callback route, which the contract leaves unguarded.
pub fn create_qoder_callback_router() -> Router<AppState> {
    Router::new().route("/auth/qoder/callback", get(callback).post(callback))
}

/// The browser-facing callback page, mounted at the application root beside the
/// OpenAI one. Qoder is a device flow, so the browser normally lands on
/// `qoder.com`; this route still finishes a redirected callback with an HTML
/// result instead of JSON. Oracle: `apps/api/src/index.ts` mounts the same path
/// on the OAuth listener.
pub fn create_qoder_callback_pages_router() -> Router<AppState> {
    Router::new().route(
        "/auth/qoder/callback",
        get(callback_page).post(callback_page),
    )
}

/// What `GET /v1/auth/qoder/login` answers with. The field names are the ones
/// the web client reads, so they stay camelCase.
#[derive(Serialize)]
struct LoginResponse {
    #[serde(rename = "authorizeUrl")]
    authorize_url: String,
    state: String,
    #[serde(rename = "codeVerifier")]
    code_verifier: String,
    #[serde(rename = "redirectUri")]
    redirect_uri: String,
}

#[derive(Serialize)]
struct CallbackResponse {
    success: bool,
    message: &'static str,
    provider: ConnectedProvider,
}

/// Starts a login: a session row plus the URL the browser opens.
async fn login(
    State(state): State<AppState>,
    RawQuery(query): RawQuery,
) -> Result<Response, APIError> {
    let params = query_params(query.as_deref());
    let database = require_database(&state)?;
    cleanup_expired_sessions(database, now_ms() - SESSION_TTL_MS).await?;

    let code_verifier = pkce_verifier();
    let state_token = uuid::Uuid::new_v4().to_string();
    save_session(
        database,
        &state_token,
        &code_verifier,
        params.get("client_id").map(String::as_str).unwrap_or(""),
        params.get("redirect_uri").map(String::as_str).unwrap_or(""),
    )
    .await?;

    let endpoints = qoder_endpoints(&state);
    let authorize_url = endpoints.authorize_url(
        &pkce_challenge(&code_verifier),
        &machine_id_for(database).await?,
        &state_token,
    );
    let body = LoginResponse {
        authorize_url,
        state: state_token,
        code_verifier,
        redirect_uri: params.get("redirect_uri").cloned().unwrap_or_default(),
    };

    if params.get("format").map(String::as_str) == Some("json") {
        return Ok(Json(body).into_response());
    }

    Ok(Redirect::to(&body.authorize_url).into_response())
}

/// Polls the upstream until the browser approves, then stores the connection.
async fn poll(
    State(state): State<AppState>,
    RawQuery(query): RawQuery,
    body: Bytes,
) -> Result<Json<PollResponse>, APIError> {
    let state_token = query_params(query.as_deref())
        .get("state")
        .cloned()
        .or_else(|| state_from_body(&body))
        .ok_or_else(|| APIError::new(400, constants::providers::qoder::MISSING_STATE))?;
    let database = require_database(&state)?;

    let Some(session) = claim_session(database, &state_token).await? else {
        return Ok(Json(PollResponse::pending(Some(
            constants::providers::qoder::SESSION_EXPIRED.to_owned(),
        ))));
    };

    match connect(
        &state,
        database,
        &state_token,
        &state_token,
        &session.code_verifier,
    )
    .await
    {
        Ok(provider) => Ok(Json(PollResponse::ok(provider))),
        Err(PollFailure::Pending) => {
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
    }
}

/// The public JSON callback: the same exchange, driven by a pasted callback URL.
async fn callback(
    State(state): State<AppState>,
    RawQuery(query): RawQuery,
    body: Bytes,
) -> Result<Json<CallbackResponse>, APIError> {
    let provider = complete_callback(&state, query.as_deref(), &body).await?;

    Ok(Json(CallbackResponse {
        success: true,
        message: QODER_OAUTH_SUCCESS,
        provider,
    }))
}

/// The browser callback: the same completion, rendered as a page.
async fn callback_page(
    State(state): State<AppState>,
    RawQuery(query): RawQuery,
    body: Bytes,
) -> Response {
    match complete_callback(&state, query.as_deref(), &body).await {
        Ok(provider) => success_page(QODER_OAUTH_SUCCESS, &provider),
        Err(error) => error_page(&error),
    }
}

/// Claims the session and runs the exchange. The session is consumed only after
/// the connection is stored, so a failed attempt can be retried instead of
/// being burned.
async fn complete_callback(
    state: &AppState,
    query: Option<&str>,
    body: &[u8],
) -> Result<ConnectedProvider, APIError> {
    let parsed = parse_callback(query, body)?;
    let database = require_database(state)?;

    let session = claim_session(database, &parsed.state)
        .await?
        .ok_or_else(|| APIError::new(500, constants::providers::qoder::SESSION_EXPIRED))?;

    connect(
        state,
        database,
        &parsed.state,
        &parsed.code,
        &session.code_verifier,
    )
    .await
    .map_err(|failure| match failure {
        PollFailure::Fatal(error) => error,
        PollFailure::Pending => APIError::new(500, constants::providers::qoder::SESSION_EXPIRED),
        PollFailure::Message(message) => APIError::new(500, message),
    })
}

/// Runs the exchange: poll the device token, resolve the identity, store it.
/// The session row is deleted here, where the connection is already stored.
async fn connect(
    state: &AppState,
    database: &AppDatabase,
    session_state: &str,
    nonce: &str,
    code_verifier: &str,
) -> Result<ConnectedProvider, PollFailure> {
    let endpoints = qoder_endpoints(state);
    let token = poll_device_token(&endpoints, nonce, code_verifier)
        .await
        .map_err(PollFailure::Message)?
        .ok_or(PollFailure::Pending)?;
    let user_info = fetch_user_info(&endpoints, &token.token).await;
    let user_id = token
        .user_id
        .filter(|value| !value.is_empty())
        .unwrap_or(user_info.user_id);

    if user_id.is_empty() {
        return Err(PollFailure::Message(
            constants::providers::qoder::MISSING_UID.to_owned(),
        ));
    }

    delete_session(database, session_state)
        .await
        .map_err(PollFailure::Fatal)?;

    let timestamp = now_ms();
    let id = format!("qoder_{timestamp}");
    let name = if user_info.name.is_empty() {
        format!("Qoder (Account #{})", account_suffix(timestamp))
    } else {
        format!("Qoder ({})", user_info.name)
    };
    let write = QoderConnectionWrite {
        id: id.clone(),
        name: name.clone(),
        account_name: user_info.name.clone(),
        access_token: token.token,
        refresh_token: token.refresh_token,
        token_expires_at: Some(token.expires_at_ms),
        user_id,
        email: user_info.email.clone(),
        organization_id: user_info.organization_id,
    };

    upsert_qoder_connection(database, &write)
        .await
        .map_err(PollFailure::Fatal)?;

    // The catalog has a connection now, so fill it from the live model list
    // before the operator's next request reads it.
    state.providers.maybe_refresh_catalogs(true).await;

    Ok(ConnectedProvider {
        id,
        provider_id: QODER_PROVIDER.id.to_owned(),
        name,
        category: "oauth".to_owned(),
        protocol: Protocol::OpenAI,
        enabled: true,
        created_at: timestamp,
    })
}

/// The device token, once the browser has approved.
struct DeviceToken {
    token: String,
    refresh_token: Option<String>,
    user_id: Option<String>,
    expires_at_ms: i64,
}

/// Asks the upstream whether the login was approved. `Ok(None)` means the
/// browser is still on the consent screen.
async fn poll_device_token(
    endpoints: &QoderEndpoints,
    nonce: &str,
    code_verifier: &str,
) -> Result<Option<DeviceToken>, String> {
    let url = format!(
        "{}{}",
        endpoints.device_token_url,
        endpoints.device_poll_query(nonce, code_verifier)
    );
    let client = UpstreamClient::new().map_err(|error| error.message().to_owned())?;
    let response = client
        .raw()
        .get(&url)
        .timeout(client.request_timeout())
        .header("User-Agent", QODER_USER_AGENT)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|error| constants::providers::qoder::poll_transport_failed(&error))?;
    let status = response.status();

    if status.as_u16() == 202 || status.as_u16() == 404 {
        return Ok(None);
    }
    if !status.is_success() {
        let detail = response.text().await.unwrap_or_default();
        return Err(constants::providers::qoder::poll_failed(
            status.as_u16(),
            &detail,
        ));
    }

    let body = response
        .json::<Value>()
        .await
        .map_err(|error| constants::providers::qoder::poll_failed(200, &error.to_string()))?;
    let token = body
        .get("token")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| constants::providers::qoder::EMPTY_TOKEN.to_owned())?;

    Ok(Some(DeviceToken {
        token: token.to_owned(),
        refresh_token: body
            .get("refresh_token")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .map(str::to_owned),
        user_id: body
            .get("user_id")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .map(str::to_owned),
        expires_at_ms: token_expiry_ms(&body),
    }))
}

/// The stored identity behind a token. A failed lookup yields empty fields
/// instead of failing the login: the poll usually carries the user id, and the
/// name only labels the connection.
async fn fetch_user_info(endpoints: &QoderEndpoints, token: &str) -> UserInfo {
    let Ok(client) = UpstreamClient::new() else {
        return UserInfo::default();
    };
    let response = client
        .raw()
        .get(&endpoints.userinfo_url)
        .timeout(client.request_timeout())
        .header("User-Agent", QODER_USER_AGENT)
        .header("Accept", "application/json")
        .header("Authorization", format!("Bearer {token}"))
        .send()
        .await;

    let Ok(response) = response else {
        return UserInfo::default();
    };
    if !response.status().is_success() {
        return UserInfo::default();
    }
    let Ok(body) = response.json::<Value>().await else {
        return UserInfo::default();
    };
    let text = |keys: &[&str]| {
        keys.iter()
            .find_map(|key| body.get(*key).and_then(Value::as_str))
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_owned)
            .unwrap_or_default()
    };

    UserInfo {
        user_id: text(&["id", "userId", "user_id"]),
        name: text(&["name", "username"]),
        email: text(&["email"]),
        organization_id: text(&["organization_id"]),
    }
}

#[derive(Default)]
struct UserInfo {
    user_id: String,
    name: String,
    email: String,
    organization_id: String,
}

/// When the device token stops working. The upstream may report seconds or
/// milliseconds, and a token without any expiry gets the documented 30 days.
fn token_expiry_ms(body: &Value) -> i64 {
    let now = now_ms();

    if let Some(seconds) = body.get("expires_in").and_then(Value::as_i64)
        && seconds > 0
    {
        return now + seconds * 1000;
    }

    match body.get("expires_at").and_then(Value::as_i64) {
        Some(value) if value > 10_000_000_000 => value,
        Some(value) if value > 0 => value * 1000,
        _ => now + DEFAULT_TOKEN_TTL_MS,
    }
}

/// The last four digits of the timestamp, used to label an unnamed account.
fn account_suffix(timestamp: i64) -> String {
    let digits = timestamp.to_string();

    digits[digits.len().saturating_sub(4)..].to_owned()
}

fn qoder_endpoints(state: &AppState) -> QoderEndpoints {
    state.providers.qoder_endpoints().unwrap_or_default()
}

fn require_database(state: &AppState) -> Result<&AppDatabase, APIError> {
    state
        .database
        .as_ref()
        .ok_or_else(|| APIError::new(500, constants::database::OAUTH_SESSIONS_DATABASE_REQUIRED))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{account_suffix, token_expiry_ms};
    use crate::clock::now_ms;
    use crate::features::provider_auth::{
        CallbackParams, parse_callback, pkce_challenge, pkce_verifier,
    };

    #[test]
    fn the_challenge_is_the_s256_of_the_verifier() {
        // RFC 7636 appendix B, the reference vector for S256.
        let (verifier, expected) = (
            "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
        );

        assert_eq!(pkce_challenge(verifier), expected);
        assert_eq!(pkce_verifier().len(), 43, "RFC 7636 wants 43 characters");
    }

    #[test]
    fn an_account_without_a_name_gets_a_numbered_label() {
        let suffix = account_suffix(1_772_400_000_000);

        assert_eq!(suffix, "0000");
        assert_eq!(
            format!("Qoder (Account #{suffix})"),
            "Qoder (Account #0000)"
        );
    }

    #[test]
    fn a_token_expiry_prefers_seconds_then_falls_back_to_thirty_days() {
        let now = now_ms();

        assert_eq!(
            token_expiry_ms(&json!({"expires_in": 86400})),
            now + 86_400_000
        );
        assert_eq!(
            token_expiry_ms(&json!({"expires_at": 1_900_000_000_000_i64})),
            1_900_000_000_000
        );
        assert_eq!(token_expiry_ms(&json!({})), now + 30 * 24 * 60 * 60 * 1000);
    }

    #[test]
    fn the_callback_reads_code_and_state_from_any_carrier() {
        let from_query =
            parse_callback(Some("code=code-1&state=state-1"), b"").expect("query parameters parse");

        assert_eq!(from_query.code, "code-1");
        assert_eq!(from_query.state, "state-1");

        let from_url = parse_callback(
            None,
            br#"{"callback_url":"http://localhost:1455/auth/qoder/callback?code=code-2&state=state-2"}"#,
        )
        .expect("callback url parses");

        assert_eq!(
            from_url,
            CallbackParams {
                code: "code-2".to_owned(),
                state: "state-2".to_owned(),
            }
        );
    }

    #[test]
    fn a_callback_without_code_or_state_is_rejected() {
        let error = parse_callback(None, b"{}").expect_err("both fields are required");

        assert_eq!(error.status(), 400);
    }
}
