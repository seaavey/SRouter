//! Claude model catalog: the live snapshot read from `GET {base}/models`.
//!
//! The snapshot starts empty and is replaced in place. A failed or malformed
//! fetch never empties one that already landed, so nothing is advertised that
//! upstream has not confirmed. The endpoint answers an Anthropic-shaped payload
//! (`{ "data": [ { "id": ... } ] }`).

use std::sync::{Arc, RwLock, RwLockReadGuard, RwLockWriteGuard};

use serde_json::Value;

/// How long one fetch stays fresh. `0` marks a snapshot that has never been
/// filled, so the first request after boot is always due to fill it.
pub const CATALOG_TTL_MS: i64 = 5 * 60 * 1000;

/// How long a failed attempt on an unfilled snapshot is worth holding off. The
/// catalog GET can wait out its own timeout, and without this window every
/// request on an install that has no working catalog queues behind a fresh one.
pub const CATALOG_RETRY_MS: i64 = 30 * 1000;

/// The advertised model ids of the last answer upstream confirmed.
#[derive(Debug)]
pub struct ClaudeCatalog {
    pub fetched_at_ms: i64,
    /// When the last fetch was started, whether or not it succeeded. Only an
    /// unfilled snapshot obeys it; a filled one is governed by `CATALOG_TTL_MS`.
    pub attempted_at_ms: i64,
    pub models: Vec<String>,
}

/// The catalog handle the executor and the registry share.
pub type SharedCatalog = Arc<RwLock<ClaudeCatalog>>;

impl ClaudeCatalog {
    /// The starting snapshot: upstream has not confirmed any model yet, so
    /// nothing is advertised until a fetch lands.
    pub fn empty() -> Self {
        Self {
            fetched_at_ms: 0,
            attempted_at_ms: 0,
            models: Vec::new(),
        }
    }

    /// Builds a shared handle holding the empty starting snapshot.
    pub fn shared_empty() -> SharedCatalog {
        Arc::new(RwLock::new(Self::empty()))
    }

    /// Parses the `data` array of the Anthropic models payload. A response
    /// without any usable id yields `None` so the caller keeps the current
    /// snapshot.
    pub fn parse_model_list(value: &Value) -> Option<Self> {
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

        Some(Self {
            fetched_at_ms: 0,
            attempted_at_ms: 0,
            models,
        })
    }
}

/// Reads the snapshot without letting a panicking holder's poison spread.
pub fn read_catalog(catalog: &SharedCatalog) -> RwLockReadGuard<'_, ClaudeCatalog> {
    catalog
        .read()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Writes the snapshot without letting a panicking holder's poison spread.
pub fn write_catalog(catalog: &SharedCatalog) -> RwLockWriteGuard<'_, ClaudeCatalog> {
    catalog
        .write()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::ClaudeCatalog;

    #[test]
    fn parses_the_anthropic_model_list() {
        let payload = json!({
            "data": [
                { "id": "claude-sonnet-4-5", "display_name": "Sonnet" },
                { "id": "claude-opus-4-1" }
            ]
        });

        let catalog = ClaudeCatalog::parse_model_list(&payload).expect("list parses");

        assert_eq!(catalog.models, vec!["claude-sonnet-4-5", "claude-opus-4-1"]);
    }

    #[test]
    fn an_empty_or_malformed_list_yields_none() {
        assert!(ClaudeCatalog::parse_model_list(&json!({ "data": [] })).is_none());
        assert!(ClaudeCatalog::parse_model_list(&json!({ "models": [] })).is_none());
        assert!(ClaudeCatalog::parse_model_list(&json!("nope")).is_none());
    }
}
