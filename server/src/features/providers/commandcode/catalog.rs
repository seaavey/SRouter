//! Command Code model catalog: the public `/provider/v1/models` list.
//!
//! The list is public and accepts the same key as inference, but it is not an
//! entitlement check — it says what the platform offers, not what the signed-in
//! plan can call. The snapshot starts empty and is replaced in place; a failed or
//! malformed fetch never empties one that already landed. Upstream order is kept
//! because the vendor already puts zero-cost entries where it wants them.

use std::sync::{Arc, RwLock, RwLockReadGuard, RwLockWriteGuard};

use serde_json::Value;

/// How long one fetch stays fresh. `0` marks a snapshot that has never been
/// filled, so the first request after boot is always due to fill it.
pub const CATALOG_TTL_MS: i64 = 5 * 60 * 1000;

/// How long a failed attempt on a snapshot that never landed is worth holding
/// off, so every request on an install with no working catalog does not queue
/// behind a fresh fetch.
pub const CATALOG_RETRY_MS: i64 = 30 * 1000;

/// The advertised model ids of the last refresh, in the vendor's order.
#[derive(Debug)]
pub struct CommandCodeCatalog {
    pub fetched_at_ms: i64,
    /// When the last refresh was started, whether or not it landed. Only a
    /// snapshot that never landed obeys it; a filled one follows the TTL.
    pub attempted_at_ms: i64,
    pub models: Vec<String>,
}

/// The catalog handle the executor and the registry share.
pub type SharedCatalog = Arc<RwLock<CommandCodeCatalog>>;

impl CommandCodeCatalog {
    pub fn empty() -> Self {
        Self {
            fetched_at_ms: 0,
            attempted_at_ms: 0,
            models: Vec::new(),
        }
    }

    pub fn shared_empty() -> SharedCatalog {
        Arc::new(RwLock::new(Self::empty()))
    }

    /// Reads the `data` array of a live catalog payload, accepting both the
    /// `{"id": …}` rows and bare strings. `None` when the payload is not an
    /// envelope at all, so the caller keeps the current snapshot.
    pub fn parse_models(value: &Value) -> Option<Vec<String>> {
        let object = value.as_object()?;
        let rows = object.get("data").or_else(|| object.get("models"))?;
        let rows = rows.as_array()?;

        let mut models: Vec<String> = Vec::new();
        for row in rows {
            let id = row
                .get("id")
                .and_then(Value::as_str)
                .or_else(|| row.as_str())
                .map(str::trim)
                .filter(|id| !id.is_empty());
            let Some(id) = id else {
                continue;
            };
            if !models.iter().any(|known| known == id) {
                models.push(id.to_owned());
            }
        }

        Some(models)
    }

    pub fn is_empty(&self) -> bool {
        self.models.is_empty()
    }

    /// Whether a fetch is worth starting now. `force` ignores every gate.
    pub fn refresh_is_due(&self, force: bool, now_ms: i64) -> bool {
        if force {
            return true;
        }

        if self.fetched_at_ms == 0 {
            return now_ms - self.attempted_at_ms >= CATALOG_RETRY_MS;
        }

        now_ms - self.fetched_at_ms >= CATALOG_TTL_MS
    }
}

/// Reads the snapshot without letting a panicking holder's poison spread.
pub fn read_catalog(catalog: &SharedCatalog) -> RwLockReadGuard<'_, CommandCodeCatalog> {
    catalog
        .read()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Writes the snapshot without letting a panicking holder's poison spread.
pub fn write_catalog(catalog: &SharedCatalog) -> RwLockWriteGuard<'_, CommandCodeCatalog> {
    catalog
        .write()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{CATALOG_RETRY_MS, CATALOG_TTL_MS, CommandCodeCatalog};

    #[test]
    fn an_unfilled_snapshot_advertises_nothing_and_is_due_at_boot() {
        let catalog = CommandCodeCatalog::empty();

        assert!(catalog.models.is_empty());
        assert!(catalog.refresh_is_due(false, crate::clock::now_ms()));
    }

    #[test]
    fn an_unfilled_snapshot_holds_off_between_attempts() {
        let mut catalog = CommandCodeCatalog::empty();
        catalog.attempted_at_ms = 1_000;

        assert!(!catalog.refresh_is_due(false, 1_000 + CATALOG_RETRY_MS - 1));
        assert!(catalog.refresh_is_due(false, 1_000 + CATALOG_RETRY_MS));
        assert!(catalog.refresh_is_due(true, 1_000));
    }

    #[test]
    fn a_filled_snapshot_obeys_the_ttl_not_the_retry_window() {
        let mut catalog = CommandCodeCatalog::empty();
        catalog.models = vec!["deepseek/deepseek-v4.1-flash".to_owned()];
        catalog.fetched_at_ms = 1_000;
        catalog.attempted_at_ms = 1_000;

        assert!(!catalog.refresh_is_due(false, 1_000 + CATALOG_TTL_MS - 1));
        assert!(catalog.refresh_is_due(false, 1_000 + CATALOG_TTL_MS));
    }

    #[test]
    fn the_vendor_order_survives_and_duplicates_collapse() {
        let models = CommandCodeCatalog::parse_models(&json!({
            "data": [
                {"id": "poolside/laguna-s-2.1-free"},
                {"id": "deepseek/deepseek-v4.1-flash"},
                {"id": "poolside/laguna-s-2.1-free"},
                {"id": "  Qwen/Qwen3.8-Max-0902  "},
                {"id": ""},
                {"name": "no-id"}
            ]
        }))
        .expect("catalog parses");

        assert_eq!(
            models,
            vec![
                "poolside/laguna-s-2.1-free",
                "deepseek/deepseek-v4.1-flash",
                "Qwen/Qwen3.8-Max-0902",
            ],
            "a reshuffle must not look like models appearing"
        );
    }

    #[test]
    fn bare_string_rows_are_read_too() {
        let models =
            CommandCodeCatalog::parse_models(&json!({ "data": ["a/b", " c/d "] })).expect("parses");

        assert_eq!(models, vec!["a/b", "c/d"]);
    }

    #[test]
    fn a_payload_without_a_data_array_is_not_a_catalog() {
        assert!(CommandCodeCatalog::parse_models(&json!({"object": "list"})).is_none());
        assert!(CommandCodeCatalog::parse_models(&json!({"data": null})).is_none());
        assert!(CommandCodeCatalog::parse_models(&json!("nope")).is_none());
        assert_eq!(
            CommandCodeCatalog::parse_models(&json!({"data": []})),
            Some(Vec::new())
        );
    }
}
