//! OpenCode Zen provider types, constants, and metadata.

use crate::features::providers::model::{ModelDefinition, ProviderMetadata};

pub const OPENCODE_ZEN_BASE_URL: &str = "https://opencode.ai/zen/v1";

/// Registry lookup keys: the base id plus the legacy `opencode` alias and the
/// user-facing `zen` alias.
pub const OPENCODE_ZEN_KEYS: &[&str] = &["opencode_zen", "opencode", "zen"];

pub const OPENCODE_ZEN_MODELS: &[ModelDefinition] = &[
    ModelDefinition {
        id: "space-bunny-free",
        name: "Space Bunny (Free)",
    },
    ModelDefinition {
        id: "nemotron-3.5-lightning-free",
        name: "Nemotron 3.5 Lightning (Free)",
    },
    ModelDefinition {
        id: "nemotron-3-ultra-free",
        name: "Nemotron 3 Ultra (Free)",
    },
    ModelDefinition {
        id: "mimo-v2.5-free",
        name: "Xiaomi MiMo V2.5 (Free)",
    },
    ModelDefinition {
        id: "mimo-v2.6-flash-free",
        name: "Xiaomi MiMo V2.6 Flash (Free)",
    },
    ModelDefinition {
        id: "big-pickle",
        name: "Big Pickle (Free)",
    },
    ModelDefinition {
        id: "longcat-2.5-preview-free",
        name: "LongCat 2.5 Preview (Free)",
    },
];

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
