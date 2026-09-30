//! `/v1/settings` read and mutation routes.

use axum::body::Bytes;
use axum::extract::State;
use axum::routing::{get, patch};
use axum::{Json, Router};
use serde::Serialize;
use serde_json::Value;

use crate::constants;
use crate::error::APIError;
use crate::infrastructure::database::AppDatabase;
use crate::infrastructure::database::settings::{get_require_api_key, set_require_api_key};
use crate::state::AppState;

/// Read router for `/v1/settings`. Protected by API-key auth.
pub fn create_settings_read_router() -> Router<AppState> {
    Router::new().route("/settings", get(get_settings))
}

/// Mutation router for `/v1/settings`. Protected by admin session and CSRF guard.
pub fn create_settings_management_router() -> Router<AppState> {
    Router::new().route("/settings", patch(update_settings).post(update_settings))
}

#[derive(Serialize)]
pub struct SettingsResponse {
    pub require_api_key: bool,
}

#[derive(Debug, Default)]
struct UpdateSettingsInput {
    require_api_key: Option<bool>,
}

async fn get_settings(State(state): State<AppState>) -> Result<Json<SettingsResponse>, APIError> {
    let require_api_key = if let Some(database) = state.database.as_ref() {
        get_require_api_key(database).await?
    } else {
        state
            .security
            .api_keys
            .require_api_key()
            .await
            .unwrap_or(false)
    };

    Ok(Json(SettingsResponse { require_api_key }))
}

async fn update_settings(
    State(state): State<AppState>,
    body: Bytes,
) -> Result<Json<SettingsResponse>, APIError> {
    let input = parse_update_settings_payload(&body)?;
    let database = require_database(&state)?;

    if let Some(required) = input.require_api_key {
        set_require_api_key(database, required).await?;
    }

    let require_api_key = get_require_api_key(database).await?;

    Ok(Json(SettingsResponse { require_api_key }))
}

fn require_database(state: &AppState) -> Result<&AppDatabase, APIError> {
    state
        .database
        .as_ref()
        .ok_or_else(|| APIError::new(500, constants::settings::DATABASE_REQUIRED))
}

fn parse_update_settings_payload(body: &[u8]) -> Result<UpdateSettingsInput, APIError> {
    if body.is_empty() {
        return Err(APIError::new(400, constants::settings::INVALID_PAYLOAD));
    }

    let value: Value = serde_json::from_slice(body)
        .map_err(|_| APIError::new(400, constants::settings::INVALID_PAYLOAD))?;

    let object = value
        .as_object()
        .ok_or_else(|| APIError::new(400, constants::settings::INVALID_PAYLOAD))?;

    let mut input = UpdateSettingsInput::default();

    if let Some(val) = object.get("require_api_key") {
        let b = val
            .as_bool()
            .ok_or_else(|| APIError::new(400, constants::settings::INVALID_PAYLOAD))?;
        input.require_api_key = Some(b);
    }

    Ok(input)
}
