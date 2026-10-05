//! CodeBuddy model catalog: the official package's `product.json` list, with a
//! live enterprise `/v3/config` merged on top.
//!
//! CodeBuddy has no `/models` endpoint and its live product config carries a
//! `models` array only for enterprise deployments; a personal account returns
//! `productFeatures` instead (verified live on 2026-10-05). The personal model
//! list therefore comes from the official client package's `product.json` (see
//! [`super::product`]), read at refresh time rather than hardcoded here. The
//! snapshot starts empty and is replaced in place. A failed or malformed fetch
//! never empties one that already landed, so nothing is advertised that the
//! vendor has not published.

use std::sync::{Arc, RwLock, RwLockReadGuard, RwLockWriteGuard};

use serde_json::Value;

/// How long one fetch stays fresh. `0` marks a snapshot that has never been
/// filled, so the first request after boot is always due to fill it.
pub const CATALOG_TTL_MS: i64 = 5 * 60 * 1000;

/// How long a failed attempt on a snapshot that never landed is worth holding
/// off. The config GET can wait out its own timeout, and without this window
/// every request on an install that has no working catalog queues behind a
/// fresh one.
pub const CATALOG_RETRY_MS: i64 = 30 * 1000;

/// The advertised model ids of the last refresh.
#[derive(Debug)]
pub struct CodeBuddyCatalog {
    pub fetched_at_ms: i64,
    /// When the last refresh was started, whether or not it landed. Only a
    /// snapshot that never landed obeys it; a filled one is governed by
    /// `CATALOG_TTL_MS`.
    pub attempted_at_ms: i64,
    pub models: Vec<String>,
}

/// The catalog handle the executor and the registry share.
pub type SharedCatalog = Arc<RwLock<CodeBuddyCatalog>>;

impl CodeBuddyCatalog {
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

    /// Parses the `data.models` array of a live product-config payload. A
    /// non-zero `code` or a non-object payload yields `None` so the caller keeps
    /// the current snapshot. A valid envelope with no `models` array (the
    /// personal-account shape) yields `Some(empty)` so the caller can still
    /// settle on the `product.json` list without retrying every request.
    pub fn parse_live(value: &Value) -> Option<Vec<String>> {
        let object = value.as_object()?;
        if let Some(code) = object.get("code").and_then(Value::as_i64)
            && code != 0
        {
            return None;
        }

        let mut models: Vec<String> = object
            .get("data")
            .and_then(|data| data.get("models"))
            .and_then(Value::as_array)
            .map(|entries| {
                entries
                    .iter()
                    .filter_map(|entry| entry.get("id")?.as_str())
                    .map(str::trim)
                    .filter(|id| !id.is_empty())
                    .map(str::to_owned)
                    .collect()
            })
            .unwrap_or_default();

        // Sorting and deduplicating keep the advertised list identical across
        // refreshes, so a reshuffle cannot look like a model appearing.
        models.sort();
        models.dedup();

        Some(models)
    }

    /// Whether nothing has been advertised yet, which is what makes a caller
    /// wait for the fetch instead of serving a stale list.
    pub fn is_empty(&self) -> bool {
        self.models.is_empty()
    }

    /// Whether a fetch is worth starting now. `force` ignores every gate; a
    /// snapshot that has never landed a refresh obeys the retry window; a
    /// filled one the TTL.
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
pub fn read_catalog(catalog: &SharedCatalog) -> RwLockReadGuard<'_, CodeBuddyCatalog> {
    catalog
        .read()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Writes the snapshot without letting a panicking holder's poison spread.
pub fn write_catalog(catalog: &SharedCatalog) -> RwLockWriteGuard<'_, CodeBuddyCatalog> {
    catalog
        .write()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{CATALOG_RETRY_MS, CATALOG_TTL_MS, CodeBuddyCatalog};

    #[test]
    fn an_unfilled_snapshot_advertises_nothing_and_is_due_at_boot() {
        let catalog = CodeBuddyCatalog::empty();

        assert!(catalog.models.is_empty());
        assert!(catalog.is_empty());
        assert!(
            catalog.refresh_is_due(false, crate::clock::now_ms()),
            "a snapshot that never fetched must be worth filling"
        );
    }

    #[test]
    fn an_unfilled_snapshot_holds_off_between_attempts() {
        let mut catalog = CodeBuddyCatalog::empty();
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
        let mut catalog = CodeBuddyCatalog::empty();
        catalog.models = vec!["gpt-5.6-astra".to_owned()];
        catalog.fetched_at_ms = 1_000;
        catalog.attempted_at_ms = 1_000;

        assert!(!catalog.is_empty());
        assert!(!catalog.refresh_is_due(false, 1_000));
        assert!(
            !catalog.refresh_is_due(false, 1_000 + CATALOG_TTL_MS - 1),
            "a fresh snapshot owes nothing before the TTL runs out"
        );
        assert!(catalog.refresh_is_due(false, 1_000 + CATALOG_TTL_MS));
        assert!(catalog.refresh_is_due(true, 1_000));
    }

    #[test]
    fn parses_the_live_data_models_ids_in_a_stable_order() {
        let models = CodeBuddyCatalog::parse_live(&json!({
            "code": 0,
            "data": {
                "models": [
                    {"id": "gpt-6-astra", "name": "GPT-6 Astra"},
                    {"id": "deepseek-v4.1-flash", "name": "DeepSeek V4.1 Flash"},
                    {"id": "gpt-6-astra", "name": "GPT-6 Astra"}
                ]
            }
        }))
        .expect("catalog parses");

        assert_eq!(models, vec!["deepseek-v4.1-flash", "gpt-6-astra"]);
    }

    #[test]
    fn a_valid_envelope_without_a_models_array_is_empty_not_an_error() {
        assert_eq!(
            CodeBuddyCatalog::parse_live(&json!({
                "code": 0,
                "data": {"enterpriseId": "", "productFeatures": {}}
            })),
            Some(Vec::new()),
            "the personal-account shape must settle without clearing the product.json list"
        );
        assert_eq!(
            CodeBuddyCatalog::parse_live(&json!({"code": 0, "data": {"models": null}})),
            Some(Vec::new())
        );
    }

    #[test]
    fn an_empty_id_never_becomes_a_model() {
        let models = CodeBuddyCatalog::parse_live(&json!({
            "code": 0,
            "data": {"models": [{"id": ""}, {"id": "   "}, {"id": " glm-5.3 "}, {"name": "no-id"}]}
        }))
        .expect("catalog parses");

        assert_eq!(models, vec!["glm-5.3"]);
    }

    #[test]
    fn a_non_zero_code_or_bad_shape_yields_none() {
        assert!(
            CodeBuddyCatalog::parse_live(&json!({
                "code": 11217,
                "data": {"models": [{"id": "gpt-5.6-astra"}]}
            }))
            .is_none(),
            "an error envelope is not a catalog"
        );
        assert_eq!(
            CodeBuddyCatalog::parse_live(&json!({"data": {"models": [{"id": "x"}]}})),
            Some(vec!["x".to_owned()]),
            "a payload without a code field is still read"
        );
        assert!(CodeBuddyCatalog::parse_live(&json!("nope")).is_none());
        assert!(CodeBuddyCatalog::parse_live(&json!(null)).is_none());
    }
}
