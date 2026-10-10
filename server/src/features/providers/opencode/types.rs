//! OpenCode Zen provider types, constants, and metadata.
//!
//! Provenance, independent of `packages/*`:
//! - `https://opencode.ai/docs/zen/` identifies OpenCode Zen, documents its API
//!   endpoints, and lists the model names and ids offered through Zen.
//! - `https://opencode.ai/zen/v1/models` is the provider's live public model
//!   catalog. The seven ids in `OPENCODE_ZEN_MODELS` were checked against this
//!   endpoint on 2026-10-03; the seed is an intentional subset, not a snapshot
//!   of every model returned by the endpoint.
//! - `https://opencode.ai/zen` is the provider's product page and web URL.
//! - `docs/api-v1-contract.md` and the `apps/api` route/controller/tests are
//!   the allowed sources for SRouter-facing metadata and compatibility behavior;
//!   provider-specific catalog facts above come from OpenCode's own sources.

use crate::features::providers::model::{ModelDefinition, ProviderMetadata, ProviderProtocol};

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
    protocol: ProviderProtocol::OpenAI,
    base_url: OPENCODE_ZEN_BASE_URL,
    web_url: "https://opencode.ai/zen",
    alias: "zen",
    requires_api_key: false,
    requires_oauth: false,
    supports_custom_url: true,
    status_message: "Free Tier Ready (Unlimited)",
};
