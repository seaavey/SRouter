//! Source of API-key records for the auth middleware.

use futures_util::future::BoxFuture;

use crate::error::APIError;
use crate::features::api_keys::model::APIKeyRecord;

/// Implementations return rows regardless of `enabled`; the middleware enforces
/// the flag itself so a disabled key always fails with `api_key_disabled`.
pub trait APIKeyStore: Send + Sync {
    fn find_by_key<'a>(
        &'a self,
        key: &'a str,
    ) -> BoxFuture<'a, Result<Option<APIKeyRecord>, APIError>>;

    /// Reads the `require_api_key` setting. Missing rows mean `false`, matching
    /// a fresh install.
    fn require_api_key(&self) -> BoxFuture<'_, Result<bool, APIError>>;
}

/// Stand-in for a database with no key rows and no settings: a fresh install.
#[derive(Clone, Copy, Debug, Default)]
pub struct EmptyAPIKeyStore;

impl APIKeyStore for EmptyAPIKeyStore {
    fn find_by_key<'a>(
        &'a self,
        _key: &'a str,
    ) -> BoxFuture<'a, Result<Option<APIKeyRecord>, APIError>> {
        Box::pin(async { Ok(None) })
    }

    fn require_api_key(&self) -> BoxFuture<'_, Result<bool, APIError>> {
        Box::pin(async { Ok(false) })
    }
}

#[cfg(test)]
mod tests {
    use super::{APIKeyStore, EmptyAPIKeyStore};

    #[tokio::test]
    async fn empty_api_key_store_reports_no_keys_and_no_requirement() {
        let store = EmptyAPIKeyStore;

        assert_eq!(store.find_by_key("sr-live-abc").await.unwrap(), None);
        assert!(!store.require_api_key().await.unwrap());
    }
}
