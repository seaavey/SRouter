//! Qoder model catalog: the live snapshot read from `model/list`.
//!
//! The registry is static, so the snapshot lives inside the provider adapter and
//! is replaced in place. Nothing is advertised that upstream has not confirmed:
//! the snapshot starts empty, and a failed fetch never empties one that already
//! landed.

use std::collections::BTreeMap;
use std::sync::{Arc, RwLock};

use serde_json::Value;

use crate::clock::now_ms;
use crate::features::providers::qoder::types::QODER_DEFAULT_MAX_OUTPUT;

/// How long one fetch stays fresh. `0` marks a snapshot that has never been
/// filled, so the first request after boot is always due to fill it.
pub const CATALOG_TTL_MS: i64 = 5 * 60 * 1000;

/// How long a failed attempt on an unfilled snapshot is worth holding off. The
/// catalog GET can wait out its own timeout, and without this window every
/// request on an install that has no working catalog queues behind a fresh one.
pub const CATALOG_RETRY_MS: i64 = 30 * 1000;

/// Request settings of one upstream model key, used to fill the `model_config`
/// block of a chat request.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ModelConfig {
    pub key: String,
    pub is_reasoning: bool,
    pub max_output_tokens: i64,
    pub source: String,
}

/// The advertised model ids plus the per-key request settings.
#[derive(Clone, Debug)]
pub struct QoderCatalog {
    pub fetched_at_ms: i64,
    /// When the last fetch was started, whether or not it succeeded. Only an
    /// unfilled snapshot obeys it; a filled one is governed by `CATALOG_TTL_MS`.
    pub attempted_at_ms: i64,
    pub models: Vec<String>,
    pub configs: BTreeMap<String, ModelConfig>,
}

/// The catalog handle the executor and the registry share.
pub type SharedCatalog = Arc<RwLock<QoderCatalog>>;

impl QoderCatalog {
    /// The starting snapshot: upstream has not confirmed any model yet, so
    /// nothing is advertised until a fetch lands.
    pub fn empty() -> Self {
        Self {
            fetched_at_ms: 0,
            attempted_at_ms: 0,
            models: Vec::new(),
            configs: BTreeMap::new(),
        }
    }

    /// Parses the `chat` array of `model/list`. A response without that array
    /// yields `None` so the caller keeps the current snapshot.
    pub fn parse_chat_list(value: &Value) -> Option<Self> {
        let entries = value.get("chat")?.as_array()?;
        let mut configs = BTreeMap::new();

        for entry in entries {
            let object = entry.as_object()?;
            let key = object.get("key").and_then(Value::as_str)?.trim();

            if key.is_empty() || object.get("enable").and_then(Value::as_bool) != Some(true) {
                continue;
            }

            let is_reasoning = object
                .get("is_reasoning")
                .and_then(Value::as_bool)
                .unwrap_or(false)
                || object
                    .get("thinking_config")
                    .is_some_and(|value| !value.is_null());

            configs.insert(
                key.to_owned(),
                ModelConfig {
                    key: key.to_owned(),
                    is_reasoning,
                    max_output_tokens: object
                        .get("max_output_tokens")
                        .and_then(Value::as_i64)
                        .filter(|value| *value > 0)
                        .unwrap_or(QODER_DEFAULT_MAX_OUTPUT),
                    source: object
                        .get("source")
                        .and_then(Value::as_str)
                        .filter(|value| !value.is_empty())
                        .unwrap_or("system")
                        .to_owned(),
                },
            );
        }

        if configs.is_empty() {
            return None;
        }

        Some(Self {
            fetched_at_ms: now_ms(),
            attempted_at_ms: now_ms(),
            models: configs.keys().cloned().collect(),
            configs,
        })
    }

    /// The request settings of one model key, if the catalog knows it.
    pub fn config_for(&self, key: &str) -> Option<&ModelConfig> {
        self.configs.get(key)
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

    /// Builds a shared handle holding the empty starting snapshot.
    pub fn shared_empty() -> SharedCatalog {
        Arc::new(RwLock::new(Self::empty()))
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{CATALOG_RETRY_MS, QoderCatalog};

    #[test]
    fn an_unfilled_snapshot_advertises_nothing_and_is_due_at_boot() {
        let catalog = QoderCatalog::empty();

        assert!(catalog.models.is_empty());
        assert!(catalog.is_empty());
        assert!(catalog.configs.is_empty());
        assert!(catalog.config_for("auto").is_none());
        assert!(
            catalog.refresh_is_due(false, crate::clock::now_ms()),
            "a snapshot that never fetched must be worth filling"
        );
    }

    #[test]
    fn an_unfilled_snapshot_holds_off_between_attempts() {
        let mut catalog = QoderCatalog::empty();
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
        let parsed = QoderCatalog::parse_chat_list(&json!({
            "chat": [{"key": "auto", "enable": true}]
        }))
        .expect("catalog parses");

        assert!(!parsed.is_empty());
        assert!(!parsed.refresh_is_due(false, parsed.fetched_at_ms));
        assert!(parsed.refresh_is_due(true, parsed.fetched_at_ms));
    }

    #[test]
    fn parses_only_enabled_entries() {
        let parsed = QoderCatalog::parse_chat_list(&json!({
            "chat": [
                {"key": "qmodel_latest", "enable": true, "is_reasoning": false, "max_output_tokens": 8192},
                {"key": "disabled-model", "enable": false},
                {"key": "", "enable": true},
                {"key": "thinking-model", "enable": true, "thinking_config": {"enabled": {"efforts": ["low"]}}}
            ]
        }))
        .expect("catalog parses");

        assert_eq!(parsed.models, vec!["qmodel_latest", "thinking-model"]);
        assert_eq!(
            parsed
                .config_for("qmodel_latest")
                .map(|c| c.max_output_tokens),
            Some(8192)
        );
        assert!(
            parsed
                .config_for("thinking-model")
                .is_some_and(|c| c.is_reasoning)
        );
        assert_eq!(parsed.attempted_at_ms, parsed.fetched_at_ms);
    }

    #[test]
    fn a_response_without_models_yields_none() {
        assert!(QoderCatalog::parse_chat_list(&json!({"chat": []})).is_none());
        assert!(QoderCatalog::parse_chat_list(&json!({"error": "nope"})).is_none());
        assert!(
            QoderCatalog::parse_chat_list(&json!({"chat": [{"key": "x"}]})).is_none(),
            "an entry without enable must not become a model"
        );
    }
}
