//! OpenCode Zen provider types, constants, and metadata.
//!
//! Provenance, independent of `packages/*`:
//! - `https://opencode.ai/docs/zen/` identifies OpenCode Zen, documents its API
//!   endpoints, and lists the model names and ids offered through Zen.
//! - `https://opencode.ai/inference/v1/models` is the provider's live public model
//!   catalog. `OPENCODE_ZEN_MODELS` is the curated seed: it keeps the gateway
//!   useful before the first fetch lands and offline, while
//!   [`super::catalog`] merges whatever the live endpoint currently returns on
//!   top of it. Both lists hold only what the OpenAI-protocol executor can
//!   serve — a free-tier chat model.
//!   Deliberately excluded from the seed: `jev-1.13-free` (served on
//!   `/v1/systemone`, not chat completions), the `muse-spark-*-contributor-free`
//!   pair (served on `/v1/responses`), and the paid tiers — none of them are
//!   routable through the OpenAI-protocol executor. `mimo-v2.5-free` was
//!   dropped: the docs table still lists it, but the live endpoint no longer
//!   returns it. `nemotron-3-ultra-free` and `step-5-preview-free` were replaced
//!   on 2026-10-17 by `nemotron-3.5-super-vl-free` and `glm-5.3-flash-free`,
//!   which the same endpoint now returns. Three more ids left the seed after the
//!   2026-10-15 live smoke test: `exo-free` now answers `410 ModelDeprecated`,
//!   and `ling-3.0-flash-fin-free` and `ling-3.1-flash-free` answer
//!   `400 Model is unavailable`. `space-bunny-free` answered
//!   `400 Model is unavailable` on 2026-10-23 and left the seed; `flint-40b-free`
//!   took its place in the same refresh.
//! - Free-tier chat moved off `/zen/v1/chat/completions` on 2026-10-14: that
//!   path now answers `403 FreeTierError` to every caller, including the
//!   official CLI, while the same bodies replayed against
//!   `/inference/v1/chat/completions` answer `200`. Both paths still serve the
//!   identical model catalog.
//! - `https://opencode.ai/zen` is the provider's product page and web URL.
//! - `docs/api-v1-contract.md` and the `apps/api` route/controller/tests are
//!   the allowed sources for SRouter-facing metadata and compatibility behavior;
//!   provider-specific catalog facts above come from OpenCode's own sources.

use crate::features::providers::model::{ModelDefinition, ProviderMetadata, ProviderProtocol};

pub const OPENCODE_ZEN_BASE_URL: &str = "https://opencode.ai/inference/v1";

/// Registry lookup keys: the base id plus the legacy `opencode` alias and the
/// user-facing `zen` alias.
pub const OPENCODE_ZEN_KEYS: &[&str] = &["opencode_zen", "opencode", "zen"];

pub const OPENCODE_ZEN_MODELS: &[ModelDefinition] = &[
    ModelDefinition {
        id: "flint-40b-free",
        name: "Flint 40B Free",
    },
    ModelDefinition {
        id: "beam-free",
        name: "Beam Free",
    },
    ModelDefinition {
        id: "nemotron-3.5-lightning-free",
        name: "Nemotron 3.5 Lightning Free",
    },
    ModelDefinition {
        id: "nemotron-3.5-super-vl-free",
        name: "Nemotron 3.5 Super VL Free",
    },
    ModelDefinition {
        id: "mimo-v2.6-flash-free",
        name: "MiMo-V2.6-Flash Free",
    },
    ModelDefinition {
        id: "big-pickle",
        name: "Big Pickle",
    },
    ModelDefinition {
        id: "longcat-2.5-preview-free",
        name: "LongCat 2.5 Preview Free",
    },
    ModelDefinition {
        id: "glm-5.3-flash-free",
        name: "GLM-5.3-Flash Free",
    },
    ModelDefinition {
        id: "deepseek-v4.1-flash-free",
        name: "DeepSeek V4.1 Flash Free",
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
