//! Provider registry: resolves a requested model onto the adapter that serves
//! it. Registration covers the provider base id and its aliases.

use std::collections::{HashMap, HashSet};

use crate::error::APIError;
use crate::features::providers::adapter::ProviderAdapter;
use crate::features::providers::model::ModelObject;
use crate::features::providers::opencode;
use crate::features::providers::qoder;
use crate::features::providers::qoder::types::QoderEndpoints;
use crate::infrastructure::database::AppDatabase;

/// A resolved request target: the adapter to call and the bare model id the
/// provider expects upstream.
#[derive(Clone)]
pub struct ResolvedModel {
    pub adapter: ProviderAdapter,
    pub model: String,
}

/// Adapters keyed by base id and alias.
#[derive(Clone, Default)]
pub struct ProviderRegistry {
    adapters: HashMap<String, ProviderAdapter>,
}

impl ProviderRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Every lookup key of each provider whose base id is disabled. A catalog
    /// entry carries the alias prefix while the settings row carries the base
    /// id, so the whole key set is reported, not just the base id.
    pub fn disabled_keys(&self, disabled: &HashSet<String>) -> HashSet<String> {
        let mut adapters: Vec<&ProviderAdapter> = self.adapters.values().collect();
        adapters.sort_by_key(|adapter| adapter.id());
        adapters.dedup_by_key(|adapter| adapter.id());

        let mut keys = HashSet::new();
        for adapter in adapters {
            if adapter
                .keys()
                .iter()
                .any(|key| disabled.contains(key.to_lowercase().as_str()))
            {
                keys.extend(adapter.keys().iter().map(|key| key.to_lowercase()));
            }
        }

        keys
    }

    /// Builds the registry with the built-in providers registered and no
    /// database handle, which is the shape a test or a database-less boot uses.
    /// A Qoder adapter without a database can never read credentials, so it
    /// advertises no model at all.
    pub fn with_defaults() -> Result<Self, APIError> {
        Self::with_database(None)
    }

    /// Builds the registry with the built-in providers registered. The Qoder
    /// adapter keeps the database so it can read its own credentials per request.
    pub fn with_database(database: Option<AppDatabase>) -> Result<Self, APIError> {
        let mut registry = Self::new();
        registry.register(opencode::adapter()?);
        registry.register(qoder::adapter(database)?);

        Ok(registry)
    }

    /// The Qoder endpoints in use, so the device-flow routes can talk to the
    /// same base the executor does.
    pub fn qoder_endpoints(&self) -> Option<QoderEndpoints> {
        self.adapters.values().find_map(|adapter| match adapter {
            ProviderAdapter::Qoder(executor) => Some(executor.endpoints().clone()),
            _ => None,
        })
    }

    /// Asks every adapter with a time-varying catalog to refresh when stale, or
    /// unconditionally when the caller asked for a forced refresh.
    pub async fn maybe_refresh_catalogs(&self, force: bool) {
        let mut seen = HashSet::new();

        for adapter in self.adapters.values() {
            if seen.insert(adapter.id()) {
                adapter.maybe_refresh(force).await;
            }
        }
    }

    /// Registers an adapter under each of its lookup keys.
    pub fn register(&mut self, adapter: ProviderAdapter) {
        for key in adapter.keys() {
            self.adapters.insert((*key).to_owned(), adapter.clone());
        }
    }

    /// Resolves `<provider>/<model>` or `<alias>/<model>`. A bare model id is
    /// resolved against the providers that advertise it.
    pub fn resolve(&self, model: &str) -> Option<ResolvedModel> {
        let model = model.trim();
        if model.is_empty() {
            return None;
        }

        if let Some((prefix, bare_model)) = model.split_once('/') {
            let adapter = self.adapters.get(prefix)?;

            return Some(ResolvedModel {
                adapter: adapter.clone(),
                model: bare_model.to_owned(),
            });
        }

        self.adapters
            .values()
            .find(|adapter| adapter.models().iter().any(|id| id.as_str() == model))
            .map(|adapter| ResolvedModel {
                adapter: adapter.clone(),
                model: model.to_owned(),
            })
    }

    /// Lists every advertised model as `<alias>/<bare>` entries, mirroring
    /// Node's `buildModelList`. A provider whose catalog is read from upstream
    /// contributes only what that catalog holds right now, so the list can grow
    /// between requests.
    pub fn list_models(&self) -> Vec<ModelObject> {
        let mut models = Vec::new();
        let mut seen = HashSet::new();

        // Deterministic order: sort adapters by base id so output is stable
        // across runs regardless of HashMap iteration order.
        let mut adapters: Vec<&ProviderAdapter> = self.adapters.values().collect();
        adapters.sort_by_key(|adapter| adapter.id());
        let mut emitted_adapters = HashSet::new();

        for adapter in adapters {
            if !emitted_adapters.insert(adapter.id()) {
                continue;
            }
            let alias = adapter.alias();
            for model_id in adapter.models() {
                let id = format!("{alias}/{model_id}");
                if seen.insert(id.clone()) {
                    models.push(ModelObject::new(id, alias.to_owned()));
                }
            }
        }

        models
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use super::ProviderRegistry;
    use crate::features::providers::opencode;

    fn registry_with_opencode() -> ProviderRegistry {
        let mut registry = ProviderRegistry::new();
        registry.register(opencode::adapter_with_base_url("http://127.0.0.1:1/v1").unwrap());

        registry
    }

    #[test]
    fn resolves_the_base_id_and_aliases() {
        let registry = registry_with_opencode();

        for prefix in ["opencode_zen", "opencode", "zen"] {
            let resolved = registry
                .resolve(&format!("{prefix}/space-bunny-free"))
                .expect("prefix must resolve");

            assert_eq!(resolved.model, "space-bunny-free");
            assert_eq!(resolved.adapter.id(), "opencode_zen");
        }
    }

    #[test]
    fn resolves_a_bare_advertised_model_id() {
        let registry = registry_with_opencode();
        let resolved = registry.resolve("space-bunny-free").expect("bare model");

        assert_eq!(resolved.model, "space-bunny-free");
    }

    #[test]
    fn rejects_unknown_prefixes_and_models() {
        let registry = registry_with_opencode();

        assert!(registry.resolve("anthropic/claude-sonnet-4").is_none());
        assert!(registry.resolve("does-not-exist").is_none());
        assert!(registry.resolve("").is_none());
    }

    #[test]
    fn disabled_keys_reports_every_alias_of_the_disabled_provider() {
        let registry = registry_with_opencode();
        let disabled = HashSet::from([String::from("opencode_zen")]);

        let keys = registry.disabled_keys(&disabled);

        assert!(keys.contains("opencode_zen"));
        assert!(keys.contains("zen"));
        assert!(keys.contains("opencode"));
        assert!(registry.disabled_keys(&HashSet::new()).is_empty());
        assert!(
            registry
                .disabled_keys(&HashSet::from([String::from("anthropic")]))
                .is_empty()
        );
    }

    #[test]
    fn list_models_uses_the_user_facing_alias_prefix() {
        let registry = registry_with_opencode();
        let models = registry.list_models();

        assert_eq!(models.len(), opencode::OPENCODE_ZEN_MODELS.len());
        assert!(
            models
                .iter()
                .all(|entry| entry.object == "model" && entry.owned_by == "zen")
        );
        assert!(
            models
                .iter()
                .any(|entry| entry.id == "zen/space-bunny-free")
        );
    }

    #[test]
    fn resolves_both_qoder_prefixes_without_a_catalog_entry() {
        let registry = ProviderRegistry::with_defaults().expect("default registry");

        for prefix in ["qoder", "qd"] {
            let resolved = registry
                .resolve(&format!("{prefix}/auto"))
                .expect("prefix must resolve");

            assert_eq!(resolved.model, "auto");
            assert_eq!(resolved.adapter.id(), "qoder");
        }
    }

    #[test]
    fn disabled_keys_reports_both_qoder_keys() {
        let registry = ProviderRegistry::with_defaults().expect("default registry");

        let keys = registry.disabled_keys(&HashSet::from([String::from("qoder")]));

        assert!(keys.contains("qoder"));
        assert!(keys.contains("qd"));
    }

    #[test]
    fn the_default_registry_advertises_no_qoder_model() {
        let registry = ProviderRegistry::with_defaults().expect("default registry");
        let models = registry.list_models();

        assert_eq!(models.len(), opencode::OPENCODE_ZEN_MODELS.len());
        assert!(
            !models.iter().any(|entry| entry.owned_by == "qd"),
            "the qoder catalog is filled only by a live fetch"
        );
    }
}
