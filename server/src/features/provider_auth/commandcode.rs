//! The Command Code sign-in: the studio page hands a static key back, so there is
//! no OAuth exchange to run.
//!
//! The browser `POST`s the key to the public callback from the studio's origin,
//! and the callback parks it in the session row; the poll that follows owns the
//! exchange and stores the connection — the device-flow split, without a device.
//! Oracle: the Hermes `commandcode-oauth` plugin (`auth.py`), which opens
//! `https://commandcode.ai/studio/auth/cli?callback=…&state=…` and reads
//! `{"state", "apiKey"}` out of the posted body.

use std::time::Duration;

use axum::body::Bytes;
use axum::extract::{RawQuery, State};
use axum::http::header;
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Extension, Json, Router};
use serde_json::{Value, json};

use super::{
    ConnectedProvider, LoginResponse, PollResponse, Protocol, TokenImportResponse, account_suffix,
    default_callback_uri, parse_import_body, query_params, require_database, state_from_body,
    sweep_expired_sessions, text_field,
};
use crate::clock::now_ms;
use crate::constants;
use crate::error::APIError;
use crate::features::providers::commandcode::types::{
    COMMANDCODE_CALLBACK_PATH, COMMANDCODE_GENERATE_URL, COMMANDCODE_PROVIDER,
    COMMANDCODE_RELAY_PATH, COMMANDCODE_STUDIO_AUTH_URL, CommandCodeEndpoints,
};
use crate::http::middleware::cors::is_loopback_origin;
use crate::infrastructure::database::oauth_sessions::{
    claim_session, delete_session, record_session_key, release_session, save_session,
};
use crate::infrastructure::database::providers::{
    CommandCodeConnectionWrite, upsert_commandcode_connection,
};
use crate::infrastructure::upstream::UpstreamClient;
use crate::state::AppState;

/// Upper bound for the key probe; it is a round trip the operator is waiting on.
const WHOAMI_TIMEOUT: Duration = Duration::from_secs(10);

/// The relay source, kept next to the other server scripts instead of a string
/// literal so it stays runnable and reviewable on its own.
const COMMANDCODE_RELAY_SCRIPT: &str = include_str!("../../../scripts/commandcode-relay.mjs");

/// Routes the admin session guards: starting a sign-in and importing a key.
pub fn create_commandcode_login_router() -> Router<AppState> {
    create_commandcode_login_router_with_endpoints(CommandCodeEndpoints::default())
}

/// The same routes with injectable endpoints, so a test can point the key probe
/// and the catalog refresh at a fake relay.
pub fn create_commandcode_login_router_with_endpoints(
    endpoints: CommandCodeEndpoints,
) -> Router<AppState> {
    Router::new()
        .route("/auth/commandcode/login", get(login))
        .route("/auth/commandcode/poll", get(poll).post(poll))
        .route("/auth/commandcode/token", post(import_token))
        .layer(Extension(endpoints))
}

/// The public callback route: the studio page arrives without a session cookie.
pub fn create_commandcode_callback_router() -> Router<AppState> {
    create_commandcode_callback_router_with_endpoints(CommandCodeEndpoints::default())
}

pub fn create_commandcode_callback_router_with_endpoints(
    endpoints: CommandCodeEndpoints,
) -> Router<AppState> {
    Router::new()
        .route(COMMANDCODE_CALLBACK_PATH, post(callback))
        .route(COMMANDCODE_RELAY_PATH, get(relay))
        .layer(Extension(endpoints))
}

/// Starts a sign-in: a state row plus the studio URL that carries our callback.
///
/// The studio only accepts a loopback callback, so the client names one when
/// the gateway is not itself on the operator's machine; `callback` carries the
/// relay it started.
async fn login(
    State(state): State<AppState>,
    RawQuery(query): RawQuery,
) -> Result<Json<LoginResponse>, APIError> {
    let database = require_database(&state, constants::providers::oauth::DATABASE_REQUIRED)?;
    sweep_expired_sessions(database).await?;

    let requested = callback_override(query.as_deref())?;
    let redirect_uri = match requested {
        Some(callback) => callback,
        None => default_callback_uri(&state.config, COMMANDCODE_CALLBACK_PATH),
    };
    let state_token = uuid::Uuid::new_v4().to_string();
    save_session(database, &state_token, "", "commandcode", &redirect_uri).await?;

    let query = url::form_urlencoded::Serializer::new(String::new())
        .append_pair("callback", &redirect_uri)
        .append_pair("state", &state_token)
        .finish();

    Ok(Json(LoginResponse {
        authorize_url: format!("{COMMANDCODE_STUDIO_AUTH_URL}?{query}"),
        state: state_token,
        // No PKCE material is involved; the fields stay for the shared shape.
        code_verifier: String::new(),
        redirect_uri,
    }))
}

/// The `callback` the client named, if it named one at all. A key with no value
/// is a malformed request, not a request to fall back to the public default.
fn callback_override(query: Option<&str>) -> Result<Option<String>, APIError> {
    let Some(query) = query else {
        return Ok(None);
    };

    url::form_urlencoded::parse(query.as_bytes())
        .find(|(key, _)| key == "callback")
        .map(|(_, value)| loopback_callback(&value))
        .transpose()
}

/// The only callback the studio will post a key to, checked before it is stored
/// as the session's redirect: loopback host, this router's callback path, and
/// nothing appended. The path check keeps the route from being pointed at any
/// other local service.
fn loopback_callback(raw: &str) -> Result<String, APIError> {
    let invalid = || APIError::new(400, constants::providers::commandcode::INVALID_CALLBACK);
    let parsed = reqwest::Url::parse(raw.trim()).map_err(|_| invalid())?;
    let expected_path = format!("/v1{COMMANDCODE_CALLBACK_PATH}");
    let bare = parsed.path() == expected_path
        && parsed.query().is_none()
        && parsed.fragment().is_none()
        && parsed.username().is_empty()
        && parsed.password().is_none();

    if !bare || !is_loopback_origin(&parsed) {
        return Err(invalid());
    }

    Ok(parsed.to_string())
}

/// The relay the operator runs on their own machine. Served from here because
/// the dashboard hands out the `curl … | node` line that starts it.
async fn relay() -> impl IntoResponse {
    (
        [(header::CONTENT_TYPE, constants::headers::value::JAVASCRIPT)],
        COMMANDCODE_RELAY_SCRIPT,
    )
}

/// Takes the key the studio posted and parks it on the session row. The key is
/// verified first, so a bad one never reaches the database.
async fn callback(
    State(state): State<AppState>,
    Extension(endpoints): Extension<CommandCodeEndpoints>,
    body: Bytes,
) -> Result<Json<Value>, APIError> {
    let payload: Value = serde_json::from_slice(&body)
        .map_err(|_| APIError::new(400, constants::providers::oauth::INVALID_JSON_BODY))?;
    let missing = || APIError::new(400, constants::providers::oauth::CALLBACK_MISSING_PARAMS);
    let state_token = text_field(&payload, "state").ok_or_else(missing)?;
    let api_key = text_field(&payload, "apiKey").ok_or_else(missing)?;
    let database = require_database(&state, constants::providers::oauth::DATABASE_REQUIRED)?;

    let identity = whoami(&endpoints, &api_key).await?;
    let parked = json!({
        "api_key": api_key,
        "user_id": identity.0,
        "user_name": identity.1,
    });
    if !record_session_key(database, &state_token, &parked.to_string()).await? {
        return Err(APIError::new(
            400,
            constants::providers::oauth::INVALID_OR_EXPIRED_STATE,
        ));
    }

    Ok(Json(json!({ "success": true })))
}

/// One poll: claims the parked key, stores the connection, consumes the session.
async fn poll(
    State(state): State<AppState>,
    RawQuery(query): RawQuery,
    body: Bytes,
) -> Result<Json<PollResponse>, APIError> {
    let state_token = query_params(query.as_deref())
        .get("state")
        .cloned()
        .or_else(|| state_from_body(&body))
        .ok_or_else(|| APIError::new(400, constants::providers::oauth::MISSING_STATE))?;
    let database = require_database(
        &state,
        constants::database::OAUTH_SESSIONS_DATABASE_REQUIRED,
    )?;

    let Some(session) = claim_session(database, &state_token).await? else {
        return Ok(Json(PollResponse::pending(Some(
            constants::providers::oauth::SESSION_EXPIRED.to_owned(),
        ))));
    };
    let Some(parked) = session.device_code.filter(|payload| !payload.is_empty()) else {
        // The browser has not landed yet; let the next poll claim it again.
        release_session(database, &state_token).await?;

        return Ok(Json(PollResponse::pending(None)));
    };

    let Ok(parked) = serde_json::from_str::<Value>(&parked) else {
        delete_session(database, &state_token).await?;

        return Err(APIError::new(
            400,
            constants::providers::oauth::INVALID_OR_EXPIRED_STATE,
        ));
    };
    let api_key = text_field(&parked, "api_key")
        .ok_or_else(|| APIError::new(400, constants::providers::oauth::MISSING_ACCESS_TOKEN))?;
    let user_id = text_field(&parked, "user_id");
    let user_name = text_field(&parked, "user_name");

    let timestamp = now_ms();
    let id = format!("commandcode_{timestamp}");
    let name = user_name
        .clone()
        .filter(|name| !name.is_empty())
        .or_else(|| user_id.clone().filter(|id| !id.is_empty()))
        .unwrap_or_else(|| format!("Command Code (Account #{})", account_suffix(timestamp)));
    store_connection(database, &id, &name, &api_key, user_id, user_name).await?;
    delete_session(database, &state_token).await?;
    state.providers.maybe_refresh_catalogs(true).await;

    Ok(Json(PollResponse::ok(connected_provider(
        id, name, timestamp,
    ))))
}

/// Imports a key the operator pasted, for an install where the browser hand-off
/// cannot reach this server.
async fn import_token(
    State(state): State<AppState>,
    Extension(endpoints): Extension<CommandCodeEndpoints>,
    body: Bytes,
) -> Result<Json<TokenImportResponse>, APIError> {
    let database = require_database(&state, constants::providers::oauth::DATABASE_REQUIRED)?;
    let (_payload, api_key) = parse_import_body(&body)?;
    let identity = whoami(&endpoints, &api_key).await?;

    let timestamp = now_ms();
    let id = format!("commandcode_{timestamp}");
    let name = identity
        .1
        .clone()
        .filter(|name| !name.is_empty())
        .or_else(|| identity.0.clone().filter(|id| !id.is_empty()))
        .unwrap_or_else(|| format!("Command Code (Account #{})", account_suffix(timestamp)));
    store_connection(database, &id, &name, &api_key, identity.0, identity.1).await?;
    state.providers.maybe_refresh_catalogs(true).await;

    Ok(Json(TokenImportResponse {
        success: true,
        message: constants::providers::commandcode::TOKEN_IMPORT_SUCCESS,
        provider: connected_provider(id, name, timestamp),
    }))
}

async fn store_connection(
    database: &crate::infrastructure::database::AppDatabase,
    id: &str,
    name: &str,
    api_key: &str,
    user_id: Option<String>,
    user_name: Option<String>,
) -> Result<(), APIError> {
    upsert_commandcode_connection(
        database,
        &CommandCodeConnectionWrite {
            id: id.to_owned(),
            provider_id: COMMANDCODE_PROVIDER.id.to_owned(),
            name: name.to_owned(),
            access_token: api_key.to_owned(),
            user_id,
            user_name,
            base_url: COMMANDCODE_GENERATE_URL.to_owned(),
        },
    )
    .await
}

/// Confirms the key with `/alpha/whoami` and returns `(user id, user name)`, both
/// possibly empty. The key itself is never logged.
async fn whoami(
    endpoints: &CommandCodeEndpoints,
    api_key: &str,
) -> Result<(Option<String>, Option<String>), APIError> {
    let client = UpstreamClient::new()?;
    let response = client
        .raw()
        .get(&endpoints.whoami_url)
        .timeout(WHOAMI_TIMEOUT)
        .header(reqwest::header::ACCEPT, "application/json")
        .header(reqwest::header::USER_AGENT, "cli")
        .bearer_auth(api_key)
        .send()
        .await
        .map_err(|_| APIError::new(502, constants::providers::commandcode::KEY_CHECK_FAILED))?;
    let status = response.status();
    if !status.is_success() {
        return Err(APIError::new(
            400,
            constants::providers::commandcode::key_rejected(status.as_u16()),
        ));
    }
    let payload = response
        .json::<Value>()
        .await
        .map_err(|_| APIError::new(502, constants::providers::commandcode::KEY_CHECK_FAILED))?;
    let user = payload.get("user").cloned().unwrap_or(Value::Null);

    Ok((text_field(&user, "id"), text_field(&user, "userName")))
}

fn connected_provider(id: String, name: String, created_at: i64) -> ConnectedProvider {
    ConnectedProvider {
        id,
        provider_id: COMMANDCODE_PROVIDER.id.to_owned(),
        name,
        category: "oauth".to_owned(),
        protocol: Protocol::OpenAI,
        enabled: true,
        created_at,
    }
}
