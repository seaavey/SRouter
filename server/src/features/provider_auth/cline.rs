//! The Cline device flow: the operator approves in a browser while this server
//! polls WorkOS and then registers the tokens with Cline.
//!
//! The session row carries the WorkOS `device_code`, which is what the poll
//! needs, so `device` stores it through `save_device_session` and `poll` claims
//! it before every upstream round trip.
//!
//! Oracle: `apps/api/src/logic/auth.logic.ts` (`InitiateClineDeviceAuth`,
//! `PollClineDeviceToken`).

use std::time::Duration;

use axum::body::Bytes;
use axum::extract::{RawQuery, State};
use axum::routing::get;
use axum::{Json, Router};
use serde::Serialize;
use serde_json::{Value, json};

use super::{
    ConnectedProvider, PollFailure, PollResponse, Protocol, account_suffix, query_params,
    require_database, state_from_body, text_field,
};
use crate::clock::now_ms;
use crate::constants;
use crate::error::APIError;
use crate::features::providers::cline::executor::{endpoint_url, parse_expiry_ms};
use crate::features::providers::cline::types::{
    CLINE_PROVIDER, CLINE_WORKOS_CLIENT_ID, ClineEndpoints,
};
use crate::infrastructure::database::AppDatabase;
use crate::infrastructure::database::oauth_sessions::{
    SESSION_TTL_MS, claim_session, cleanup_expired_sessions, delete_session, release_session,
    save_device_session,
};
use crate::infrastructure::database::providers::{ClineConnectionWrite, upsert_cline_connection};
use crate::infrastructure::upstream::UpstreamClient;
use crate::state::AppState;

/// Upper bound for one WorkOS or Cline call, matching the device-flow timeout
/// the official client ships (30 s).
const DEVICE_REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

/// Routes the admin session guards: starting a device authorization and polling
/// it. Cline has no login or callback route in the contract.
pub fn create_cline_login_router() -> Router<AppState> {
    Router::new()
        .route("/auth/cline/device", get(device))
        .route("/auth/cline/poll", get(poll).post(poll))
}

/// What `GET /v1/auth/cline/device` answers with.
#[derive(Serialize, schemars::JsonSchema)]
pub(crate) struct DeviceResponse {
    authorize_url: String,
    state: String,
    user_code: String,
    expires_in: i64,
    interval: i64,
}

/// Starts a device authorization: one WorkOS call plus the session row the poll
/// reads the device code from.
async fn device(State(state): State<AppState>) -> Result<Json<DeviceResponse>, APIError> {
    let database = require_database(
        &state,
        constants::database::OAUTH_SESSIONS_DATABASE_REQUIRED,
    )?;
    cleanup_expired_sessions(database, now_ms() - SESSION_TTL_MS).await?;

    let endpoints = cline_endpoints(&state);
    let client = UpstreamClient::new()?;
    let body = url::form_urlencoded::Serializer::new(String::new())
        .append_pair("client_id", CLINE_WORKOS_CLIENT_ID)
        .finish();
    let response = client
        .raw()
        .post(&endpoints.workos_device_url)
        .timeout(DEVICE_REQUEST_TIMEOUT)
        .header(
            reqwest::header::CONTENT_TYPE,
            "application/x-www-form-urlencoded",
        )
        .body(body)
        .send()
        .await
        .map_err(|error| device_auth_transport_failed(&error))?;
    let status = response.status();
    let payload = response.json::<Value>().await.unwrap_or(Value::Null);

    if !status.is_success() {
        return Err(APIError::new(
            400,
            constants::providers::cline::device_auth_failed(status.as_u16()),
        ));
    }

    let device_code = text_field(&payload, "device_code").ok_or_else(|| {
        APIError::new(
            400,
            constants::providers::cline::device_auth_failed(status.as_u16()),
        )
    })?;
    let user_code = text_field(&payload, "user_code").ok_or_else(|| {
        APIError::new(
            400,
            constants::providers::cline::device_auth_failed(status.as_u16()),
        )
    })?;
    let authorize_url = text_field(&payload, "verification_uri_complete")
        .or_else(|| text_field(&payload, "verification_uri"))
        .ok_or_else(|| {
            APIError::new(
                400,
                constants::providers::cline::device_auth_failed(status.as_u16()),
            )
        })?;

    let state_token = uuid::Uuid::new_v4().to_string();
    save_device_session(database, &state_token, &device_code, CLINE_WORKOS_CLIENT_ID).await?;

    Ok(Json(DeviceResponse {
        authorize_url,
        state: state_token,
        user_code,
        expires_in: number_field(&payload, "expires_in").unwrap_or(300),
        interval: number_field(&payload, "interval").unwrap_or(5),
    }))
}

/// Polls WorkOS once, then registers the WorkOS tokens with Cline when they
/// landed. The session is claimed for the round trip so two polls cannot
/// exchange the same device code twice.
async fn poll(
    State(state): State<AppState>,
    RawQuery(query): RawQuery,
    body: Bytes,
) -> Result<Json<PollResponse>, APIError> {
    let state_token = query_params(query.as_deref())
        .get("state")
        .cloned()
        .or_else(|| state_from_body(&body))
        .ok_or_else(|| APIError::new(400, constants::providers::cline::MISSING_STATE))?;
    let database = require_database(
        &state,
        constants::database::OAUTH_SESSIONS_DATABASE_REQUIRED,
    )?;

    let Some(session) = claim_session(database, &state_token).await? else {
        return Ok(Json(PollResponse::pending(Some(
            constants::providers::cline::SESSION_EXPIRED.to_owned(),
        ))));
    };
    let Some(device_code) = session.device_code.filter(|code| !code.is_empty()) else {
        release_session(database, &state_token).await?;
        return Ok(Json(PollResponse::pending(Some(
            constants::providers::cline::SESSION_EXPIRED.to_owned(),
        ))));
    };

    match connect(&state, database, &state_token, &device_code).await {
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

/// Runs one exchange: authenticate the device code, register with Cline, store
/// the connection. The session row is deleted here, once the tokens are stored.
async fn connect(
    state: &AppState,
    database: &AppDatabase,
    session_state: &str,
    device_code: &str,
) -> Result<ConnectedProvider, PollFailure> {
    let endpoints = cline_endpoints(state);
    let workos = authenticate(&endpoints, device_code).await?;
    let registered = register(&endpoints, &workos.access_token, &workos.refresh_token).await?;

    delete_session(database, session_state)
        .await
        .map_err(PollFailure::Fatal)?;

    let timestamp = now_ms();
    let user_info = registered.user_info;
    let account_id = user_info
        .cline_user_id
        .filter(|id| !id.is_empty())
        .unwrap_or_else(|| format!("cline_{timestamp}"));
    let name = user_info
        .name
        .filter(|value| !value.is_empty())
        .or_else(|| user_info.email.clone().filter(|value| !value.is_empty()))
        .unwrap_or_else(|| format!("Cline (Account #{})", account_suffix(timestamp)));
    let write = ClineConnectionWrite {
        id: account_id.clone(),
        name: name.clone(),
        access_token: registered.access_token,
        refresh_token: registered.refresh_token,
        token_expires_at: registered.expires_at_ms,
        email: user_info.email.unwrap_or_default(),
    };

    upsert_cline_connection(database, &write)
        .await
        .map_err(PollFailure::Fatal)?;

    // A connection exists now, so fill the catalog before the operator's next
    // request reads it instead of serving an empty Cline list.
    state.providers.maybe_refresh_catalogs(true).await;

    Ok(ConnectedProvider {
        id: account_id,
        provider_id: CLINE_PROVIDER.id.to_owned(),
        name,
        category: "oauth".to_owned(),
        protocol: Protocol::OpenAI,
        enabled: true,
        created_at: timestamp,
    })
}

/// The WorkOS device token, once the browser has approved.
struct WorkosTokens {
    access_token: String,
    refresh_token: String,
}

/// Exchanges the device code for WorkOS tokens. `authorization_pending` and
/// `slow_down` mean the browser has not approved yet; every other upstream
/// error is reported back to the client as the reason.
async fn authenticate(
    endpoints: &ClineEndpoints,
    device_code: &str,
) -> Result<WorkosTokens, PollFailure> {
    let client = UpstreamClient::new().map_err(PollFailure::Fatal)?;
    let body = url::form_urlencoded::Serializer::new(String::new())
        .append_pair("grant_type", "urn:ietf:params:oauth:grant-type:device_code")
        .append_pair("device_code", device_code)
        .append_pair("client_id", CLINE_WORKOS_CLIENT_ID)
        .finish();
    let response = client
        .raw()
        .post(&endpoints.workos_authenticate_url)
        .timeout(DEVICE_REQUEST_TIMEOUT)
        .header(
            reqwest::header::CONTENT_TYPE,
            "application/x-www-form-urlencoded",
        )
        .body(body)
        .send()
        .await
        .map_err(|error| {
            PollFailure::Message(constants::providers::cline::poll_transport_failed(&error))
        })?;
    let status = response.status();
    let payload = response.json::<Value>().await.unwrap_or(Value::Null);

    if !status.is_success() {
        return match text_field(&payload, "error").as_deref() {
            Some("authorization_pending" | "slow_down") => Err(PollFailure::Pending),
            _ => Err(PollFailure::Message(
                text_field(&payload, "error_description")
                    .or_else(|| text_field(&payload, "error"))
                    .unwrap_or_else(|| constants::providers::cline::poll_failed(status.as_u16())),
            )),
        };
    }

    let access_token = text_field(&payload, "access_token").ok_or_else(|| {
        PollFailure::Message(constants::providers::cline::INVALID_WORKOS_TOKEN_RESPONSE.to_owned())
    })?;
    let refresh_token = text_field(&payload, "refresh_token").ok_or_else(|| {
        PollFailure::Message(constants::providers::cline::INVALID_WORKOS_TOKEN_RESPONSE.to_owned())
    })?;

    Ok(WorkosTokens {
        access_token,
        refresh_token,
    })
}

/// The Cline-side tokens and identity a successful register answered with.
struct RegisteredTokens {
    access_token: String,
    refresh_token: Option<String>,
    expires_at_ms: Option<i64>,
    user_info: UserInfo,
}

/// Registers the WorkOS tokens with Cline, which returns the account identity
/// and the Cline-side tokens the connection stores.
async fn register(
    endpoints: &ClineEndpoints,
    workos_access_token: &str,
    workos_refresh_token: &str,
) -> Result<RegisteredTokens, PollFailure> {
    let client = UpstreamClient::new().map_err(PollFailure::Fatal)?;
    let response = client
        .raw()
        .post(endpoint_url(&endpoints.api_base_url, "auth/register"))
        .timeout(DEVICE_REQUEST_TIMEOUT)
        .json(&json!({
            "accessToken": workos_access_token,
            "refreshToken": workos_refresh_token,
        }))
        .send()
        .await
        .map_err(|error| {
            PollFailure::Message(constants::providers::cline::register_transport_failed(
                &error,
            ))
        })?;
    let status = response.status();
    let payload = response.json::<Value>().await.unwrap_or(Value::Null);
    let data = payload.get("data").cloned().unwrap_or(Value::Null);
    let access_token = text_field(&data, "accessToken");

    let accepted = status.is_success()
        && payload.get("success").and_then(Value::as_bool) == Some(true)
        && access_token.is_some()
        // A connection without a refresh token can never be refreshed, so the
        // official client refuses the registration here (oracle `cline.ts`).
        && text_field(&data, "refreshToken").is_some();

    if !accepted {
        return Err(PollFailure::Message(
            constants::providers::cline::register_failed(status.as_u16()),
        ));
    }

    let user_info = data.get("userInfo").cloned().unwrap_or(Value::Null);

    Ok(RegisteredTokens {
        access_token: format!("workos:{}", access_token.unwrap_or_default()),
        refresh_token: text_field(&data, "refreshToken"),
        expires_at_ms: data.get("expiresAt").and_then(parse_expiry_ms),
        user_info: UserInfo {
            cline_user_id: text_field(&user_info, "clineUserId"),
            name: text_field(&user_info, "name"),
            email: text_field(&user_info, "email"),
        },
    })
}

#[derive(Default)]
struct UserInfo {
    cline_user_id: Option<String>,
    name: Option<String>,
    email: Option<String>,
}

fn device_auth_transport_failed(error: &reqwest::Error) -> APIError {
    APIError::new(
        400,
        constants::providers::cline::device_auth_transport_failed(error),
    )
}

fn cline_endpoints(state: &AppState) -> ClineEndpoints {
    state.providers.cline_endpoints().unwrap_or_default()
}

fn number_field(value: &Value, key: &str) -> Option<i64> {
    value
        .get(key)
        .and_then(Value::as_i64)
        .filter(|number| *number > 0)
}
