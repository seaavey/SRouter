//! Codex model catalog: the live snapshot read from `GET /backend-api/codex/models`.
//!
//! The snapshot starts empty and is replaced in place. A failed or malformed
//! fetch never empties one that already landed, so nothing is advertised that
//! upstream has not confirmed.

use std::sync::{Arc, RwLock, RwLockReadGuard, RwLockWriteGuard};
use std::time::Duration;

use serde_json::Value;

use crate::clock::now_ms;

/// How long one fetch stays fresh. `0` marks a snapshot that has never been
/// filled, so the first request after boot is always due to fill it.
pub const CATALOG_TTL_MS: i64 = 5 * 60 * 1000;

/// How long a failed attempt on an unfilled snapshot is worth holding off. The
/// catalog GET can wait out its own timeout, and without this window every
/// request on an install that has no working catalog queues behind a fresh one.
pub const CATALOG_RETRY_MS: i64 = 30 * 1000;

/// HTTP request timeout when fetching the live model list from ChatGPT.
pub const CATALOG_REQUEST_TIMEOUT: Duration = Duration::from_secs(10);

/// The advertised model ids of the last answer upstream confirmed.
#[derive(Debug)]
pub struct CodexCatalog {
    pub fetched_at_ms: i64,
    /// When the last fetch was started, whether or not it succeeded. Only an
    /// unfilled snapshot obeys it; a filled one is governed by `CATALOG_TTL_MS`.
    pub attempted_at_ms: i64,
    pub models: Vec<String>,
}

/// The catalog handle the executor and the registry share.
pub type SharedCatalog = Arc<RwLock<CodexCatalog>>;

impl CodexCatalog {
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

    /// Parses the `models` (or fallback `data`) array of the ChatGPT Codex models payload.
    /// Filters out entries marked with `visibility: "hide"` (internal/hidden models like
    /// `codex-auto-review` or `gpt-reserve`). A response without any usable id yields `None`
    /// so the caller keeps the current snapshot.
    pub fn parse_model_list(value: &Value) -> Option<Self> {
        let entries = value
            .get("models")
            .or_else(|| value.get("data"))?
            .as_array()?;

        let mut models: Vec<String> = entries
            .iter()
            .filter(|entry| {
                entry
                    .get("visibility")
                    .and_then(Value::as_str)
                    .is_none_or(|v| v != "hide")
            })
            .filter_map(|entry| {
                entry
                    .get("slug")
                    .or_else(|| entry.get("id"))
                    .and_then(Value::as_str)
            })
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
pub fn read_catalog(catalog: &SharedCatalog) -> RwLockReadGuard<'_, CodexCatalog> {
    catalog
        .read()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Writes the snapshot without letting a panicking holder's poison spread.
pub fn write_catalog(catalog: &SharedCatalog) -> RwLockWriteGuard<'_, CodexCatalog> {
    catalog
        .write()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{CATALOG_RETRY_MS, CATALOG_TTL_MS, CodexCatalog};

    #[test]
    fn an_unfilled_snapshot_advertises_nothing_and_is_due_at_boot() {
        let catalog = CodexCatalog::empty();

        assert!(catalog.models.is_empty());
        assert!(catalog.is_empty());
        assert!(
            catalog.refresh_is_due(false, crate::clock::now_ms()),
            "a snapshot that never fetched must be worth filling"
        );
        assert!(
            catalog.refresh_is_due(true, crate::clock::now_ms()),
            "force always refreshes"
        );
    }

    #[test]
    fn parse_model_list_filters_hidden_models_and_deduplicates() {
        let payload = json!({
            "models": [
                { "slug": "gpt-6-luna", "display_name": "GPT-6-Luna", "visibility": "list" },
                { "slug": "gpt-reserve", "display_name": "GPT-Reserve", "visibility": "hide" },
                { "slug": "gpt-5.6-terra", "display_name": "GPT-5.6-Terra", "visibility": "list" },
                { "slug": "gpt-6-luna", "display_name": "GPT-6-Luna Duplicate", "visibility": "list" },
                { "slug": "codex-auto-review", "display_name": "Auto Review", "visibility": "hide" }
            ]
        });

        let catalog = CodexCatalog::parse_model_list(&payload).expect("parsed catalog");
        assert_eq!(
            catalog.models,
            vec!["gpt-5.6-terra".to_owned(), "gpt-6-luna".to_owned()]
        );
        assert!(!catalog.is_empty());
    }

    #[test]
    fn parse_model_list_falls_back_to_data_array() {
        let payload = json!({
            "data": [
                { "id": "gpt-5.6-luna", "visibility": "list" }
            ]
        });

        let catalog = CodexCatalog::parse_model_list(&payload).expect("parsed catalog");
        assert_eq!(catalog.models, vec!["gpt-5.6-luna".to_owned()]);
    }

    #[test]
    fn parse_model_list_rejects_empty_or_all_hidden_payloads() {
        let empty = json!({ "models": [] });
        assert!(CodexCatalog::parse_model_list(&empty).is_none());

        let all_hidden = json!({
            "models": [
                { "slug": "hidden-one", "visibility": "hide" }
            ]
        });
        assert!(CodexCatalog::parse_model_list(&all_hidden).is_none());

        let malformed = json!({ "unrelated": 123 });
        assert!(CodexCatalog::parse_model_list(&malformed).is_none());
    }

    #[test]
    fn ttl_and_retry_windows_govern_the_gate() {
        let now = 1_000_000_000;
        let mut catalog = CodexCatalog::empty();

        catalog.attempted_at_ms = now;
        assert!(
            !catalog.refresh_is_due(false, now),
            "an attempt holds off a fresh one"
        );
        assert!(
            !catalog.refresh_is_due(false, now + CATALOG_RETRY_MS - 1),
            "the retry window must elapse"
        );
        assert!(
            catalog.refresh_is_due(false, now + CATALOG_RETRY_MS),
            "elapsed retry window allows a fresh attempt"
        );
        assert!(
            catalog.refresh_is_due(true, now),
            "force overrides the retry window"
        );

        let payload = json!({
            "models": [
                { "slug": "gpt-6-luna", "visibility": "list" }
            ]
        });
        catalog = CodexCatalog::parse_model_list(&payload).expect("catalog");
        catalog.fetched_at_ms = now;

        assert!(!catalog.refresh_is_due(false, now));
        assert!(!catalog.refresh_is_due(false, now + CATALOG_TTL_MS - 1));
        assert!(catalog.refresh_is_due(false, now + CATALOG_TTL_MS));
        assert!(catalog.refresh_is_due(true, now));
    }
}
