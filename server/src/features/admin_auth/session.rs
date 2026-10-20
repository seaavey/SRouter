//! Session mechanics: cookie name, token hashing, cookie writers, and lookup.
//! One cookie serves the operator and customer consoles; the session row says
//! which.

use axum::http::{HeaderValue, header};
use axum::response::Response;
use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use futures_util::future::BoxFuture;
use sha2::{Digest, Sha256};

use crate::constants;
use crate::error::APIError;
use crate::state::AppState;

/// Cookie name frozen by `docs/api-v1-contract.md`.
pub const ADMIN_SESSION_COOKIE: &str = "srouter_admin_session";

/// Seven days, mirroring `ADMIN_SESSION_TTL_MS`.
pub const ADMIN_SESSION_TTL_MS: i64 = 7 * 24 * 60 * 60 * 1000;

/// Mints a session token: 32 random bytes, unpadded base64url (43 characters),
/// exactly like Node's `randomBytes(32).toString("base64url")`.
pub fn generate_session_token() -> Result<String, APIError> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes)
        .map_err(|error| APIError::new(500, constants::admin::could_not_generate_session(error)))?;

    Ok(URL_SAFE_NO_PAD.encode(bytes))
}

/// Hashes a session token exactly like the Node runtime:
/// `createHash("sha256").update(token).digest("hex")`.
pub fn hash_session_token(token: &str) -> String {
    hex::encode(Sha256::digest(token.as_bytes()))
}

/// Builds the `Set-Cookie` value for a freshly minted session. Shared with the
/// database importer, which clears the same cookie after a replacement.
pub(crate) fn session_cookie(token: &str, secure: bool) -> Result<HeaderValue, APIError> {
    let mut cookie = format!(
        "{ADMIN_SESSION_COOKIE}={token}; Max-Age={}; Path=/; HttpOnly; SameSite=Lax",
        ADMIN_SESSION_TTL_MS / 1000
    );
    if secure {
        cookie.push_str("; Secure");
    }

    HeaderValue::from_str(&cookie).map_err(|error| {
        APIError::new(
            500,
            constants::admin::could_not_build_session_cookie(&error),
        )
    })
}

/// Builds the `Set-Cookie` value that expires the session. The importer clears
/// it after a successful replacement so the operator re-authenticates.
pub(crate) fn cleared_cookie(secure: bool) -> Result<HeaderValue, APIError> {
    let mut cookie = format!("{ADMIN_SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax");
    if secure {
        cookie.push_str("; Secure");
    }

    HeaderValue::from_str(&cookie).map_err(|error| {
        APIError::new(
            500,
            constants::admin::could_not_build_cleared_cookie(&error),
        )
    })
}

/// Who a live session belongs to. One cookie serves both audiences; the row
/// carries the role, because a customer must never reach an operator route.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SessionScope {
    Admin,
    User(String),
}

/// Source of session state. `token_hash` is always `hash_session_token`
/// output; the raw cookie value never reaches a store.
pub trait SessionStore: Send + Sync {
    /// Resolves a cookie hash to its account. `None` covers an absent, expired,
    /// or owner-disabled session.
    fn resolve_session<'a>(
        &'a self,
        token_hash: &'a str,
        now_ms: i64,
    ) -> BoxFuture<'a, Result<Option<SessionScope>, APIError>>;
}

/// Stand-in for a database with no sessions: every session is invalid.
#[derive(Clone, Copy, Debug, Default)]
pub struct EmptySessionStore;

impl SessionStore for EmptySessionStore {
    fn resolve_session<'a>(
        &'a self,
        _token_hash: &'a str,
        _now_ms: i64,
    ) -> BoxFuture<'a, Result<Option<SessionScope>, APIError>> {
        Box::pin(async { Ok(None) })
    }
}

/// Creates a session row and sets the cookie on `response`.
pub(crate) async fn attach_session(
    state: &AppState,
    response: &mut Response,
    now: i64,
    user_id: Option<&str>,
) -> Result<(), APIError> {
    let token = generate_session_token()?;
    state
        .security
        .admin_auth
        .create_session(
            &hash_session_token(&token),
            now,
            now + ADMIN_SESSION_TTL_MS,
            user_id,
        )
        .await?;

    response.headers_mut().insert(
        header::SET_COOKIE,
        session_cookie(&token, state.config.secure_cookies)?,
    );

    Ok(())
}

pub(crate) fn attach_cleared_cookie(
    state: &AppState,
    response: &mut Response,
) -> Result<(), APIError> {
    response.headers_mut().insert(
        header::SET_COOKIE,
        cleared_cookie(state.config.secure_cookies)?,
    );

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{EmptySessionStore, SessionStore, generate_session_token, hash_session_token};

    #[test]
    fn generated_tokens_are_unpadded_base64url_and_unique() {
        let first = generate_session_token().unwrap();
        let second = generate_session_token().unwrap();

        assert_eq!(first.len(), 43);
        assert!(!first.contains('=') && !first.contains('+'));
        assert_ne!(first, second);
    }

    #[test]
    fn hash_session_token_matches_node() {
        assert_eq!(
            hash_session_token("abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[tokio::test]
    async fn empty_session_store_rejects_every_session() {
        let store = EmptySessionStore;

        assert!(store.resolve_session("hash", 1).await.unwrap().is_none());
    }
}
