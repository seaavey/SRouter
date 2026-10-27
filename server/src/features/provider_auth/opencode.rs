use std::time::Duration;

use axum::extract::State;
use axum::routing::get;
use axum::{Json, Router};
use serde::Serialize;
use serde_json::Value;

use super::{
    ConnectedProvider, PollResponse, Protocol, account_suffix, query_params, require_database,
    sweep_expired_sessions, text_field,
};
use crate::clock::now_ms;
use crate::constants;
use crate::error::APIError;
use crate::infrastructure::database::AppDatabase;
use crate::infrastructure::database::oauth_sessions::{
    claim_session, delete_session, release_session, save_device_session,
};
use crate::infrastructure::database::providers::{
    OpenCodeConnectionWrite, upsert_opencode_connection,
};
use crate::infrastructure::upstream::UpstreamClient;
use crate::state::AppState;

const DEVICE_REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const OPENCODE_CLIENT_ID: &str = "opencode-cli";
const OPENCODE_BASE_CONSOLE_URL: &str = "https://opencode.ai/console";

pub fn create_opencode_login_router() -> Router<AppState> {
    Router::new()
        .route("/auth/opencode/device", get(device))
        .route("/auth/opencode/poll", get(poll).post(poll))
}

#[derive(Serialize, specta::Type)]
pub(crate) struct OpenCodeDeviceResponse {
    authorize_url: String,
    state: String,
    user_code: String,
    #[specta(type = specta_typescript::Number)]
    expires_in: i64,
    #[specta(type = specta_typescript::Number)]
    interval: i64,
}

async fn device(State(state): State<AppState>) -> Result<Json<OpenCodeDeviceResponse>, APIError> {
    let database = require_database(
        &state,
        constants::database::OAUTH_SESSIONS_DATABASE_REQUIRED,
    )?;
    sweep_expired_sessions(database).await?;

    let client = UpstreamClient::new()?;
    let body = serde_json::json!({
        "client_id": OPENCODE_CLIENT_ID,
    });

    let device_code_url = format!("{OPENCODE_BASE_CONSOLE_URL}/auth/device/code");
    let response = client
        .raw()
        .post(&device_code_url)
        .timeout(DEVICE_REQUEST_TIMEOUT)
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|error| device_auth_transport_failed(&error))?;

    let status = response.status();
    let payload = response.json::<Value>().await.unwrap_or(Value::Null);

    if !status.is_success() {
        return Err(APIError::new(
            400,
            constants::providers::opencode::device_auth_failed(status.as_u16()),
        ));
    }

    let device_code = text_field(&payload, "device_code").ok_or_else(|| {
        APIError::new(
            400,
            constants::providers::opencode::device_auth_failed(status.as_u16()),
        )
    })?;
    let user_code = text_field(&payload, "user_code").ok_or_else(|| {
        APIError::new(
            400,
            constants::providers::opencode::device_auth_failed(status.as_u16()),
        )
    })?;

    let authorize_url = text_field(&payload, "verification_uri_complete")
        .map(|uri| {
            if uri.starts_with("http://") || uri.starts_with("https://") {
                uri
            } else {
                format!("https://opencode.ai{uri}")
            }
        })
        .unwrap_or_else(|| format!("https://opencode.ai/console/device?user_code={user_code}&client_id={OPENCODE_CLIENT_ID}"));

    let expires_in = payload
        .get("expires_in")
        .and_then(Value::as_i64)
        .unwrap_or(600);
    let interval = payload.get("interval").and_then(Value::as_i64).unwrap_or(5);

    let state_token = format!("opencode_{}", uuid::Uuid::new_v4().simple());
    save_device_session(database, &state_token, &device_code, OPENCODE_CLIENT_ID).await?;

    Ok(Json(OpenCodeDeviceResponse {
        authorize_url,
        state: state_token,
        user_code,
        expires_in,
        interval,
    }))
}

async fn poll(
    State(state): State<AppState>,
    query: axum::extract::RawQuery,
    body: axum::body::Bytes,
) -> Result<Json<PollResponse>, APIError> {
    let database = require_database(
        &state,
        constants::database::OAUTH_SESSIONS_DATABASE_REQUIRED,
    )?;

    let state_token = query_params(query.0.as_deref())
        .get("state")
        .cloned()
        .or_else(|| super::state_from_body(&body))
        .ok_or_else(|| APIError::new(400, constants::providers::oauth::MISSING_STATE))?;

    let session = claim_session(database, &state_token)
        .await?
        .ok_or_else(|| APIError::new(400, constants::providers::oauth::SESSION_EXPIRED))?;

    let Some(device_code) = session.device_code.filter(|code| !code.is_empty()) else {
        delete_session(database, &state_token).await?;
        return Ok(Json(PollResponse::pending(Some(
            constants::providers::oauth::SESSION_EXPIRED.to_owned(),
        ))));
    };

    match connect(&state, database, &state_token, &device_code).await {
        Ok(Some(provider)) => {
            delete_session(database, &state_token).await?;
            Ok(Json(PollResponse {
                status: super::PollStatus::Ok,
                error: None,
                provider: Some(provider),
            }))
        }
        Ok(None) => {
            release_session(database, &state_token).await?;
            Ok(Json(PollResponse::pending(None)))
        }
        Err(error) => {
            delete_session(database, &state_token).await?;
            Err(error)
        }
    }
}

async fn connect(
    _state: &AppState,
    database: &AppDatabase,
    _state_token: &str,
    device_code: &str,
) -> Result<Option<ConnectedProvider>, APIError> {
    let client = UpstreamClient::new()?;
    let token_url = format!("{OPENCODE_BASE_CONSOLE_URL}/auth/device/token");

    let body = serde_json::json!({
        "client_id": OPENCODE_CLIENT_ID,
        "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
        "device_code": device_code,
    });

    let response = client
        .raw()
        .post(&token_url)
        .timeout(DEVICE_REQUEST_TIMEOUT)
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|error| poll_transport_failed(&error))?;

    let status = response.status();
    let payload = response.json::<Value>().await.unwrap_or(Value::Null);

    if !status.is_success() {
        if let Some(err) = text_field(&payload, "error")
            && err == "authorization_pending"
        {
            return Ok(None);
        }
        return Err(APIError::new(
            400,
            constants::providers::opencode::poll_failed(status.as_u16()),
        ));
    }

    let access_token = text_field(&payload, "access_token").ok_or_else(|| {
        APIError::new(400, constants::providers::opencode::INVALID_TOKEN_RESPONSE)
    })?;
    let refresh_token = text_field(&payload, "refresh_token");
    let expires_in = payload.get("expires_in").and_then(Value::as_i64);
    let token_expires_at = expires_in.map(|secs| now_ms() + secs * 1000);

    let (email, org_id, org_name) = fetch_identity_and_org(&client, &access_token).await;

    let id = format!("opencode_{}", account_suffix(now_ms()));
    let name = org_name.clone().unwrap_or_else(|| {
        email
            .clone()
            .unwrap_or_else(|| "OpenCode Account".to_string())
    });

    let write = OpenCodeConnectionWrite {
        id: id.clone(),
        name: name.clone(),
        access_token,
        refresh_token,
        token_expires_at,
        org_id,
        org_name,
        email,
    };

    upsert_opencode_connection(database, &write).await?;

    Ok(Some(ConnectedProvider {
        id,
        provider_id: "opencode_zen".to_string(),
        name,
        category: "oauth".to_string(),
        protocol: Protocol::OpenAI,
        enabled: true,
        created_at: now_ms(),
    }))
}

async fn fetch_identity_and_org(
    client: &UpstreamClient,
    access_token: &str,
) -> (Option<String>, Option<String>, Option<String>) {
    let auth_header = format!("Bearer {access_token}");

    let user_resp = client
        .raw()
        .get(format!("{OPENCODE_BASE_CONSOLE_URL}/api/user"))
        .header(reqwest::header::AUTHORIZATION, &auth_header)
        .header(reqwest::header::USER_AGENT, "opencode/latest/2.0.15/cli")
        .send()
        .await;

    let email = match user_resp {
        Ok(resp) if resp.status().is_success() => {
            let val = resp.json::<Value>().await.unwrap_or(Value::Null);
            text_field(&val, "email")
        }
        _ => None,
    };

    let orgs_resp = client
        .raw()
        .get(format!("{OPENCODE_BASE_CONSOLE_URL}/api/orgs"))
        .header(reqwest::header::AUTHORIZATION, &auth_header)
        .header(reqwest::header::USER_AGENT, "opencode/latest/2.0.15/cli")
        .send()
        .await;

    let (org_id, org_name) = match orgs_resp {
        Ok(resp) if resp.status().is_success() => {
            let val = resp.json::<Value>().await.unwrap_or(Value::Null);
            if let Some(list) = val.as_array().and_then(|arr| arr.first()) {
                (text_field(list, "id"), text_field(list, "name"))
            } else {
                (None, None)
            }
        }
        _ => (None, None),
    };

    (email, org_id, org_name)
}

fn device_auth_transport_failed(error: &reqwest::Error) -> APIError {
    APIError::new(
        500,
        constants::providers::opencode::device_auth_transport_failed(error),
    )
}

fn poll_transport_failed(error: &reqwest::Error) -> APIError {
    APIError::new(
        500,
        constants::providers::opencode::poll_transport_failed(error),
    )
}
