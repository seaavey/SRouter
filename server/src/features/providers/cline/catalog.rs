//! Cline model catalog: the live snapshot read from `GET /models`.
//!
//! The snapshot starts empty and is replaced in place. A failed or malformed
//! fetch never empties one that already landed, so nothing is advertised that
//! upstream has not confirmed.

use std::sync::{Arc, RwLock, RwLockReadGuard, RwLockWriteGuard};

use serde_json::Value;

use crate::clock::now_ms;

/// How long one fetch stays fresh. `0` marks a snapshot that has never been
/// filled, so the first request after boot is always due to fill it.
pub const CATALOG_TTL_MS: i64 = 5 * 60 * 1000;

/// How long a failed attempt on an unfilled snapshot is worth holding off. The
/// catalog GET can wait out its own timeout, and without this window every
/// request on an install that has no working catalog queues behind a fresh one.
pub const CATALOG_RETRY_MS: i64 = 30 * 1000;

/// The advertised model ids of the last answer upstream confirmed.
#[derive(Debug)]
pub struct ClineCatalog {
    pub fetched_at_ms: i64,
    /// When the last fetch was started, whether or not it succeeded. Only an
    /// unfilled snapshot obeys it; a filled one is governed by `CATALOG_TTL_MS`.
    pub attempted_at_ms: i64,
    pub models: Vec<String>,
}

/// The catalog handle the executor and the registry share.
pub type SharedCatalog = Arc<RwLock<ClineCatalog>>;

impl ClineCatalog {
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

    /// Parses the `data` array of an OpenAI list payload. A response without a
    /// usable id yields `None` so the caller keeps the current snapshot.
    pub fn parse_model_list(value: &Value) -> Option<Self> {
        let data = value.get("data")?.as_array()?;
        let mut models: Vec<String> = data
            .iter()
            .filter_map(|entry| entry.get("id")?.as_str())
            .map(str::trim)
            .filter(|id| !id.is_empty())
            .map(str::to_owned)
            .collect();

        if models.is_empty() {
            return None;
        }

        // Sorting and deduplicating keep the advertised list identical across
        // refreshes, so a reshuffle cannot look like a model appearing.
        models.sort();
        models.dedup();

        let fetched_at_ms = now_ms();

        Some(Self {
            fetched_at_ms,
            attempted_at_ms: fetched_at_ms,
            models,
        })
    }

    /// Parses the `free` array of the curated recommended-models payload.
    /// Those entries carry the `cline-free/*` ids that `GET /models` never
    /// lists, so a response without them simply adds nothing.
    pub fn parse_free_list(value: &Value) -> Vec<String> {
        let Some(entries) = value.get("free").and_then(Value::as_array) else {
            return Vec::new();
        };

        let mut models: Vec<String> = entries
            .iter()
            .filter_map(|entry| entry.get("id")?.as_str())
            .map(str::trim)
            .filter(|id| !id.is_empty())
            .map(str::to_owned)
            .collect();
        models.sort();
        models.dedup();
        models
    }

    /// Whether nothing has been advertised yet, which is what makes a caller
    /// wait for the fetch instead of serving a stale list.
    pub fn is_empty(&self) -> bool {
        self.models.is_empty()
    }

    /// Whether a fetch is worth starting now. `force` ignores every gate; an
    /// unfilled snapshot obeys the retry window; a filled one the TTL.
    pub fn refresh_is_due(&self, force: bool, now_ms: i64) -> bool {
        if force {
            return true;
        }

        if self.models.is_empty() {
            return now_ms - self.attempted_at_ms >= CATALOG_RETRY_MS;
        }

        self.fetched_at_ms == 0 || now_ms - self.fetched_at_ms >= CATALOG_TTL_MS
    }
}

/// Reads the snapshot without letting a panicking holder's poison spread.
pub fn read_catalog(catalog: &SharedCatalog) -> RwLockReadGuard<'_, ClineCatalog> {
    catalog
        .read()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Writes the snapshot without letting a panicking holder's poison spread.
pub fn write_catalog(catalog: &SharedCatalog) -> RwLockWriteGuard<'_, ClineCatalog> {
    catalog
        .write()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{CATALOG_RETRY_MS, CATALOG_TTL_MS, ClineCatalog};

    #[test]
    fn an_unfilled_snapshot_advertises_nothing_and_is_due_at_boot() {
        let catalog = ClineCatalog::empty();

        assert!(catalog.models.is_empty());
        assert!(catalog.is_empty());
        assert!(
            catalog.refresh_is_due(false, crate::clock::now_ms()),
            "a snapshot that never fetched must be worth filling"
        );
    }

    #[test]
    fn an_unfilled_snapshot_holds_off_between_attempts() {
        let mut catalog = ClineCatalog::empty();
        catalog.attempted_at_ms = 1_000;

        assert!(
            !catalog.refresh_is_due(false, 1_000 + CATALOG_RETRY_MS - 1),
            "a failed attempt must not make every request queue behind a new fetch"
        );
        assert!(catalog.refresh_is_due(false, 1_000 + CATALOG_RETRY_MS));
        assert!(
            catalog.refresh_is_due(true, 1_000),
            "force breaks through the retry window"
        );
    }

    #[test]
    fn a_filled_snapshot_obeys_the_ttl_not_the_retry_window() {
        let parsed = ClineCatalog::parse_model_list(&json!({
            "object": "list",
            "data": [{"id": "anthropic/claude-sonnet-5.5"}]
        }))
        .expect("catalog parses");

        assert!(!parsed.is_empty());
        assert!(!parsed.refresh_is_due(false, parsed.fetched_at_ms));
        assert!(
            !parsed.refresh_is_due(false, parsed.fetched_at_ms + CATALOG_TTL_MS - 1),
            "a fresh snapshot owes nothing before the TTL runs out"
        );
        assert!(parsed.refresh_is_due(false, parsed.fetched_at_ms + CATALOG_TTL_MS));
        assert!(parsed.refresh_is_due(true, parsed.fetched_at_ms));
    }

    #[test]
    fn parses_the_data_ids_in_a_stable_order() {
        let parsed = ClineCatalog::parse_model_list(&json!({
            "object": "list",
            "data": [
                {"id": "openai/gpt-5.2"},
                {"id": "anthropic/claude-sonnet-5.5"},
                {"id": "openai/gpt-5.2"}
            ]
        }))
        .expect("catalog parses");

        assert_eq!(
            parsed.models,
            vec!["anthropic/claude-sonnet-5.5", "openai/gpt-5.2"]
        );
        assert_eq!(parsed.attempted_at_ms, parsed.fetched_at_ms);
    }

    #[test]
    fn an_empty_id_never_becomes_a_model() {
        let parsed = ClineCatalog::parse_model_list(&json!({
            "data": [{"id": ""}, {"id": "   "}, {"id": "  zai/glm-5 "}, {"name": "no-id"}]
        }))
        .expect("catalog parses");

        assert_eq!(parsed.models, vec!["zai/glm-5"]);
        assert!(
            ClineCatalog::parse_model_list(&json!({"data": [{"id": ""}]})).is_none(),
            "a response without a usable id must keep the current snapshot"
        );
    }

    #[test]
    fn a_response_without_usable_data_yields_none() {
        assert!(ClineCatalog::parse_model_list(&json!({"data": []})).is_none());
        assert!(ClineCatalog::parse_model_list(&json!({"error": "nope"})).is_none());
        assert!(ClineCatalog::parse_model_list(&json!({"data": "claude"})).is_none());
        assert!(ClineCatalog::parse_model_list(&json!(null)).is_none());
    }

    #[test]
    fn the_curated_free_ids_parse_sorted_and_empty_safe() {
        assert_eq!(
            ClineCatalog::parse_free_list(&json!({
                "recommended": [{"id": "anthropic/claude-sonnet-5.5"}],
                "free": [
                    {"id": "cline-free/deepseek-v4.1-flash"},
                    {"id": "cline-free/mimo-v2.6-flash"},
                    {"id": "cline-free/deepseek-v4.1-flash"},
                    {"id": "  "},
                    {"name": "no-id"}
                ]
            })),
            vec![
                "cline-free/deepseek-v4.1-flash",
                "cline-free/mimo-v2.6-flash"
            ],
            "the curated list adds only the free ids, sorted and deduplicated"
        );
        assert!(ClineCatalog::parse_free_list(&json!({})).is_empty());
        assert!(ClineCatalog::parse_free_list(&json!({"free": "nope"})).is_empty());
        assert!(ClineCatalog::parse_free_list(&json!(null)).is_empty());
    }
}
