//! Session guards for the two consoles. Unlike the gateway middleware, an API
//! key or loopback address does not authorize here: the operator routes accept
//! only an admin-scope session and the customer routes only a user-scope one.

use axum::extract::{Request, State};
use axum::http::HeaderMap;
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};

use crate::clock::now_ms;
use crate::constants;
use crate::error::APIError;
use crate::features::admin_auth::{ADMIN_SESSION_COOKIE, SessionScope, hash_session_token};
use crate::features::api_keys::{APIPrincipal, AuthSource};
use crate::state::AppState;

use crate::request::cookie_value;

/// The identity a console route receives. A separate extension keeps the
/// gateway's principal untouched: nothing outside `features::users` reads this.
#[derive(Clone)]
pub struct PortalPrincipal(pub String);

/// Rejects the request with the frozen `401 authentication_required` envelope
/// unless the admin cookie resolves to an operator session.
pub async fn require_admin_session(
    State(state): State<AppState>,
    mut request: Request,
    next: Next,
) -> Response {
    let scope = session_scope(&state, request.headers()).await;

    match scope {
        Ok(Some(SessionScope::Admin)) => {
            request.extensions_mut().insert(APIPrincipal {
                source: AuthSource::AdminSession,
                api_key: None,
            });
            next.run(request).await
        }
        Ok(_) => unauthorized(constants::admin::AUTH_REQUIRED),
        Err(error) => error.into_response(),
    }
}

/// Rejects the request unless the cookie resolves to a customer session.
pub async fn require_user_session(
    State(state): State<AppState>,
    mut request: Request,
    next: Next,
) -> Response {
    let scope = session_scope(&state, request.headers()).await;

    match scope {
        Ok(Some(SessionScope::User(user_id))) => {
            request.extensions_mut().insert(PortalPrincipal(user_id));
            next.run(request).await
        }
        Ok(_) => unauthorized(constants::portal::AUTH_REQUIRED),
        Err(error) => error.into_response(),
    }
}

/// Resolves the shared session cookie once, for both guards.
async fn session_scope(
    state: &AppState,
    headers: &HeaderMap,
) -> Result<Option<SessionScope>, APIError> {
    let Some(token) = cookie_value(headers, ADMIN_SESSION_COOKIE) else {
        return Ok(None);
    };

    state
        .security
        .sessions
        .resolve_session(&hash_session_token(&token), now_ms())
        .await
}

fn unauthorized(message: &str) -> Response {
    APIError::new(401, message)
        .with_code(constants::ErrorCode::AuthenticationRequired)
        .into_response()
}
