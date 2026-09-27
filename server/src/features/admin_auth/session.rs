//! Admin session mechanics: cookie name, token hashing, and session lookup.
//! Kept separate from API keys because admin login owns these values.

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use futures_util::future::BoxFuture;
use sha2::{Digest, Sha256};

use crate::error::APIError;

/// Cookie name frozen by `docs/api-v1-contract.md`.
pub const ADMIN_SESSION_COOKIE: &str = "srouter_admin_session";

/// Seven days, mirroring `ADMIN_SESSION_TTL_MS`.
pub const ADMIN_SESSION_TTL_MS: i64 = 7 * 24 * 60 * 60 * 1000;

/// Mints a session token: 32 random bytes, unpadded base64url (43 characters),
/// exactly like Node's `randomBytes(32).toString("base64url")`.
pub fn generate_session_token() -> Result<String, APIError> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes)
        .map_err(|error| APIError::new(500, format!("could not generate a session: {error}")))?;

    Ok(URL_SAFE_NO_PAD.encode(bytes))
}

/// Hashes a session token exactly like the Node runtime:
/// `createHash("sha256").update(token).digest("hex")`.
pub fn hash_session_token(token: &str) -> String {
    hex::encode(Sha256::digest(token.as_bytes()))
}

/// Source of admin session state. `token_hash` is always `hash_session_token`
/// output; the raw cookie value never reaches a store.
pub trait AdminSessionStore: Send + Sync {
    fn has_valid_session<'a>(
        &'a self,
        token_hash: &'a str,
        now_ms: i64,
    ) -> BoxFuture<'a, Result<bool, APIError>>;
}

/// Stand-in for a database with no sessions: every session is invalid.
#[derive(Clone, Copy, Debug, Default)]
pub struct EmptyAdminSessionStore;

impl AdminSessionStore for EmptyAdminSessionStore {
    fn has_valid_session<'a>(
        &'a self,
        _token_hash: &'a str,
        _now_ms: i64,
    ) -> BoxFuture<'a, Result<bool, APIError>> {
        Box::pin(async { Ok(false) })
    }
}

#[cfg(test)]
mod tests {
    use super::{
        AdminSessionStore, EmptyAdminSessionStore, generate_session_token, hash_session_token,
    };

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
    async fn empty_admin_session_store_rejects_every_session() {
        let store = EmptyAdminSessionStore;

        assert!(!store.has_valid_session("hash", 1).await.unwrap());
    }
}
