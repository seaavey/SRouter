//! Provider registry: resolves a requested model onto the adapter that serves
//! it. Registration covers the provider base id and its aliases.

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex, RwLock, RwLockReadGuard};

use crate::error::APIError;
use crate::features::providers::adapter::ProviderAdapter;
use crate::features::providers::antigravity;
use crate::features::providers::antigravity::AntigravityExecutor;
use crate::features::providers::antigravity::types::AntigravityEndpoints;
use crate::features::providers::claude;
use crate::features::providers::claude::ClaudeExecutor;
use crate::features::providers::claude::types::ClaudeEndpoints;
use crate::features::providers::cline;
use crate::features::providers::cline::ClineExecutor;
use crate::features::providers::cline::types::ClineEndpoints;
use crate::features::providers::codebuddy;
use crate::features::providers::codebuddy::Flavor;
use crate::features::providers::codex;
use crate::features::providers::codex::CodexExecutor;
use crate::features::providers::codex::types::CodexEndpoints;
use crate::features::providers::grok_web;
use crate::features::providers::grok_web::GrokWebExecutor;
use crate::features::providers::grok_web::types::GrokWebEndpoints;
use crate::features::providers::model::ModelObject;
use crate::features::providers::opencode;
use crate::features::providers::qoder;
use crate::features::providers::qoder::QoderExecutor;
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
///
/// The map sits behind a `RwLock` because a custom provider is registered at
/// runtime from its `providers` row: a request can add or drop one while other
/// requests read the catalog, so registration cannot need `&mut self`.
#[derive(Clone, Default)]
pub struct ProviderRegistry {
    adapters: Arc<RwLock<HashMap<String, ProviderAdapter>>>,
    selection_indices: Arc<Mutex<HashMap<String, usize>>>,
}

impl ProviderRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Borrows the adapter map for a read. A poisoning writer does not spread:
    /// the map is read without panicking.
    fn read_adapters(&self) -> RwLockReadGuard<'_, HashMap<String, ProviderAdapter>> {
        self.adapters
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Every registered adapter, deduplicated by base id and sorted by it, so
    /// callers iterate a stable order without holding the lock across an await.
    fn adapters_sorted(&self) -> Vec<ProviderAdapter> {
        let mut adapters: Vec<ProviderAdapter> = self.read_adapters().values().cloned().collect();
        adapters.sort_by_key(|adapter| adapter.id().to_owned());
        adapters.dedup_by_key(|adapter| adapter.id().to_owned());

        adapters
    }

    /// Every lookup key of each provider whose base id is disabled. A catalog
    /// entry carries the alias prefix while the settings row carries the base
    /// id, so the whole key set is reported, not just the base id.
    pub fn disabled_keys(&self, disabled: &HashSet<String>) -> HashSet<String> {
        let mut keys = HashSet::new();

        for adapter in self.adapters_sorted() {
            let adapter_keys = adapter.keys_owned();
            if adapter_keys
                .iter()
                .any(|key| disabled.contains(key.to_lowercase().as_str()))
            {
                keys.extend(adapter_keys.into_iter().map(|key| key.to_lowercase()));
            }
        }

        keys
    }

    /// Builds the registry with the built-in providers registered and no
    /// database handle, which is the shape a test or a database-less boot uses.
    /// A Qoder or Cline adapter without a database can never read credentials,
    /// so it advertises no model at all.
    pub fn with_defaults() -> Result<Self, APIError> {
        Self::with_database(None)
    }

    /// Builds the registry with the built-in providers registered. The Qoder,
    /// Cline, and Codex adapters keep the database to read their own credentials.
    pub fn with_database(database: Option<AppDatabase>) -> Result<Self, APIError> {
        let mut registry = Self::new();
        registry.register(opencode::adapter()?);
        registry.register(qoder::adapter(database.clone())?);
        registry.register(cline::adapter(database.clone())?);
        registry.register(grok_web::adapter(database.clone())?);
        registry.register(codebuddy::adapter(Flavor::Global, database.clone())?);
        registry.register(codebuddy::adapter(Flavor::China, database.clone())?);
        registry.register(antigravity::adapter(database.clone())?);
        registry.register(claude::adapter(database.clone())?);
        registry.register(codex::adapter(database)?);

        Ok(registry)
    }

    /// The Qoder endpoints in use, so the device-flow routes can talk to the
    /// same base the executor does.
    pub fn qoder_endpoints(&self) -> Option<QoderEndpoints> {
        self.read_adapters()
            .values()
            .find_map(|adapter| adapter.downcast_ref::<QoderExecutor>())
            .map(|executor| executor.endpoints().clone())
    }

    /// The Cline endpoints in use, so the device-flow routes can talk to the
    /// same base the executor does.
    pub fn cline_endpoints(&self) -> Option<ClineEndpoints> {
        self.read_adapters()
            .values()
            .find_map(|adapter| adapter.downcast_ref::<ClineExecutor>())
            .map(|executor| executor.endpoints().clone())
    }

    /// The Grok Web endpoints in use, so the cookie-connect route can probe
    /// the same page the executor will read `x-userid` from.
    pub fn grok_web_endpoints(&self) -> Option<GrokWebEndpoints> {
        self.read_adapters()
            .values()
            .find_map(|adapter| adapter.downcast_ref::<GrokWebExecutor>())
            .map(|executor| executor.endpoints().clone())
    }

    /// The Codex endpoints in use, so the OAuth routes exchange their code
    /// against the same token endpoint the executor refreshes against.
    pub fn codex_endpoints(&self) -> Option<CodexEndpoints> {
        self.read_adapters()
            .values()
            .find_map(|adapter| adapter.downcast_ref::<CodexExecutor>())
            .map(|executor| executor.endpoints().clone())
    }

    /// The Antigravity endpoints in use, so the OAuth routes and tests talk to
    /// the same hosts the executor does.
    pub fn antigravity_endpoints(&self) -> Option<AntigravityEndpoints> {
        self.read_adapters()
            .values()
            .find_map(|adapter| adapter.downcast_ref::<AntigravityExecutor>())
            .map(|executor| executor.endpoints().clone())
    }

    /// The Claude endpoints in use, so the OAuth routes and tests talk to the
    /// same hosts the executor does.
    pub fn claude_endpoints(&self) -> Option<ClaudeEndpoints> {
        self.read_adapters()
            .values()
            .find_map(|adapter| adapter.downcast_ref::<ClaudeExecutor>())
            .map(|executor| executor.endpoints().clone())
    }

    /// Asks every adapter with a time-varying catalog to refresh when stale, or
    /// unconditionally when the caller asked for a forced refresh.
    pub async fn maybe_refresh_catalogs(&self, force: bool) {
        let mut seen = HashSet::new();

        for adapter in self.adapters_sorted() {
            if seen.insert(adapter.id().to_owned()) {
                adapter.maybe_refresh(force).await;
            }
        }
    }

    /// Checks and refreshes expired or near-expiry credentials across every
    /// registered adapter.
    pub async fn sweep_tokens(&self) {
        let mut seen = HashSet::new();

        for adapter in self.adapters_sorted() {
            if seen.insert(adapter.id().to_owned()) {
                adapter.sweep_tokens().await;
            }
        }
    }

    /// Registers an adapter under each of its lookup keys. Used at construction,
    /// before the registry is shared.
    pub fn register(&mut self, adapter: ProviderAdapter) {
        self.register_adapter(adapter);
    }

    /// Registers an adapter while the registry is shared, so a custom provider
    /// created over HTTP joins the live registry the catalog and the gateway
    /// read. Unlike [`ProviderRegistry::register`] this needs no `&mut self`.
    pub fn register_runtime(&self, adapter: ProviderAdapter) {
        self.register_adapter(adapter);
    }

    fn register_adapter(&self, adapter: ProviderAdapter) {
        let mut adapters = self
            .adapters
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        for key in adapter.keys_owned() {
            adapters.insert(key.to_lowercase(), adapter.clone());
        }
    }

    /// Drops every lookup key of one provider, so a deleted custom provider
    /// stops resolving immediately.
    pub fn unregister(&self, base_id: &str) {
        let mut adapters = self
            .adapters
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        adapters.retain(|_, adapter| !adapter.id().eq_ignore_ascii_case(base_id));
    }

    /// The user-facing alias of a provider base id, so a stored custom model can
    /// be listed under the same prefix the catalog advertises.
    pub fn alias_of(&self, base_id: &str) -> Option<String> {
        self.read_adapters()
            .values()
            .find(|adapter| adapter.id().eq_ignore_ascii_case(base_id))
            .map(|adapter| adapter.alias().to_owned())
    }

    /// The base id a model-id prefix (a provider id or alias) names.
    pub fn base_id_of_prefix(&self, prefix: &str) -> Option<String> {
        self.read_adapters()
            .get(&prefix.to_lowercase())
            .map(|adapter| adapter.id().to_owned())
    }

    /// Resolves `<provider>/<model>` or `<alias>/<model>`. A bare model id is
    /// resolved against the providers that advertise it.
    pub fn resolve(&self, model: &str) -> Option<ResolvedModel> {
        let model = model.trim();
        if model.is_empty() {
            return None;
        }

        if let Some((prefix, bare_model)) = model.split_once('/') {
            let adapter = self.read_adapters().get(prefix)?.clone();

            return Some(ResolvedModel {
                adapter,
                model: bare_model.to_owned(),
            });
        }

        let mut matches: Vec<ProviderAdapter> = self
            .adapters_sorted()
            .into_iter()
            .filter(|adapter| {
                adapter.models().iter().any(|id| {
                    id.as_str() == model || (model.contains('.') && model.replace('.', "-") == *id)
                })
            })
            .collect();
        matches.sort_by_key(|adapter| adapter.id().to_owned());
        matches.dedup_by_key(|adapter| adapter.id().to_owned());

        if matches.is_empty() {
            return None;
        }

        let index = if matches.len() == 1 {
            0
        } else {
            let mut selection_indices = self.selection_indices.lock().unwrap();
            let next = selection_indices.entry(model.to_owned()).or_default();
            let index = *next;
            *next = next.wrapping_add(1);
            index
        };

        matches
            .get(index % matches.len())
            .map(|adapter| ResolvedModel {
                adapter: adapter.clone(),
                model: model.to_owned(),
            })
    }

    /// Every id that names the same model as `requested`, each prefixed the way
    /// the catalog advertises it, lowercased, and with the requested id first.
    /// Qoder serves one model under its raw key and the name upstream gave it;
    /// every other provider has one name per model.
    pub fn model_id_variants(&self, requested: &str) -> Vec<String> {
        let requested = requested.trim();

        let Some(resolved) = self.resolve(requested) else {
            return vec![requested.to_lowercase()];
        };

        let alias = resolved.adapter.alias();

        resolved
            .adapter
            .model_id_variants(&resolved.model)
            .into_iter()
            .map(|bare| format!("{alias}/{bare}").to_lowercase())
            .collect()
    }

    /// Every advertised name of the models these ids point at. A hide or favorite
    /// entry is written under one name but governs the model, which the catalog
    /// may advertise under two.
    pub fn names_of(&self, ids: &HashSet<String>) -> HashSet<String> {
        ids.iter()
            .flat_map(|id| self.model_id_variants(id))
            .collect()
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
        let mut emitted_adapters = HashSet::new();

        for adapter in self.adapters_sorted() {
            if !emitted_adapters.insert(adapter.id().to_owned()) {
                continue;
            }
            let alias = adapter.alias().to_owned();
            for model_id in adapter.models() {
                let id = format!("{alias}/{model_id}");
                if seen.insert(id.clone()) {
                    models.push(ModelObject::new(id, alias.clone()));
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
    use crate::error::APIError;
    use crate::features::providers::adapter::{ProviderAdapter, ProviderStream};
    use crate::features::providers::cline;
    use crate::features::providers::cline::ClineExecutor;
    use crate::features::providers::cline::catalog::write_catalog;
    use crate::features::providers::executor::{BoxFuture, ProviderExecutor};
    use crate::features::providers::opencode;
    use crate::protocol::model::ChatCompletionRequest;
    use serde_json::Value;

    struct TestExecutor {
        id: &'static str,
        models: &'static [&'static str],
    }

    impl ProviderExecutor for TestExecutor {
        fn as_any(&self) -> &dyn std::any::Any {
            self
        }

        fn id(&self) -> &str {
            self.id
        }

        fn keys(&self) -> &'static [&'static str] {
            match self.id {
                "alpha" => &["alpha"],
                "beta" => &["beta"],
                _ => &[],
            }
        }

        fn alias(&self) -> &'static str {
            self.id
        }

        fn models(&self) -> Vec<String> {
            self.models
                .iter()
                .map(|model| (*model).to_owned())
                .collect()
        }

        fn chat_completion<'a>(
            &'a self,
            _model: &'a str,
            _request: &'a ChatCompletionRequest,
        ) -> BoxFuture<'a, Result<Value, APIError>> {
            Box::pin(async { Err(APIError::new(500, "unused test executor")) })
        }

        fn chat_completion_stream<'a>(
            &'a self,
            _model: &'a str,
            _request: &'a ChatCompletionRequest,
        ) -> BoxFuture<'a, Result<ProviderStream, APIError>> {
            Box::pin(async { Err(APIError::new(500, "unused test executor")) })
        }
    }

    fn registry_with_duplicate_model() -> ProviderRegistry {
        let mut registry = ProviderRegistry::new();
        registry.register(ProviderAdapter::new(TestExecutor {
            id: "alpha",
            models: &["shared-model"],
        }));
        registry.register(ProviderAdapter::new(TestExecutor {
            id: "beta",
            models: &["shared-model"],
        }));
        registry
    }

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
    fn bare_model_selection_rotates_across_matching_drivers() {
        let registry = registry_with_duplicate_model();

        let selected = (0..4)
            .map(|_| {
                registry
                    .resolve("shared-model")
                    .unwrap()
                    .adapter
                    .id()
                    .to_owned()
            })
            .collect::<Vec<_>>();

        assert_eq!(selected, ["alpha", "beta", "alpha", "beta"]);
    }

    #[test]
    fn prefixed_model_selection_stays_pinned_to_its_driver() {
        let registry = registry_with_duplicate_model();

        for _ in 0..3 {
            assert_eq!(
                registry.resolve("beta/shared-model").unwrap().adapter.id(),
                "beta"
            );
        }
        assert_eq!(
            registry.resolve("shared-model").unwrap().adapter.id(),
            "alpha"
        );
    }

    #[test]
    fn model_selection_state_is_shared_by_registry_clones() {
        let registry = registry_with_duplicate_model();
        let clone = registry.clone();

        assert_eq!(
            registry.resolve("shared-model").unwrap().adapter.id(),
            "alpha"
        );
        assert_eq!(clone.resolve("shared-model").unwrap().adapter.id(), "beta");
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

    #[test]
    fn the_default_registry_advertises_no_antigravity_model() {
        let registry = ProviderRegistry::with_defaults().expect("default registry");
        let models = registry.list_models();

        assert_eq!(models.len(), opencode::OPENCODE_ZEN_MODELS.len());
        assert!(
            !models.iter().any(|entry| entry.owned_by == "antigravity"),
            "the antigravity catalog is gated on an existing connection"
        );
    }

    #[test]
    fn an_adapter_with_one_name_per_model_answers_with_the_id_it_was_given() {
        let registry = registry_with_opencode();

        assert_eq!(
            registry.model_id_variants("zen/big-pickle"),
            vec![String::from("zen/big-pickle")]
        );
        assert_eq!(
            registry.model_id_variants(" Zen/Big-Pickle "),
            vec![String::from("zen/big-pickle")],
            "the name is lowered the way the catalog matches it"
        );
        assert_eq!(
            registry.model_id_variants("anthropic/claude-sonnet-4"),
            vec![String::from("anthropic/claude-sonnet-4")],
            "an unregistered prefix is no reason to invent a sibling"
        );

        let stored = ["zen/big-pickle", "zen/space-bunny-free"]
            .iter()
            .map(|id| (*id).to_owned())
            .collect::<HashSet<String>>();
        assert_eq!(registry.names_of(&stored), stored);
        assert!(registry.names_of(&HashSet::new()).is_empty());
    }

    #[test]
    fn an_unfilled_qoder_catalog_offers_no_sibling_for_its_keys() {
        let registry = ProviderRegistry::with_defaults().expect("default registry");

        assert_eq!(
            registry.model_id_variants("qd/qfmodel"),
            vec![String::from("qd/qfmodel")],
            "a name upstream has not confirmed cannot be paired with one"
        );
    }

    #[test]
    fn resolves_a_cline_model_id_with_its_inner_slash() {
        let registry = ProviderRegistry::with_defaults().expect("default registry");

        let resolved = registry
            .resolve("cline/anthropic/claude-sonnet-5.5")
            .expect("cline prefix must resolve");

        assert_eq!(resolved.model, "anthropic/claude-sonnet-5.5");
        assert_eq!(resolved.adapter.id(), "cline");
    }

    #[test]
    fn an_unprefixed_model_id_does_not_reach_the_cline_prefix_path() {
        let registry = ProviderRegistry::with_defaults().expect("default registry");

        assert!(
            registry.resolve("anthropic/claude-sonnet-5.5").is_none(),
            "the cline route only exists behind the cline prefix"
        );
    }

    #[test]
    fn list_models_emits_cline_ids_under_the_cline_prefix() {
        let adapter = cline::adapter(None).expect("cline adapter builds");
        let executor = adapter
            .downcast_ref::<ClineExecutor>()
            .expect("expected the cline executor");
        write_catalog(&executor.catalog)
            .models
            .push(String::from("anthropic/claude-sonnet-5.5"));

        let mut registry = ProviderRegistry::new();
        registry.register(adapter);
        let models = registry.list_models();

        assert_eq!(models.len(), 1);
        assert_eq!(models[0].id, "cline/anthropic/claude-sonnet-5.5");
        assert_eq!(models[0].owned_by, "cline");
    }
}
