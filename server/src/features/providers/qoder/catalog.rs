//! Qoder model catalog: the live snapshot read from `model/list` and the static
//! seed it falls back to.
//!
//! The registry is static, so the snapshot lives inside the provider adapter and
//! is replaced in place. A failed fetch never empties it: the previous snapshot
//! (or the seed) keeps being advertised until the next attempt succeeds.

use std::collections::BTreeMap;
use std::sync::{Arc, RwLock};

use serde_json::Value;

use crate::clock::now_ms;
use crate::features::providers::qoder::types::{QODER_DEFAULT_MAX_OUTPUT, QODER_MODELS};

/// How long one fetch stays fresh. `0` marks the seed, which is always stale so
/// the first request after boot can replace it.
pub const CATALOG_TTL_MS: i64 = 5 * 60 * 1000;

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
    pub models: Vec<String>,
    pub configs: BTreeMap<String, ModelConfig>,
}

/// The catalog handle the executor and the registry share.
pub type SharedCatalog = Arc<RwLock<QoderCatalog>>;

impl QoderCatalog {
    /// The static seed: what is advertised before the first successful fetch.
    pub fn seed() -> Self {
        let mut configs = BTreeMap::new();

        for model in QODER_MODELS {
            configs.insert(
                model.id.to_owned(),
                ModelConfig {
                    key: model.id.to_owned(),
                    is_reasoning: SEED_REASONING.contains(&model.id),
                    max_output_tokens: QODER_DEFAULT_MAX_OUTPUT,
                    source: "system".to_owned(),
                },
            );
        }

        Self {
            fetched_at_ms: 0,
            models: QODER_MODELS
                .iter()
                .map(|model| model.id.to_owned())
                .collect(),
            configs,
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
            models: configs.keys().cloned().collect(),
            configs,
        })
    }

    /// The request settings of one model key, if the catalog knows it.
    pub fn config_for(&self, key: &str) -> Option<&ModelConfig> {
        self.configs.get(key)
    }

    /// Whether the snapshot is old enough to be worth replacing.
    pub fn is_stale(&self) -> bool {
        self.fetched_at_ms == 0 || now_ms() - self.fetched_at_ms >= CATALOG_TTL_MS
    }

    /// Builds a shared handle holding the seed.
    pub fn shared_seed() -> SharedCatalog {
        Arc::new(RwLock::new(Self::seed()))
    }
}

/// Seed rows the upstream has not confirmed yet: a key the static list marks as
/// reasoning gets the flag so a fresh install never sends the wrong config.
const SEED_REASONING: &[&str] = &[
    "ultimate",
    "performance",
    "dmodel",
    "dfmodel",
    "gm51model",
    "qfmodel",
    "qmodel_38max",
];

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::QoderCatalog;
    use crate::features::providers::qoder::types::QODER_MODELS;

    #[test]
    fn seed_advertises_every_static_model_with_reasoning_flags() {
        let catalog = QoderCatalog::seed();

        assert_eq!(catalog.models.len(), QODER_MODELS.len());
        assert_eq!(catalog.fetched_at_ms, 0, "the seed must always look stale");
        assert!(catalog.is_stale());
        assert!(
            catalog
                .config_for("ultimate")
                .is_some_and(|config| config.is_reasoning)
        );
        assert!(
            catalog
                .config_for("lite")
                .is_some_and(|config| !config.is_reasoning)
        );
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
        assert!(!parsed.is_stale());
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
