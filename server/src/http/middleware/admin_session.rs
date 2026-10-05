//! Admin-session guard for management routes (`/v1/keys`). Unlike the gateway
//! middleware, an API key or loopback address does not authorize here; only the
//! `srouter_admin_session` cookie verified against the session store does.

use axum::extract::{Request, State};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};

use crate::clock::now_ms;
use crate::constants;
use crate::error::APIError;
use crate::features::admin_auth::{ADMIN_SESSION_COOKIE, hash_session_token};
use crate::features::api_keys::{APIPrincipal, AuthSource};
use crate::state::AppState;

use crate::request::cookie_value;

/// Rejects the request with the frozen `401 authentication_required` envelope
/// unless the admin cookie resolves to a live session.
pub async fn require_admin_session(
    State(state): State<AppState>,
    mut request: Request,
    next: Next,
) -> Response {
    let session_valid = match cookie_value(request.headers(), ADMIN_SESSION_COOKIE) {
        Some(token) => {
            match state
                .security
                .admin_sessions
                .has_valid_session(&hash_session_token(&token), now_ms())
                .await
            {
                Ok(valid) => valid,
                Err(error) => return error.into_response(),
            }
        }
        None => false,
    };

    if !session_valid {
        return APIError::new(401, constants::admin::AUTH_REQUIRED)
            .with_code(constants::code::AUTHENTICATION_REQUIRED)
            .into_response();
    }

    request.extensions_mut().insert(APIPrincipal {
        source: AuthSource::AdminSession,
        api_key: None,
    });

    next.run(request).await
}
