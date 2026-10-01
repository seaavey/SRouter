//! The Qoder device flow: start a login, poll it until the browser approves,
//! and store the resulting connection.
//!
//! The upstream talks a device flow rather than a redirect: the browser opens
//! `qoder.com/device/selectAccounts`, and this server polls `deviceToken/poll`
//! with the state as nonce until the approval lands. The session row carries the
//! PKCE verifier the poll needs and is claimed while one poll is in flight.

use std::collections::HashMap;

use axum::body::Bytes;
use axum::extract::{RawQuery, State};
use axum::response::{IntoResponse, Redirect, Response};
use axum::routing::get;
use axum::{Json, Router};
use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use serde::Serialize;
use serde_json::Value;

use super::{
    ConnectedProvider, PollFailure, PollResponse, query_params, state_from_body, text_field,
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

/// Routes the admin session guards: starting a login and polling it.
pub fn create_qoder_login_router() -> Router<AppState> {
    Router::new()
        .route("/auth/qoder/login", get(login))
        .route("/auth/qoder/poll", get(poll).post(poll))
}

/// The public callback route, which the contract leaves unguarded.
pub fn create_qoder_callback_router() -> Router<AppState> {
    Router::new().route("/auth/qoder/callback", get(callback).post(callback))
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

    let code_verifier = random_challenge();
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
        &challenge(&code_verifier),
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

/// The public callback: the same exchange, driven by a pasted callback URL.
async fn callback(
    State(state): State<AppState>,
    RawQuery(query): RawQuery,
    body: Bytes,
) -> Result<Json<CallbackResponse>, APIError> {
    let parsed = parse_callback(query.as_deref(), &body)?;
    let database = require_database(&state)?;

    let session = claim_session(database, &parsed.state)
        .await?
        .ok_or_else(|| APIError::new(500, constants::providers::qoder::SESSION_EXPIRED))?;

    // The session is consumed only after the connection is stored, so a failed
    // attempt can be retried instead of being burned.
    let provider = connect(
        &state,
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
    })?;

    Ok(Json(CallbackResponse {
        success: true,
        message: "Login Qoder Berhasil!",
        provider,
    }))
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
        protocol: "openai".to_owned(),
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

#[derive(Debug, Default, PartialEq, Eq)]
struct CallbackParams {
    code: String,
    state: String,
}

/// Reads `code` and `state` from the query string, the JSON body, or a pasted
/// `callback_url`, which is how the web client finishes a redirected login.
fn parse_callback(query: Option<&str>, body: &[u8]) -> Result<CallbackParams, APIError> {
    let missing = || APIError::new(400, constants::providers::qoder::CALLBACK_MISSING_PARAMS);
    let query = query_params(query);
    let parsed: Value = serde_json::from_slice(body).unwrap_or(Value::Null);

    let mut code = query
        .get("code")
        .cloned()
        .or_else(|| text_field(&parsed, "code"));
    let mut state = query
        .get("state")
        .cloned()
        .or_else(|| text_field(&parsed, "state"));

    if let Some(callback_url) = text_field(&parsed, "callback_url")
        && let Ok(url) = url::Url::parse(&callback_url)
    {
        let from_url: HashMap<String, String> = url.query_pairs().into_owned().collect();
        code = code.or_else(|| from_url.get("code").cloned());
        state = state.or_else(|| from_url.get("state").cloned());
    }

    Ok(CallbackParams {
        code: code.ok_or_else(missing)?,
        state: state.ok_or_else(missing)?,
    })
}

/// A PKCE verifier of the length RFC 7636 requires: 43 base64url characters.
fn random_challenge() -> String {
    let mut bytes = [0u8; 32];
    let _ = getrandom::fill(&mut bytes);

    URL_SAFE_NO_PAD.encode(bytes)
}

/// The S256 challenge of a verifier, which is what the browser receives.
fn challenge(code_verifier: &str) -> String {
    use sha2::{Digest, Sha256};

    URL_SAFE_NO_PAD.encode(Sha256::digest(code_verifier.as_bytes()))
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

    use super::{
        CallbackParams, account_suffix, challenge, parse_callback, random_challenge,
        token_expiry_ms,
    };
    use crate::clock::now_ms;

    #[test]
    fn the_challenge_is_the_s256_of_the_verifier() {
        // RFC 7636 appendix B, the reference vector for S256.
        let (verifier, expected) = (
            "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
        );

        assert_eq!(challenge(verifier), expected);
        assert_eq!(random_challenge().len(), 43, "RFC 7636 wants 43 characters");
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
