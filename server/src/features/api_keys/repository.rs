//! CRUD source for API-key management (`/v1/keys`). Kept separate from
//! [`crate::features::api_keys::store::APIKeyStore`], which only serves
//! authentication lookups, so fixture auth stores do not have to implement the
//! management surface.

use futures_util::future::BoxFuture;

use crate::constants;
use crate::error::APIError;
use crate::features::api_keys::model::{
    APIKey, CreateAPIKeyInput, CreatedAPIKey, UpdateAPIKeyInput,
};

pub trait APIKeyRepository: Send + Sync {
    /// Every stored key, newest first.
    fn list(&self) -> BoxFuture<'_, Result<Vec<APIKey>, APIError>>;

    /// Persists a new key and returns it with the full secret, which is not
    /// recoverable afterwards.
    fn create(&self, input: CreateAPIKeyInput) -> BoxFuture<'_, Result<CreatedAPIKey, APIError>>;

    /// Applies a partial update; `None` means the id does not exist.
    fn update(
        &self,
        id: &str,
        patch: UpdateAPIKeyInput,
    ) -> BoxFuture<'_, Result<Option<APIKey>, APIError>>;

    /// Increases `credit_limit` by `amount`; `None` means the id does not exist.
    fn add_credit(&self, id: &str, amount: f64) -> BoxFuture<'_, Result<Option<APIKey>, APIError>>;

    /// Deletes a key; `false` means the id does not exist.
    fn delete(&self, id: &str) -> BoxFuture<'_, Result<bool, APIError>>;

    /// Atomically reserves `reserved_tokens` against the key quota, the chat
    /// admission check (`reserveAPIKeyQuotaDB`): an unlimited key
    /// (`quota_limit = 0`) always reserves, otherwise the reservation only
    /// lands while `usage_tokens + reserved <= quota_limit`. `false` means the
    /// budget did not fit; `reserved_tokens <= 0` always succeeds.
    fn reserve_quota(
        &self,
        id: &str,
        reserved_tokens: i64,
    ) -> BoxFuture<'_, Result<bool, APIError>>;

    /// Adjusts a reservation to the actual usage (`settleAPIKeyQuotaDB`):
    /// adds `actual_tokens - reserved_tokens` to `usage_tokens`. Settling to
    /// the same value is a no-op; settling to zero releases the reservation.
    fn settle_quota(
        &self,
        id: &str,
        reserved_tokens: i64,
        actual_tokens: i64,
    ) -> BoxFuture<'_, Result<(), APIError>>;

    /// Adds completed usage to the key (`incrementAPIKeyUsageDB`).
    fn increment_usage(
        &self,
        id: &str,
        tokens: i64,
        cost: f64,
    ) -> BoxFuture<'_, Result<(), APIError>>;
}

/// Stand-in used while no database is wired in. The management routes cannot
/// reach admin authorization in that state, so every method fails loudly rather
/// than pretending the write succeeded.
#[derive(Clone, Copy, Debug, Default)]
pub struct EmptyAPIKeyRepository;

impl APIKeyRepository for EmptyAPIKeyRepository {
    fn list(&self) -> BoxFuture<'_, Result<Vec<APIKey>, APIError>> {
        Box::pin(async { Err(unconfigured()) })
    }

    fn create(&self, _input: CreateAPIKeyInput) -> BoxFuture<'_, Result<CreatedAPIKey, APIError>> {
        Box::pin(async { Err(unconfigured()) })
    }

    fn update(
        &self,
        _id: &str,
        _patch: UpdateAPIKeyInput,
    ) -> BoxFuture<'_, Result<Option<APIKey>, APIError>> {
        Box::pin(async { Err(unconfigured()) })
    }

    fn add_credit(
        &self,
        _id: &str,
        _amount: f64,
    ) -> BoxFuture<'_, Result<Option<APIKey>, APIError>> {
        Box::pin(async { Err(unconfigured()) })
    }

    fn delete(&self, _id: &str) -> BoxFuture<'_, Result<bool, APIError>> {
        Box::pin(async { Err(unconfigured()) })
    }

    // Usage accounting is best-effort and only meaningful with persistence, so
    // a process without a database reserves nothing and records nothing.
    fn reserve_quota(
        &self,
        _id: &str,
        _reserved_tokens: i64,
    ) -> BoxFuture<'_, Result<bool, APIError>> {
        Box::pin(async { Ok(true) })
    }

    fn settle_quota(
        &self,
        _id: &str,
        _reserved_tokens: i64,
        _actual_tokens: i64,
    ) -> BoxFuture<'_, Result<(), APIError>> {
        Box::pin(async { Ok(()) })
    }

    fn increment_usage(
        &self,
        _id: &str,
        _tokens: i64,
        _cost: f64,
    ) -> BoxFuture<'_, Result<(), APIError>> {
        Box::pin(async { Ok(()) })
    }
}

fn unconfigured() -> APIError {
    APIError::new(500, constants::keys::PERSISTENCE_NOT_CONFIGURED)
}
