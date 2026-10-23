//! OpenCode Zen model catalog: the curated seed merged with the live snapshot
//! read from `GET /inference/v1/models`.
//!
//! The endpoint lists every Zen tier, so only the free-tier chat ids the
//! OpenAI-protocol executor can serve are merged in: the paid models need a
//! Zen subscription the provider metadata does not ask for, and the ids served
//! on `/v1/systemone` or `/v1/responses` answer `400 ModelProtocolUnsupported`.
//! The snapshot starts empty, which leaves the seed advertised, and is replaced
//! in place. A failed or malformed fetch never empties one that already landed.

use std::sync::{Arc, RwLock, RwLockReadGuard, RwLockWriteGuard};

use serde_json::Value;

/// How long one fetch stays fresh. `0` marks a snapshot that has never been
/// filled, so the first request after boot is always due to fill it.
pub const CATALOG_TTL_MS: i64 = 5 * 60 * 1000;

/// How long a failed attempt on an unfilled snapshot is worth holding off. The
/// catalog GET can wait out its own timeout, and without this window every
/// request on an install that has no working catalog queues behind a fresh one.
pub const CATALOG_RETRY_MS: i64 = 30 * 1000;

/// The free tiers carry this suffix; the stealth model is free without one.
const FREE_SUFFIX: &str = "-free";
const STEALTH_FREE_MODEL: &str = "big-pickle";

/// Free ids the OpenAI-protocol executor cannot route, kept out of the fetch
/// the same way the seed excludes them.
const NON_CHAT_FREE_MODELS: &[&str] = &["jev-1.13-free"];

/// The advertised model ids of the last refresh.
#[derive(Debug)]
pub struct OpenCodeCatalog {
    pub fetched_at_ms: i64,
    /// When the last fetch was started, whether or not it succeeded. Only an
    /// unfilled snapshot obeys it; a filled one is governed by `CATALOG_TTL_MS`.
    pub attempted_at_ms: i64,
    pub models: Vec<String>,
}

/// The catalog handle the executor and the registry share.
pub type SharedCatalog = Arc<RwLock<OpenCodeCatalog>>;

impl OpenCodeCatalog {
    /// The starting snapshot: upstream has not been merged in yet, so the seed
    /// is what the driver advertises until a fetch lands.
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

    /// Parses the `data` array of the live list, keeping the free-tier chat ids.
    /// A payload without a usable id yields `None` so the caller keeps the
    /// current snapshot.
    pub fn parse_live(value: &Value) -> Option<Vec<String>> {
        let data = value.get("data")?.as_array()?;
        let mut models: Vec<String> = data
            .iter()
            .filter_map(|entry| entry.get("id")?.as_str())
            .map(str::trim)
            .filter(|id| {
                !id.is_empty()
                    && (*id == STEALTH_FREE_MODEL || id.ends_with(FREE_SUFFIX))
                    && !NON_CHAT_FREE_MODELS.contains(id)
            })
            .map(str::to_owned)
            .collect();

        if models.is_empty() {
            return None;
        }

        // Sorting and deduplicating keep the advertised list identical across
        // refreshes, so a reshuffle cannot look like a model appearing.
        models.sort();
        models.dedup();

        Some(models)
    }

    /// Whether nothing has been merged in yet, which is what makes a caller
    /// wait for the fetch instead of serving the seed alone.
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
pub fn read_catalog(catalog: &SharedCatalog) -> RwLockReadGuard<'_, OpenCodeCatalog> {
    catalog
        .read()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Writes the snapshot without letting a panicking holder's poison spread.
pub fn write_catalog(catalog: &SharedCatalog) -> RwLockWriteGuard<'_, OpenCodeCatalog> {
    catalog
        .write()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{CATALOG_RETRY_MS, CATALOG_TTL_MS, OpenCodeCatalog};

    #[test]
    fn an_unfilled_snapshot_advertises_nothing_and_is_due_at_boot() {
        let catalog = OpenCodeCatalog::empty();

        assert!(catalog.models.is_empty());
        assert!(catalog.is_empty());
        assert!(
            catalog.refresh_is_due(false, crate::clock::now_ms()),
            "a snapshot that never fetched must be worth filling"
        );
    }

    #[test]
    fn an_unfilled_snapshot_holds_off_between_attempts() {
        let mut catalog = OpenCodeCatalog::empty();
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
        let mut catalog = OpenCodeCatalog::empty();
        catalog.models = vec!["beam-free".to_owned()];
        catalog.fetched_at_ms = 1_000;
        catalog.attempted_at_ms = 1_000;

        assert!(!catalog.is_empty());
        assert!(
            !catalog.refresh_is_due(false, 1_000 + CATALOG_TTL_MS - 1),
            "a fresh snapshot owes nothing before the TTL runs out"
        );
        assert!(catalog.refresh_is_due(false, 1_000 + CATALOG_TTL_MS));
        assert!(catalog.refresh_is_due(true, 1_000));
    }

    #[test]
    fn only_the_free_tier_chat_ids_are_kept_in_a_stable_order() {
        let models = OpenCodeCatalog::parse_live(&json!({
            "object": "list",
            "data": [
                {"id": "gpt-5.5"},
                {"id": "beam-free"},
                {"id": "jev-1.13-free"},
                {"id": "big-pickle"},
                {"id": "flint-40b-free"},
                {"id": "beam-free"},
                {"id": "muse-spark-1.2"},
                {"id": ""}
            ]
        }))
        .expect("catalog parses");

        assert_eq!(models, vec!["beam-free", "big-pickle", "flint-40b-free"]);
    }

    #[test]
    fn a_payload_without_a_free_id_yields_none() {
        assert!(OpenCodeCatalog::parse_live(&json!({"data": []})).is_none());
        assert!(OpenCodeCatalog::parse_live(&json!({"data": [{"id": "gpt-5.5"}]})).is_none());
        assert!(OpenCodeCatalog::parse_live(&json!({"error": "nope"})).is_none());
        assert!(OpenCodeCatalog::parse_live(&json!(null)).is_none());
    }
}
