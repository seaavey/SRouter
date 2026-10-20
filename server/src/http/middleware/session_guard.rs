//! Session guard for operator routes (`/v1/keys`). Unlike the gateway
//! middleware, an API key or loopback address does not authorize here; only the
//! `srouter_admin_session` cookie resolved to an admin scope does.

use axum::extract::{Request, State};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};

use crate::clock::now_ms;
use crate::constants;
use crate::error::APIError;
use crate::features::admin_auth::{ADMIN_SESSION_COOKIE, SessionScope, hash_session_token};
use crate::features::api_keys::{APIPrincipal, AuthSource};
use crate::state::AppState;

use crate::request::cookie_value;

/// Rejects the request with the frozen `401 authentication_required` envelope
/// unless the admin cookie resolves to an operator session.
pub async fn require_admin_session(
    State(state): State<AppState>,
    mut request: Request,
    next: Next,
) -> Response {
    let scope = match cookie_value(request.headers(), ADMIN_SESSION_COOKIE) {
        Some(token) => {
            match state
                .security
                .sessions
                .resolve_session(&hash_session_token(&token), now_ms())
                .await
            {
                Ok(scope) => scope,
                Err(error) => return error.into_response(),
            }
        }
        None => None,
    };

    if !matches!(scope, Some(SessionScope::Admin)) {
        return APIError::new(401, constants::admin::AUTH_REQUIRED)
            .with_code(constants::ErrorCode::AuthenticationRequired)
            .into_response();
    }

    request.extensions_mut().insert(APIPrincipal {
        source: AuthSource::AdminSession,
        api_key: None,
    });

    next.run(request).await
}
