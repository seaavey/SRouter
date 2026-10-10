//! Live model catalog for a custom provider: the ids `GET {base_url}/models`
//! confirms, cached on a short TTL.
//!
//! The snapshot starts empty and is replaced in place. A failed or malformed
//! fetch never empties one that already landed, so nothing is advertised that
//! upstream has not confirmed. Both protocol families answer `{ "data": [ { "id":
//! ... } ] }`, which the single parser reads.

use std::sync::{Arc, RwLock, RwLockReadGuard, RwLockWriteGuard};

use serde_json::Value;

/// How long one fetch stays fresh. `0` marks a snapshot that has never been
/// filled, so the first request after registration is always due to fill it.
pub const CATALOG_TTL_MS: i64 = 5 * 60 * 1000;

/// How long a failed attempt on an unfilled snapshot is worth holding off.
pub const CATALOG_RETRY_MS: i64 = 30 * 1000;

/// The advertised model ids of the last answer upstream confirmed.
#[derive(Debug, Default)]
pub struct CustomCatalog {
    pub fetched_at_ms: i64,
    pub attempted_at_ms: i64,
    pub models: Vec<String>,
}

/// The catalog handle the executor and the registry share.
pub type SharedCatalog = Arc<RwLock<CustomCatalog>>;

impl CustomCatalog {
    /// Builds a shared handle holding an empty snapshot.
    pub fn shared_empty() -> SharedCatalog {
        Arc::new(RwLock::new(Self::default()))
    }

    /// Parses the `data` array of a models payload. A response without any
    /// usable id yields `None` so the caller keeps the current snapshot.
    pub fn parse_model_list(value: &Value) -> Option<Vec<String>> {
        let entries = value.get("data")?.as_array()?;

        let mut models: Vec<String> = entries
            .iter()
            .filter_map(|entry| entry.get("id").and_then(Value::as_str))
            .map(str::trim)
            .filter(|id| !id.is_empty())
            .map(str::to_owned)
            .collect();
        models.dedup();

        if models.is_empty() {
            return None;
        }

        Some(models)
    }
}

/// Reads the snapshot without letting a panicking holder's poison spread.
pub fn read_catalog(catalog: &SharedCatalog) -> RwLockReadGuard<'_, CustomCatalog> {
    catalog
        .read()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Writes the snapshot without letting a panicking holder's poison spread.
pub fn write_catalog(catalog: &SharedCatalog) -> RwLockWriteGuard<'_, CustomCatalog> {
    catalog
        .write()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::CustomCatalog;

    #[test]
    fn parses_the_data_array() {
        let payload = json!({ "data": [{ "id": "gpt-x" }, { "id": "gpt-y" }] });

        assert_eq!(
            CustomCatalog::parse_model_list(&payload),
            Some(vec!["gpt-x".to_owned(), "gpt-y".to_owned()])
        );
    }

    #[test]
    fn an_empty_or_malformed_list_yields_none() {
        assert!(CustomCatalog::parse_model_list(&json!({ "data": [] })).is_none());
        assert!(CustomCatalog::parse_model_list(&json!({ "models": [] })).is_none());
        assert!(CustomCatalog::parse_model_list(&json!("nope")).is_none());
    }
}
