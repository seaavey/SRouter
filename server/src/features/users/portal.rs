//! The customer console: token sign-in and the tenant-scoped reads behind
//! `/v1/portal/*`. The mount split (public login, guarded console) lives in the
//! composition root.

use axum::body::{Bytes, to_bytes};
use axum::extract::{Extension, Query, Request, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Serialize;
use serde_json::Value;

use crate::clock::now_ms;
use crate::constants;
use crate::error::APIError;
use crate::features::admin_auth::session::{attach_cleared_cookie, attach_session};
use crate::features::admin_auth::{ADMIN_SESSION_COOKIE, hash_session_token};
use crate::features::api_keys::routes::APIKeyResponse;
use crate::features::logs::{LogsQuery, LogsResponse, logs_page};
use crate::features::users::routes::UserResponse;
use crate::http::middleware::session_guard::PortalPrincipal;
use crate::infrastructure::database::AppDatabase;
use crate::infrastructure::database::users::{find_by_token, find_user};
use crate::request::{client_address, cookie_value};
use crate::state::AppState;

/// A login body is tiny; this only bounds a hostile upload before parsing.
const MAX_LOGIN_BODY: usize = 1024 * 1024;

/// Fields accepted by `POST /v1/portal/login`.
///
/// Carries a login credential and therefore derives no `Debug`: a derive would
/// make the token printable from any log line that formats the struct.
#[derive(specta::Type)]
pub(crate) struct PortalLoginInput {
    token: String,
}

/// The signed-in customer and the keys they own. The totals on screen are a
/// reduce over `keys` in the client, the only place they are displayed.
#[derive(Serialize, specta::Type)]
pub(crate) struct PortalMe {
    user: UserResponse,
    keys: Vec<APIKeyResponse>,
}

/// Login is public, so it mounts without a guard. It carries its own per-address
/// throttle.
pub fn create_portal_login_router() -> Router<AppState> {
    Router::new().route("/portal/login", post(portal_login))
}

/// The console routes: logout, the account view, and the scoped log read.
pub fn create_portal_router() -> Router<AppState> {
    Router::new()
        .route("/portal/logout", post(portal_logout))
        .route("/portal/me", get(portal_me))
        .route("/portal/logs", get(portal_logs))
}

async fn portal_login(
    State(state): State<AppState>,
    request: Request,
) -> Result<Response, APIError> {
    let address = client_address(
        request.headers(),
        request.extensions(),
        state.config.trust_cf_connecting_ip,
    )
    .unwrap_or_else(|| "unknown".to_owned());
    // Prefixed so a customer's failed attempts never lock the operator out.
    let throttle_key = format!("portal:{address}");
    let now = now_ms();
    if state.security.login_throttle.is_blocked(&throttle_key, now) {
        return Err(APIError::new(429, constants::portal::TOO_MANY_ATTEMPTS)
            .with_code(constants::ErrorCode::LoginRateLimited));
    }

    let body = json_body(request, constants::portal::INVALID_LOGIN_PAYLOAD).await?;
    let Some(PortalLoginInput { token }) = parse_login(&body) else {
        return Err(invalid_token());
    };

    let database = database(&state)?;
    let user = find_by_token(database, &hash_session_token(&token))
        .await?
        .filter(|user| user.enabled);
    let Some(user) = user else {
        state
            .security
            .login_throttle
            .record_failure(&throttle_key, now);
        return Err(invalid_token());
    };
    state.security.login_throttle.clear(&throttle_key);

    let mut response = Json(UserResponse::from(&user)).into_response();
    attach_session(&state, &mut response, now, Some(&user.id)).await?;

    Ok(response)
}

async fn portal_logout(
    State(state): State<AppState>,
    request: Request,
) -> Result<Response, APIError> {
    if let Some(token) = cookie_value(request.headers(), ADMIN_SESSION_COOKIE) {
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

async fn portal_me(
    State(state): State<AppState>,
    Extension(principal): Extension<PortalPrincipal>,
) -> Result<Json<PortalMe>, APIError> {
    let database = database(&state)?;
    let user = find_user(database, &principal.0)
        .await?
        .ok_or_else(sign_in_required)?;
    let keys = state
        .security
        .key_repository
        .list_for_user(&user.id)
        .await?;

    Ok(Json(PortalMe {
        user: UserResponse::from(&user),
        keys: keys.iter().map(APIKeyResponse::from).collect(),
    }))
}

async fn portal_logs(
    State(state): State<AppState>,
    Extension(principal): Extension<PortalPrincipal>,
    Query(query): Query<LogsQuery>,
) -> Result<Json<LogsResponse>, APIError> {
    let database = database(&state)?;
    find_user(database, &principal.0)
        .await?
        .ok_or_else(sign_in_required)?;

    Ok(Json(logs_page(database, Some(&principal.0), &query).await?))
}

fn database(state: &AppState) -> Result<&AppDatabase, APIError> {
    state
        .database
        .as_ref()
        .ok_or_else(|| APIError::new(500, constants::users::DATABASE_REQUIRED))
}

fn invalid_token() -> APIError {
    APIError::new(401, constants::portal::INVALID_TOKEN)
        .with_code(constants::ErrorCode::InvalidCredentials)
}

fn sign_in_required() -> APIError {
    APIError::new(401, constants::portal::AUTH_REQUIRED)
        .with_code(constants::ErrorCode::AuthenticationRequired)
}

async fn json_body(request: Request, message: &str) -> Result<Value, APIError> {
    let bytes: Bytes = to_bytes(request.into_body(), MAX_LOGIN_BODY)
        .await
        .map_err(|_| APIError::new(400, message))?;

    serde_json::from_slice(&bytes).map_err(|_| APIError::new(400, message))
}

fn parse_login(value: &Value) -> Option<PortalLoginInput> {
    value
        .get("token")
        .and_then(Value::as_str)
        .filter(|token| !token.is_empty())
        .map(|token| PortalLoginInput {
            token: token.to_owned(),
        })
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::parse_login;

    #[test]
    fn login_accepts_only_a_non_empty_string_token() {
        assert!(parse_login(&json!({ "token": "sr-user-abc" })).is_some());
        assert!(parse_login(&json!({})).is_none());
        assert!(parse_login(&json!({ "token": "" })).is_none());
        assert!(parse_login(&json!({ "token": 7 })).is_none());
    }
}
