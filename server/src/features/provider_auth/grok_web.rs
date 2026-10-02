//! The Grok Web cookie connect flow: the operator posts the session cookie,
//! the server probes grok.com for the issued `x-userid`, and a verified cookie
//! is stored as a provider connection.
//!
//! Verification reuses the executor's page probe, so the connect route and the
//! chat path agree on what a valid cookie looks like: `200` plus `x-userid`
//! means usable, a redirect to `accounts.x.ai` means expired.

use std::time::Duration;

use axum::extract::State;
use axum::http::StatusCode;
use axum::routing::post;
use axum::{Json, Router};
use serde_json::Value;

use super::{ConnectedProvider, text_field};
use crate::clock::now_ms;
use crate::constants;
use crate::error::APIError;
use crate::features::providers::grok_web::executor::{probe_client, probe_uid};
use crate::features::providers::grok_web::types::GROK_WEB_PROVIDER;
use crate::infrastructure::database::AppDatabase;
use crate::infrastructure::database::providers::{
    GrokWebConnectionWrite, upsert_grok_web_connection,
};
use crate::state::AppState;

/// Upper bound for the connect-time page probe; a healthy grok.com answers in
/// well under a second.
const PROBE_TIMEOUT: Duration = Duration::from_secs(10);

/// Routes the admin session guard: posting the Grok Web session cookie.
pub fn create_grok_web_login_router() -> Router<AppState> {
    Router::new().route("/auth/grok-web/connect", post(connect))
}

/// `POST /v1/auth/grok-web/connect` verifies and stores the cookie. The body
/// carries the cookie under `cookie`, `sso`, or `api_key`, either as the bare
/// value or as a `sso=<value>` pair.
async fn connect(
    State(state): State<AppState>,
    body: axum::body::Bytes,
) -> Result<(StatusCode, Json<ConnectedProvider>), APIError> {
    let parsed: Value = serde_json::from_slice(&body).map_err(|_| invalid_cookie_payload())?;
    let stored = ["cookie", "sso", "api_key", "apiKey"]
        .iter()
        .find_map(|key| text_field(&parsed, key))
        .ok_or_else(invalid_cookie_payload)?;
    let sso = stored
        .strip_prefix("sso=")
        .map(str::trim)
        .unwrap_or(stored.as_str())
        .to_owned();

    let database = require_database(&state)?;
    let endpoints = state.providers.grok_web_endpoints().unwrap_or_default();

    let client = probe_client()?;
    probe_uid(&client, &endpoints.page_url, &sso, PROBE_TIMEOUT).await?;

    let timestamp = now_ms();
    let id = format!("grok-web_{timestamp}");
    let name = "Grok Web".to_owned();
    upsert_grok_web_connection(
        database,
        &GrokWebConnectionWrite {
            id: id.clone(),
            name: name.clone(),
            sso,
        },
    )
    .await?;

    // The connection exists now, so the static model list can appear in the
    // catalog before the operator's next request reads it.
    state.providers.maybe_refresh_catalogs(true).await;

    Ok((
        StatusCode::CREATED,
        Json(ConnectedProvider {
            id,
            provider_id: GROK_WEB_PROVIDER.id.to_owned(),
            name,
            category: GROK_WEB_PROVIDER.category.to_owned(),
            protocol: GROK_WEB_PROVIDER.protocol.to_owned(),
            enabled: true,
            created_at: timestamp,
        }),
    ))
}

fn invalid_cookie_payload() -> APIError {
    APIError::new(400, constants::providers::grok_web::COOKIE_PAYLOAD_INVALID)
}

fn require_database(state: &AppState) -> Result<&AppDatabase, APIError> {
    state
        .database
        .as_ref()
        .ok_or_else(|| APIError::new(500, constants::providers::grok_web::DATABASE_REQUIRED))
}
