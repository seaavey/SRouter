//! `/v1/admin` routes: setup, login, change-password, logout, and status.
//! Behavior mirrors `apps/api/src/controllers/admin.controller.ts`, including
//! the frozen error codes and the 7-day session cookie.

use axum::body::{Bytes, to_bytes};
use axum::extract::{Request, State};
use axum::http::{StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Serialize;
use serde_json::{Value, json};

use crate::clock::now_ms;
use crate::constants;
use crate::error::APIError;
use crate::request::{client_address, cookie_value, is_loopback_address};
use crate::state::AppState;

use super::password::{hash_admin_password, validate_admin_password, verify_admin_password};
use super::session::{cleared_cookie, session_cookie};
use super::{
    ADMIN_SESSION_COOKIE, ADMIN_SESSION_TTL_MS, generate_session_token, hash_session_token,
};

/// Admin payloads are tiny; this only bounds a hostile upload before parsing.
const MAX_ADMIN_BODY: usize = 1024 * 1024;

/// `GET /v1/admin/status` — whether the install still needs its first admin
/// and whether the caller holds a valid session cookie.
#[derive(Serialize, specta::Type)]
pub struct AdminStatus {
    setup_required: bool,
    authenticated: bool,
}

/// The answer to `POST /v1/admin/setup` and `POST /v1/admin/login`. Both only
/// succeed by setting the session cookie, so `authenticated` is always true.
#[derive(Serialize, specta::Type)]
pub struct AdminAuthResult {
    authenticated: bool,
}

/// Fields accepted by `POST /v1/admin/setup`.
///
/// Carries a password and therefore derives no `Debug`/`PartialEq`: a derive
/// would make the secret printable from any log line that formats the struct.
#[derive(specta::Type)]
pub struct AdminSetupInput {
    password: String,
    confirmation: String,
}

/// Fields accepted by `POST /v1/admin/login`, under the same no-`Debug` rule as
/// `AdminSetupInput`.
#[derive(specta::Type)]
pub struct AdminLoginInput {
    password: String,
}

/// Mounts the admin-auth routes. They are nested under `/v1`, so the paths are
/// `/v1/admin/*`, and they carry no shared guard: each handler enforces its own
/// session requirement.
pub fn create_admin_router() -> Router<AppState> {
    Router::new()
        .route("/admin/status", get(admin_status))
        .route("/admin/setup", post(admin_setup))
        .route("/admin/login", post(admin_login))
        .route("/admin/change-password", post(admin_change_password))
        .route("/admin/logout", post(admin_logout))
}

async fn admin_status(
    State(state): State<AppState>,
    request: Request,
) -> Result<Response, APIError> {
    let token = cookie_value(request.headers(), ADMIN_SESSION_COOKIE);
    let authenticated = is_authenticated(&state, token.as_deref()).await?;
    let setup_required = !state.security.admin_auth.has_admin_account().await?;

    Ok(Json(AdminStatus {
        setup_required,
        authenticated,
    })
    .into_response())
}

async fn admin_setup(
    State(state): State<AppState>,
    request: Request,
) -> Result<Response, APIError> {
    let address = client_address(request.extensions());
    if !address.as_deref().is_some_and(is_loopback_address) {
        return Err(APIError::new(403, constants::admin::SETUP_LOCAL_ONLY)
            .with_code(constants::ErrorCode::SetupLocalOnly));
    }

    if state.security.admin_auth.has_admin_account().await? {
        return Err(already_set_up());
    }

    let body = json_body(request, constants::admin::INVALID_SETUP_PAYLOAD).await?;
    let AdminSetupInput {
        password,
        confirmation,
    } = parse_setup(&body)?;

    if let Some(message) = validate_admin_password(&password) {
        return Err(invalid_password(message));
    }
    if confirmation != password {
        return Err(
            APIError::new(400, constants::admin::PASSWORD_CONFIRMATION_MISMATCH)
                .with_code(constants::ErrorCode::PasswordMismatch),
        );
    }

    let now = now_ms();
    let password_hash = hash_admin_password(&password)?;
    if !state
        .security
        .admin_auth
        .create_admin_account(&password_hash, now)
        .await?
    {
        return Err(already_set_up());
    }

    let mut response = (
        StatusCode::CREATED,
        Json(AdminAuthResult {
            authenticated: true,
        }),
    )
        .into_response();
    attach_session(&state, &mut response, now).await?;

    Ok(response)
}

async fn admin_login(
    State(state): State<AppState>,
    request: Request,
) -> Result<Response, APIError> {
    let address = client_address(request.extensions()).unwrap_or_else(|| "unknown".to_owned());
    let now = now_ms();
    if state.security.login_throttle.is_blocked(&address, now) {
        return Err(APIError::new(429, constants::admin::TOO_MANY_ATTEMPTS)
            .with_code(constants::ErrorCode::LoginRateLimited));
    }

    let body = json_body(request, constants::admin::INVALID_PASSWORD).await?;
    let Some(AdminLoginInput { password }) = parse_login(&body) else {
        return Err(invalid_credentials());
    };

    let stored = state.security.admin_auth.get_password_hash().await?;
    let valid = stored
        .as_deref()
        .is_some_and(|hash| verify_admin_password(&password, hash));
    if !valid {
        state.security.login_throttle.record_failure(&address, now);

        return Err(invalid_credentials());
    }

    state.security.login_throttle.clear(&address);

    let mut response = Json(AdminAuthResult {
        authenticated: true,
    })
    .into_response();
    attach_session(&state, &mut response, now).await?;

    Ok(response)
}

async fn admin_change_password(
    State(state): State<AppState>,
    request: Request,
) -> Result<Response, APIError> {
    let token = cookie_value(request.headers(), ADMIN_SESSION_COOKIE);
    if !is_authenticated(&state, token.as_deref()).await? {
        return Err(authentication_required());
    }

    let body = json_body(request, constants::common::INVALID_PAYLOAD).await?;
    let (current, new_password, confirmation) = parse_change_password(&body)?;

    let stored = state.security.admin_auth.get_password_hash().await?;
    if !stored
        .as_deref()
        .is_some_and(|hash| verify_admin_password(&current, hash))
    {
        return Err(
            APIError::new(401, constants::admin::CURRENT_PASSWORD_INCORRECT)
                .with_code(constants::ErrorCode::InvalidCredentials),
        );
    }

    if let Some(message) = validate_admin_password(&new_password) {
        return Err(invalid_password(message));
    }
    if new_password != confirmation {
        return Err(
            APIError::new(400, constants::admin::NEW_PASSWORD_CONFIRMATION_MISMATCH)
                .with_code(constants::ErrorCode::PasswordMismatch),
        );
    }

    let password_hash = hash_admin_password(&new_password)?;
    if !state
        .security
        .admin_auth
        .update_password_hash(&password_hash, now_ms())
        .await?
    {
        return Err(
            APIError::new(500, constants::admin::FAILED_TO_UPDATE_PASSWORD)
                .with_code(constants::ErrorCode::PasswordUpdateFailed),
        );
    }

    Ok(Json(json!({ "message": constants::admin::PASSWORD_UPDATED })).into_response())
}

async fn admin_logout(
    State(state): State<AppState>,
    request: Request,
) -> Result<Response, APIError> {
    let token = cookie_value(request.headers(), ADMIN_SESSION_COOKIE);

    if !is_authenticated(&state, token.as_deref()).await? {
        let mut response = authentication_required().into_response();
        attach_cleared_cookie(&state, &mut response)?;

        return Ok(response);
    }

    if let Some(token) = token {
        state
            .security
            .admin_auth
            .delete_session(&hash_session_token(&token))
            .await?;
    }

    let mut response = StatusCode::NO_CONTENT.into_response();
    attach_cleared_cookie(&state, &mut response)?;

    Ok(response)
}

async fn is_authenticated(state: &AppState, token: Option<&str>) -> Result<bool, APIError> {
    let Some(token) = token else {
        return Ok(false);
    };

    state
        .security
        .admin_sessions
        .has_valid_session(&hash_session_token(token), now_ms())
        .await
}

/// Creates a session row and sets the cookie on `response`.
async fn attach_session(
    state: &AppState,
    response: &mut Response,
    now: i64,
) -> Result<(), APIError> {
    let token = generate_session_token()?;
    state
        .security
        .admin_auth
        .create_session(&hash_session_token(&token), now, now + ADMIN_SESSION_TTL_MS)
        .await?;

    response.headers_mut().insert(
        header::SET_COOKIE,
        session_cookie(&token, state.config.secure_cookies)?,
    );

    Ok(())
}

fn attach_cleared_cookie(state: &AppState, response: &mut Response) -> Result<(), APIError> {
    response.headers_mut().insert(
        header::SET_COOKIE,
        cleared_cookie(state.config.secure_cookies)?,
    );

    Ok(())
}

async fn json_body(request: Request, message: &str) -> Result<Value, APIError> {
    let bytes: Bytes = to_bytes(request.into_body(), MAX_ADMIN_BODY)
        .await
        .map_err(|_| APIError::new(400, message))?;

    serde_json::from_slice(&bytes).map_err(|_| APIError::new(400, message))
}

fn parse_setup(value: &Value) -> Result<AdminSetupInput, APIError> {
    let object = value
        .as_object()
        .ok_or_else(|| invalid_password(constants::admin::PASSWORD_REQUIRED))?;

    let password = plain_string(object, "password", constants::admin::PASSWORD_REQUIRED)?;
    let confirmation = plain_string(
        object,
        "confirmation",
        constants::admin::PASSWORD_CONFIRMATION_REQUIRED,
    )?;

    Ok(AdminSetupInput {
        password,
        confirmation,
    })
}

fn parse_change_password(value: &Value) -> Result<(String, String, String), APIError> {
    let object = value
        .as_object()
        .ok_or_else(|| invalid_password(constants::admin::CURRENT_PASSWORD_REQUIRED))?;

    let current = plain_string(
        object,
        "current_password",
        constants::admin::CURRENT_PASSWORD_REQUIRED,
    )?;
    let new_password = plain_string(
        object,
        "new_password",
        constants::admin::NEW_PASSWORD_REQUIRED,
    )?;
    let confirmation = plain_string(
        object,
        "confirmation",
        constants::admin::PASSWORD_CONFIRMATION_REQUIRED,
    )?;

    Ok((current, new_password, confirmation))
}

fn parse_login(value: &Value) -> Option<AdminLoginInput> {
    value
        .get("password")
        .and_then(Value::as_str)
        .filter(|password| !password.is_empty())
        .map(|password| AdminLoginInput {
            password: password.to_owned(),
        })
}

fn plain_string(
    object: &serde_json::Map<String, Value>,
    field: &str,
    missing: &'static str,
) -> Result<String, APIError> {
    match object.get(field) {
        Some(Value::String(value)) if !value.is_empty() => Ok(value.clone()),
        _ => Err(invalid_password(missing)),
    }
}

fn invalid_password(message: &str) -> APIError {
    APIError::new(400, message).with_code(constants::ErrorCode::InvalidPassword)
}

fn invalid_credentials() -> APIError {
    APIError::new(401, constants::admin::INVALID_PASSWORD)
        .with_code(constants::ErrorCode::InvalidCredentials)
}

fn authentication_required() -> APIError {
    APIError::new(401, constants::admin::AUTH_REQUIRED)
        .with_code(constants::ErrorCode::AuthenticationRequired)
}

fn already_set_up() -> APIError {
    APIError::new(409, constants::admin::SETUP_COMPLETED)
        .with_code(constants::ErrorCode::SetupAlreadyComplete)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{parse_change_password, parse_login, parse_setup};

    #[test]
    fn setup_requires_both_non_empty_strings() {
        let input = parse_setup(&json!({
            "password": "secret",
            "confirmation": "secret"
        }))
        .unwrap();
        assert_eq!(input.password, "secret");
        assert_eq!(input.confirmation, "secret");
        // `.err()` rather than `.unwrap_err()`: the input type carries a
        // password and deliberately implements no `Debug` to print it.
        assert_eq!(parse_setup(&json!({})).err().map(|e| e.status()), Some(400));
        assert_eq!(
            parse_setup(&json!({ "password": "", "confirmation": "" }))
                .err()
                .map(|e| e.status()),
            Some(400)
        );
    }

    #[test]
    fn change_password_requires_all_three_fields() {
        assert!(
            parse_change_password(&json!({
                "current_password": "old",
                "new_password": "new",
                "confirmation": "new"
            }))
            .is_ok()
        );
        assert!(parse_change_password(&json!({ "current_password": "old" })).is_err());
    }

    #[test]
    fn login_needs_a_non_empty_password() {
        assert!(parse_login(&json!({ "password": "x" })).is_some());
        assert!(parse_login(&json!({ "password": "" })).is_none());
        assert!(parse_login(&json!({})).is_none());
    }
}
