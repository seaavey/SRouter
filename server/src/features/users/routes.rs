//! `/v1/users` management routes. Every route requires an admin session (the
//! layer is applied by the composition root). The login token is returned only
//! when it is minted, because schema v5 stores just its hash and a display
//! prefix.

use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, patch, post};
use axum::{Json, Router};
use serde::Serialize;
use serde_json::{Map, Value};

use crate::constants;
use crate::error::APIError;
use crate::features::users::model::{CreateUserInput, CreatedUser, UpdateUserInput, User};
use crate::infrastructure::database::AppDatabase;
use crate::infrastructure::database::users;
use crate::state::AppState;

/// Mounts the customer-account routes. The compatibility alias `/v1/v1` does
/// not include them (only chat, messages, and models), matching the key mount.
pub fn create_users_router() -> Router<AppState> {
    Router::new()
        .route("/users", get(list_users).post(create_user))
        .route("/users/{id}", patch(update_user))
        .route("/users/{id}/token", post(rotate_user_token))
}

async fn list_users(State(state): State<AppState>) -> Result<Json<UserListResponse>, APIError> {
    let rows = users::list_users(database(&state)?).await?;

    Ok(Json(UserListResponse {
        object: "list",
        data: rows.iter().map(UserResponse::from).collect(),
    }))
}

async fn create_user(State(state): State<AppState>, body: Bytes) -> Result<Response, APIError> {
    let input = parse_create_input(&body)?;
    let created = users::create_user(database(&state)?, &input.name).await?;

    Ok((
        StatusCode::CREATED,
        Json(CreatedUserResponse::from(&created)),
    )
        .into_response())
}

async fn update_user(
    State(state): State<AppState>,
    Path(id): Path<String>,
    body: Bytes,
) -> Result<Response, APIError> {
    let patch = parse_update_input(&body)?;

    match users::update_user(database(&state)?, &id, patch).await? {
        Some(user) => {
            // The gateway caches `owner_enabled` with each key record, outside
            // the transaction above; without this a suspend would not bite.
            state.security.api_keys.invalidate_cache();

            Ok(Json(UserResponse::from(&user)).into_response())
        }
        None => Err(not_found(&id)),
    }
}

async fn rotate_user_token(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Response, APIError> {
    match users::rotate_token(database(&state)?, &id).await? {
        Some(created) => Ok(Json(CreatedUserResponse::from(&created)).into_response()),
        None => Err(not_found(&id)),
    }
}

fn database(state: &AppState) -> Result<&AppDatabase, APIError> {
    state
        .database
        .as_ref()
        .ok_or_else(|| APIError::new(500, constants::users::DATABASE_REQUIRED))
}

fn not_found(id: &str) -> APIError {
    APIError::new(404, constants::users::not_found(id))
}

#[derive(Serialize, specta::Type)]
pub(crate) struct UserListResponse {
    object: &'static str,
    data: Vec<UserResponse>,
}

/// Management representation of an account. `token_prefix` is the non-secret
/// display prefix; the login token itself is only ever in a creation response.
#[derive(Serialize, specta::Type)]
pub(crate) struct UserResponse {
    id: String,
    name: String,
    token_prefix: String,
    enabled: bool,
    #[specta(type = specta_typescript::Number)]
    created_at: i64,
}

impl From<&User> for UserResponse {
    fn from(user: &User) -> Self {
        Self {
            id: user.id.clone(),
            name: user.name.clone(),
            token_prefix: user.token_prefix.clone(),
            enabled: user.enabled,
            created_at: user.created_at,
        }
    }
}

/// Creation and rotation response: the management fields plus the one-time
/// login token.
#[derive(Serialize, specta::Type)]
pub(crate) struct CreatedUserResponse {
    #[serde(flatten)]
    user: UserResponse,
    token: String,
}

impl From<&CreatedUser> for CreatedUserResponse {
    fn from(created: &CreatedUser) -> Self {
        Self {
            user: UserResponse::from(&created.user),
            token: created.token.clone(),
        }
    }
}

fn parse_create_input(body: &[u8]) -> Result<CreateUserInput, APIError> {
    let object = parse_object(body)?;

    let name = match object.get("name") {
        Some(Value::String(raw)) if !raw.is_empty() => raw.trim().to_owned(),
        Some(Value::String(_)) => return Err(APIError::new(400, constants::users::NAME_EMPTY)),
        Some(_) => return Err(APIError::new(400, constants::users::INVALID_PAYLOAD)),
        None => return Err(APIError::new(400, constants::users::NAME_REQUIRED)),
    };

    Ok(CreateUserInput { name })
}

fn parse_update_input(body: &[u8]) -> Result<UpdateUserInput, APIError> {
    let object = parse_object(body)?;

    let name = match object.get("name") {
        None => None,
        Some(Value::String(raw)) if raw.is_empty() => {
            return Err(APIError::new(400, constants::users::NAME_EMPTY));
        }
        Some(Value::String(raw)) => Some(raw.trim().to_owned()),
        Some(_) => return Err(APIError::new(400, constants::users::INVALID_PAYLOAD)),
    };
    let enabled = match object.get("enabled") {
        None => None,
        Some(Value::Bool(enabled)) => Some(*enabled),
        Some(_) => return Err(APIError::new(400, constants::users::INVALID_PAYLOAD)),
    };

    Ok(UpdateUserInput { name, enabled })
}

/// Parses the request body into an object, ignoring unknown fields. A body that
/// is not JSON, or JSON that is not an object, is the same `400`.
fn parse_object(body: &[u8]) -> Result<Map<String, Value>, APIError> {
    let value: Value = serde_json::from_slice(body)
        .map_err(|_| APIError::new(400, constants::users::INVALID_PAYLOAD))?;

    match value {
        Value::Object(object) => Ok(object),
        _ => Err(APIError::new(400, constants::users::INVALID_PAYLOAD)),
    }
}

#[cfg(test)]
mod tests {
    use super::{parse_create_input, parse_update_input};

    #[test]
    fn create_trims_the_name_and_ignores_unknown_fields() {
        let input = parse_create_input(br#"{"name":"  Acme  ","extra":true}"#).unwrap();

        assert_eq!(input.name, "Acme");
    }

    #[test]
    fn create_requires_a_non_empty_name() {
        assert_eq!(parse_create_input(br#"{}"#).unwrap_err().status(), 400);
        assert_eq!(
            parse_create_input(br#"{"name":""}"#).unwrap_err().status(),
            400
        );
        assert_eq!(
            parse_create_input(br#"{"name":7}"#).unwrap_err().status(),
            400
        );
    }

    #[test]
    fn update_keeps_absent_fields_absent_and_rejects_wrong_types() {
        let empty = parse_update_input(br#"{"unknown":true}"#).unwrap();
        assert_eq!((empty.name, empty.enabled), (None, None));

        let patch = parse_update_input(br#"{"name":"Acme","enabled":false}"#).unwrap();
        assert_eq!(patch.name.as_deref(), Some("Acme"));
        assert_eq!(patch.enabled, Some(false));

        assert!(parse_update_input(br#"{"enabled":"no"}"#).is_err());
        assert!(parse_update_input(br#"{"name":""}"#).is_err());
    }
}
