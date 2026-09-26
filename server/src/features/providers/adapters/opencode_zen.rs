//! OpenCode Zen provider: metadata plus the adapter factory the registry uses.

use crate::error::APIError;
use crate::features::providers::adapters::{OpenAIAdapter, ProviderAdapter};
use crate::features::providers::model::{ModelDefinition, ProviderMetadata};
use crate::infrastructure::upstream::UpstreamClient;

pub const OPENCODE_ZEN_BASE_URL: &str = "https://opencode.ai/zen/v1";

/// Registry lookup keys: the base id plus the legacy `opencode` alias and the
/// user-facing `zen` alias.
pub const OPENCODE_ZEN_KEYS: &[&str] = &["opencode_zen", "opencode", "zen"];

pub const OPENCODE_ZEN_MODELS: &[ModelDefinition] = &[ModelDefinition {
    id: "space-bunny-free",
    name: "Space Bunny (Free)",
}];

/// The `opencode` legacy alias resolves to this provider's registered base id.
pub const OPENCODE_ZEN_PROVIDER: ProviderMetadata = ProviderMetadata {
    id: "opencode_zen",
    name: "OpenCode Zen",
    category: "free_tier",
    protocol: "openai",
    base_url: OPENCODE_ZEN_BASE_URL,
    web_url: "https://opencode.ai/zen",
    alias: "zen",
    requires_api_key: false,
    requires_oauth: false,
    supports_custom_url: true,
    status_message: "Free Tier Ready (Unlimited)",
};

/// Builds the adapter against the production base URL.
pub fn adapter() -> Result<ProviderAdapter, APIError> {
    adapter_with_base_url(OPENCODE_ZEN_BASE_URL)
}

/// Builds the adapter against an explicit base URL. Tests point this at a local
/// fake upstream instead of the real service.
pub fn adapter_with_base_url(base_url: impl Into<String>) -> Result<ProviderAdapter, APIError> {
    let client = UpstreamClient::new()?;

    Ok(ProviderAdapter::OpenAI(OpenAIAdapter::new(
        OPENCODE_ZEN_PROVIDER.id,
        OPENCODE_ZEN_KEYS,
        base_url,
        OPENCODE_ZEN_MODELS,
        client,
    )))
}

#[cfg(test)]
mod tests {
    use super::{
        OPENCODE_ZEN_BASE_URL, OPENCODE_ZEN_KEYS, OPENCODE_ZEN_MODELS, OPENCODE_ZEN_PROVIDER,
    };
    use crate::features::providers::model::ModelDefinition;

    #[test]
    fn opencode_zen_metadata_matches_the_node_api_provider() {
        assert_eq!(OPENCODE_ZEN_PROVIDER.id, "opencode_zen");
        assert_eq!(OPENCODE_ZEN_PROVIDER.name, "OpenCode Zen");
        assert_eq!(OPENCODE_ZEN_PROVIDER.category, "free_tier");
        assert_eq!(OPENCODE_ZEN_PROVIDER.protocol, "openai");
        assert_eq!(OPENCODE_ZEN_PROVIDER.alias, "zen");
        assert_eq!(OPENCODE_ZEN_PROVIDER.base_url, OPENCODE_ZEN_BASE_URL);
        assert_eq!(OPENCODE_ZEN_PROVIDER.web_url, "https://opencode.ai/zen");
        assert!(!OPENCODE_ZEN_PROVIDER.requires_api_key);
        assert!(!OPENCODE_ZEN_PROVIDER.requires_oauth);
        assert!(OPENCODE_ZEN_PROVIDER.supports_custom_url);
        assert_eq!(
            OPENCODE_ZEN_PROVIDER.status_message,
            "Free Tier Ready (Unlimited)"
        );
    }

    #[test]
    fn opencode_zen_exposes_the_space_bunny_free_model() {
        assert_eq!(
            OPENCODE_ZEN_MODELS,
            [ModelDefinition {
                id: "space-bunny-free",
                name: "Space Bunny (Free)"
            }]
        );
    }

    #[test]
    fn opencode_zen_registry_keys_cover_the_base_id_and_aliases() {
        assert_eq!(
            OPENCODE_ZEN_KEYS,
            ["opencode_zen", "opencode", "zen"].as_slice()
        );
    }
}
