//! Qoder model catalog: the live snapshot read from `model/list`.
//!
//! The registry is static, so the snapshot lives inside the provider adapter and
//! is replaced in place. Nothing is advertised that upstream has not confirmed:
//! the snapshot starts empty, and a failed fetch never empties one that already
//! landed. A confirmed key is also advertised under its `display_name`, so
//! `qd/qfmodel` and `qd/qwen3.8-flash` name one model.

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
    /// Every id this snapshot advertises, raw keys and friendly names together.
    pub models: Vec<String>,
    pub configs: BTreeMap<String, ModelConfig>,
    /// Advertised id -> the raw key a request must carry. Every key maps to
    /// itself, so one lookup serves both kinds of id.
    pub names: BTreeMap<String, String>,
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
            names: BTreeMap::new(),
        }
    }

    /// Parses the `chat` array of `model/list`. A response without that array
    /// yields `None` so the caller keeps the current snapshot.
    pub fn parse_chat_list(value: &Value) -> Option<Self> {
        let entries = value.get("chat")?.as_array()?;
        let mut configs = BTreeMap::new();
        let mut display_names = BTreeMap::new();

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

            if let Some(id) = object
                .get("display_name")
                .and_then(Value::as_str)
                .and_then(|name| advertised_id(name, key))
            {
                display_names.insert(key.to_owned(), id);
            }
        }

        if configs.is_empty() {
            return None;
        }

        let names = advertised_names(&configs, display_names);

        Some(Self {
            fetched_at_ms: now_ms(),
            attempted_at_ms: now_ms(),
            // A `BTreeMap` iterates in key order, so the list is sorted without
            // another pass and a refresh cannot reshuffle it.
            models: names.keys().cloned().collect(),
            configs,
            names,
        })
    }

    /// The raw key an advertised id asks for. An id the snapshot does not hold
    /// is `None`, which sends the caller to the static alias table.
    pub fn key_for_id(&self, id: &str) -> Option<&str> {
        if let Some(key) = self.names.get(id) {
            return Some(key);
        }

        // Ids are advertised lowercase while a client may send any case.
        self.names.get(&id.to_lowercase()).map(String::as_str)
    }

    /// Every id that reaches this key: the raw key itself plus each name it was
    /// allowed to advertise. A key the snapshot does not hold yields nothing.
    pub fn ids_for_key(&self, key: &str) -> Vec<String> {
        self.names
            .iter()
            .filter(|(_, mapped)| *mapped == key)
            .map(|(id, _)| id.clone())
            .collect()
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

/// How long an advertised id may be. Upstream names are short; the cap keeps a
/// runaway display name out of a route path.
const MAX_ADVERTISED_ID_LEN: usize = 64;

/// Transcribes an upstream `display_name` into an id this gateway may advertise.
///
/// Returns `None` rather than repairing a name it cannot carry: an id upstream
/// never used must not appear in the list, so a character outside the model-id
/// set, an over-long name, or one that says no more than the key already says
/// ends the search instead of a transliteration.
fn advertised_id(display_name: &str, key: &str) -> Option<String> {
    // One split on whitespace and dashes both joins and cleans: runs collapse
    // and either end is stripped, so ` Qwen -- 3.8 ` still yields `qwen-3.8`.
    let lowered = display_name.to_lowercase();
    let id = lowered
        .split(|c: char| c.is_whitespace() || c == '-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-");

    let id_ok = !id.is_empty()
        && id.len() <= MAX_ADVERTISED_ID_LEN
        && id.chars().any(|c| c.is_ascii_alphanumeric())
        && id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '.' | '_' | '-'));

    if !id_ok || id.eq_ignore_ascii_case(key) {
        return None;
    }

    Some(id)
}

/// Every id the snapshot advertises, mapped to the key a request must carry.
///
/// Each live key maps to itself; a display name is accepted only when no key and
/// no earlier name already holds it. Names are weighed in raw-key order, so two
/// models sharing one name cannot reshuffle the list between refreshes.
fn advertised_names(
    configs: &BTreeMap<String, ModelConfig>,
    display_names: BTreeMap<String, String>,
) -> BTreeMap<String, String> {
    let mut names: BTreeMap<String, String> = configs
        .keys()
        .map(|key| (key.clone(), key.clone()))
        .collect();

    for (key, id) in display_names {
        names.entry(id).or_insert(key);
    }

    names
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

    #[test]
    fn advertises_each_key_under_a_usable_display_name_as_well() {
        let parsed = QoderCatalog::parse_chat_list(&json!({
            "chat": [
                {"key": "qfmodel", "enable": true, "display_name": "Qwen3.8-Flash"},
                {"key": "dmodel", "enable": true, "display_name": "Deep Seek  V4  Pro"},
                {"key": "auto", "enable": true, "display_name": "Auto"}
            ]
        }))
        .expect("catalog parses");

        assert_eq!(
            parsed.models,
            vec![
                "auto",
                "deep-seek-v4-pro",
                "dmodel",
                "qfmodel",
                "qwen3.8-flash"
            ]
        );
        assert_eq!(parsed.key_for_id("qwen3.8-flash"), Some("qfmodel"));
        assert_eq!(parsed.key_for_id("qfmodel"), Some("qfmodel"));
        assert_eq!(parsed.key_for_id("QWEN3.8-FLASH"), Some("qfmodel"));
        assert_eq!(parsed.key_for_id("auto"), Some("auto"));
        assert!(parsed.key_for_id("anything-else").is_none());
        assert_eq!(
            parsed.ids_for_key("qfmodel"),
            vec!["qfmodel", "qwen3.8-flash"]
        );
        assert_eq!(parsed.ids_for_key("auto"), vec!["auto"]);
        assert!(parsed.ids_for_key("never-served").is_empty());
        assert!(
            parsed.config_for("qwen3.8-flash").is_none(),
            "a friendly id must not pass for the request settings of its key"
        );
    }

    #[test]
    fn a_display_name_that_cannot_be_an_id_advertises_only_the_key() {
        let long = format!("qwen-{}", "x".repeat(70));

        for (key, name) in [
            ("qfmodel", "Qwen3.8-Flash!"),
            ("qmodel", "Qwen 3.7 Édition"),
            ("kmodel", "--"),
            ("dmodel", long.as_str()),
            ("mmodel", "   "),
        ] {
            let parsed = QoderCatalog::parse_chat_list(&json!({
                "chat": [{"key": key, "enable": true, "display_name": name}]
            }))
            .expect("catalog parses");

            assert_eq!(
                parsed.models,
                vec![key],
                "{name:?} must not become an id for {key}"
            );
        }
    }

    #[test]
    fn one_friendly_name_serves_one_key_and_never_overrides_a_live_key() {
        let shared = QoderCatalog::parse_chat_list(&json!({
            "chat": [
                {"key": "kmodel_latest", "enable": true, "display_name": "Kimi K2"},
                {"key": "kmodel", "enable": true, "display_name": "Kimi-K2"}
            ]
        }))
        .expect("catalog parses");

        assert_eq!(
            shared.models,
            vec!["kimi-k2", "kmodel", "kmodel_latest"],
            "the first key in catalog order keeps the name"
        );
        assert_eq!(shared.key_for_id("kimi-k2"), Some("kmodel"));
        assert_eq!(shared.ids_for_key("kmodel_latest"), vec!["kmodel_latest"]);

        let clashing = QoderCatalog::parse_chat_list(&json!({
            "chat": [
                {"key": "qfmodel", "enable": true, "display_name": "gfmodel"},
                {"key": "gfmodel", "enable": true}
            ]
        }))
        .expect("catalog parses");

        assert_eq!(
            clashing.ids_for_key("gfmodel"),
            vec!["gfmodel"],
            "a name that is another model's key must not be advertised twice"
        );
    }
}
