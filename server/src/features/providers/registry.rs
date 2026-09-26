//! Provider registry: resolves a requested model onto the adapter that serves
//! it. Registration covers the provider base id and its aliases.

use std::collections::HashMap;

use crate::error::APIError;
use crate::features::providers::adapters::{ProviderAdapter, opencode_zen};

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

    /// Builds the registry with the built-in providers registered.
    pub fn with_defaults() -> Result<Self, APIError> {
        let mut registry = Self::new();
        registry.register(opencode_zen::adapter()?);

        Ok(registry)
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
            .find(|adapter| adapter.models().iter().any(|entry| entry.id == model))
            .map(|adapter| ResolvedModel {
                adapter: adapter.clone(),
                model: model.to_owned(),
            })
    }
}

#[cfg(test)]
mod tests {
    use super::ProviderRegistry;
    use crate::features::providers::adapters::opencode_zen;

    fn registry_with_opencode() -> ProviderRegistry {
        let mut registry = ProviderRegistry::new();
        registry.register(opencode_zen::adapter_with_base_url("http://127.0.0.1:1/v1").unwrap());

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
}
