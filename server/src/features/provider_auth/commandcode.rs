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
    COMMANDCODE_GENERATE_URL, COMMANDCODE_PROVIDER, COMMANDCODE_STUDIO_AUTH_URL,
    COMMANDCODE_STUDIO_ORIGIN, CommandCodeEndpoints,
};
use crate::http::middleware::cors::get_allowed_origin;
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
        .route("/auth/commandcode/callback", post(callback))
        .layer(Extension(endpoints))
}

/// Starts a sign-in: a state row plus the studio URL that carries our callback.
async fn login(State(state): State<AppState>) -> Result<Json<LoginResponse>, APIError> {
    let database = require_database(&state, constants::providers::oauth::DATABASE_REQUIRED)?;
    // The browser's fetch is cross-origin; without this origin in the allowlist
    // it is blocked before it reaches us, which no error page can report.
    if get_allowed_origin(Some(COMMANDCODE_STUDIO_ORIGIN), &state.config.cors_origins).is_none() {
        return Err(APIError::new(
            400,
            constants::providers::commandcode::STUDIO_ORIGIN_NOT_ALLOWED,
        ));
    }
    sweep_expired_sessions(database).await?;

    let redirect_uri = default_callback_uri(&state.config, "/auth/commandcode/callback");
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
