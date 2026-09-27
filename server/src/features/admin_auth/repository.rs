//! Admin account and session persistence for the admin-auth routes. Session
//! *validation* stays on [`AdminSessionStore`]; this trait owns the account row
//! and the session lifecycle (create/delete).

use futures_util::future::BoxFuture;

use crate::error::APIError;

pub trait AdminAuthRepository: Send + Sync {
    /// Reports whether the singleton admin account exists.
    fn has_admin_account(&self) -> BoxFuture<'_, Result<bool, APIError>>;

    /// Creates the singleton account; `false` when it already exists (first
    /// writer wins).
    fn create_admin_account(
        &self,
        password_hash: &str,
        now_ms: i64,
    ) -> BoxFuture<'_, Result<bool, APIError>>;

    /// Reads the stored password hash, or `None` before setup.
    fn get_password_hash(&self) -> BoxFuture<'_, Result<Option<String>, APIError>>;

    /// Replaces the stored password hash; `false` when no account exists.
    fn update_password_hash(
        &self,
        password_hash: &str,
        now_ms: i64,
    ) -> BoxFuture<'_, Result<bool, APIError>>;

    /// Persists a new session row keyed by the token hash.
    fn create_session(
        &self,
        token_hash: &str,
        created_at: i64,
        expires_at: i64,
    ) -> BoxFuture<'_, Result<(), APIError>>;

    /// Deletes a session row; `false` when it was already gone.
    fn delete_session(&self, token_hash: &str) -> BoxFuture<'_, Result<bool, APIError>>;
}

/// Stand-in while no database is wired in: reports a fresh install for reads
/// and fails every write, so status is answerable but setup cannot pretend to
/// succeed.
#[derive(Clone, Copy, Debug, Default)]
pub struct EmptyAdminAuthRepository;

impl AdminAuthRepository for EmptyAdminAuthRepository {
    fn has_admin_account(&self) -> BoxFuture<'_, Result<bool, APIError>> {
        Box::pin(async { Ok(false) })
    }

    fn create_admin_account(
        &self,
        _password_hash: &str,
        _now_ms: i64,
    ) -> BoxFuture<'_, Result<bool, APIError>> {
        Box::pin(async { Err(unconfigured()) })
    }

    fn get_password_hash(&self) -> BoxFuture<'_, Result<Option<String>, APIError>> {
        Box::pin(async { Ok(None) })
    }

    fn update_password_hash(
        &self,
        _password_hash: &str,
        _now_ms: i64,
    ) -> BoxFuture<'_, Result<bool, APIError>> {
        Box::pin(async { Err(unconfigured()) })
    }

    fn create_session(
        &self,
        _token_hash: &str,
        _created_at: i64,
        _expires_at: i64,
    ) -> BoxFuture<'_, Result<(), APIError>> {
        Box::pin(async { Err(unconfigured()) })
    }

    fn delete_session(&self, _token_hash: &str) -> BoxFuture<'_, Result<bool, APIError>> {
        Box::pin(async { Err(unconfigured()) })
    }
}

fn unconfigured() -> APIError {
    APIError::new(500, "admin persistence is not configured")
}
