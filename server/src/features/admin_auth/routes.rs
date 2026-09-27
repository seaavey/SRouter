//! `/v1/admin` routes: setup, login, change-password, logout, and status.
//! Behavior mirrors `apps/api/src/controllers/admin.controller.ts`, including
//! the frozen error codes and the 7-day session cookie.

use axum::body::{Bytes, to_bytes};
use axum::extract::{Request, State};
use axum::http::{HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde_json::{Value, json};

use crate::clock::now_ms;
use crate::error::APIError;
use crate::http::middleware::client_address::{client_address, is_loopback_address};
use crate::http::middleware::cookies::cookie_value;
use crate::state::AppState;

use super::password::{hash_admin_password, validate_admin_password, verify_admin_password};
use super::{
    ADMIN_SESSION_COOKIE, ADMIN_SESSION_TTL_MS, generate_session_token, hash_session_token,
};

/// Admin payloads are tiny; this only bounds a hostile upload before parsing.
const MAX_ADMIN_BODY: usize = 1024 * 1024;

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

    Ok(Json(json!({
        "setup_required": setup_required,
        "authenticated": authenticated
    }))
    .into_response())
}

async fn admin_setup(
    State(state): State<AppState>,
    request: Request,
) -> Result<Response, APIError> {
    let address = client_address(request.extensions());
    if !address.as_deref().is_some_and(is_loopback_address) {
        return Err(
            APIError::new(403, "Admin setup is only available from the local machine")
                .with_code("setup_local_only"),
        );
    }

    if state.security.admin_auth.has_admin_account().await? {
        return Err(already_set_up());
    }

    let body = json_body(request, "Invalid setup payload").await?;
    let (password, confirmation) = parse_setup(&body)?;

    if let Some(message) = validate_admin_password(&password) {
        return Err(invalid_password(message));
    }
    if confirmation != password {
        return Err(APIError::new(400, "Password confirmation does not match")
            .with_code("password_mismatch"));
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

    let mut response =
        (StatusCode::CREATED, Json(json!({ "authenticated": true }))).into_response();
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
        return Err(
            APIError::new(429, "Too many failed login attempts").with_code("login_rate_limited")
        );
    }

    let body = json_body(request, "Invalid admin password").await?;
    let Some(password) = parse_login(&body) else {
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

    let mut response = Json(json!({ "authenticated": true })).into_response();
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

    let body = json_body(request, "Invalid payload").await?;
    let (current, new_password, confirmation) = parse_change_password(&body)?;

    let stored = state.security.admin_auth.get_password_hash().await?;
    if !stored
        .as_deref()
        .is_some_and(|hash| verify_admin_password(&current, hash))
    {
        return Err(APIError::new(401, "Current admin password is incorrect")
            .with_code("invalid_credentials"));
    }

    if let Some(message) = validate_admin_password(&new_password) {
        return Err(invalid_password(message));
    }
    if new_password != confirmation {
        return Err(
            APIError::new(400, "New password confirmation does not match")
                .with_code("password_mismatch"),
        );
    }

    let password_hash = hash_admin_password(&new_password)?;
    if !state
        .security
        .admin_auth
        .update_password_hash(&password_hash, now_ms())
        .await?
    {
        return Err(APIError::new(500, "Failed to update admin password")
            .with_code("password_update_failed"));
    }

    Ok(Json(json!({ "message": "Admin password updated successfully" })).into_response())
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

fn session_cookie(token: &str, secure: bool) -> Result<HeaderValue, APIError> {
    let mut cookie = format!(
        "{ADMIN_SESSION_COOKIE}={token}; Max-Age={}; Path=/; HttpOnly; SameSite=Lax",
        ADMIN_SESSION_TTL_MS / 1000
    );
    if secure {
        cookie.push_str("; Secure");
    }

    HeaderValue::from_str(&cookie)
        .map_err(|error| APIError::new(500, format!("could not build the session cookie: {error}")))
}

fn cleared_cookie(secure: bool) -> Result<HeaderValue, APIError> {
    let mut cookie = format!("{ADMIN_SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax");
    if secure {
        cookie.push_str("; Secure");
    }

    HeaderValue::from_str(&cookie)
        .map_err(|error| APIError::new(500, format!("could not build the cleared cookie: {error}")))
}

async fn json_body(request: Request, message: &str) -> Result<Value, APIError> {
    let bytes: Bytes = to_bytes(request.into_body(), MAX_ADMIN_BODY)
        .await
        .map_err(|_| APIError::new(400, message))?;

    serde_json::from_slice(&bytes).map_err(|_| APIError::new(400, message))
}

fn parse_setup(value: &Value) -> Result<(String, String), APIError> {
    let object = value
        .as_object()
        .ok_or_else(|| invalid_password("Password is required"))?;

    let password = plain_string(object, "password", "Password is required")?;
    let confirmation = plain_string(object, "confirmation", "Password confirmation is required")?;

    Ok((password, confirmation))
}

fn parse_change_password(value: &Value) -> Result<(String, String, String), APIError> {
    let object = value
        .as_object()
        .ok_or_else(|| invalid_password("Current password is required"))?;

    let current = plain_string(object, "current_password", "Current password is required")?;
    let new_password = plain_string(object, "new_password", "New password is required")?;
    let confirmation = plain_string(object, "confirmation", "Password confirmation is required")?;

    Ok((current, new_password, confirmation))
}

fn parse_login(value: &Value) -> Option<String> {
    value
        .get("password")
        .and_then(Value::as_str)
        .filter(|password| !password.is_empty())
        .map(str::to_owned)
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
    APIError::new(400, message).with_code("invalid_password")
}

fn invalid_credentials() -> APIError {
    APIError::new(401, "Invalid admin password").with_code("invalid_credentials")
}

fn authentication_required() -> APIError {
    APIError::new(401, "Admin authentication is required").with_code("authentication_required")
}

fn already_set_up() -> APIError {
    APIError::new(409, "Admin setup has already been completed").with_code("setup_already_complete")
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{parse_change_password, parse_login, parse_setup};

    #[test]
    fn setup_requires_both_non_empty_strings() {
        let (password, confirmation) = parse_setup(&json!({
            "password": "secret",
            "confirmation": "secret"
        }))
        .unwrap();
        assert_eq!(password, "secret");
        assert_eq!(confirmation, "secret");

        assert_eq!(parse_setup(&json!({})).unwrap_err().status(), 400);
        assert_eq!(
            parse_setup(&json!({ "password": "", "confirmation": "" }))
                .unwrap_err()
                .status(),
            400
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
        assert_eq!(
            parse_login(&json!({ "password": "x" })).as_deref(),
            Some("x")
        );
        assert_eq!(parse_login(&json!({ "password": "" })), None);
        assert_eq!(parse_login(&json!({})), None);
    }
}
