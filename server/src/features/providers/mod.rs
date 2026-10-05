//! Provider management, registry lifecycle, and provider implementations.

pub mod adapter;
pub mod cline;
pub mod codebuddy;
pub mod codex;
pub mod executor;
pub mod grok_web;
pub mod management;
pub mod model;
pub mod opencode;
pub mod qoder;
pub mod quota;
pub mod registry;
mod wire;

pub use adapter::{OpenAIAdapter, ProviderAdapter, ProviderStream, forward_image_generation};
pub use cline::{CLINE_KEYS, CLINE_PROVIDER};
pub use codebuddy::{
    CODEBUDDY_CN_KEYS, CODEBUDDY_CN_PROVIDER, CODEBUDDY_KEYS, CODEBUDDY_PROVIDER, Flavor,
};
pub use codex::{CODEX_KEYS, CODEX_PROVIDER};
pub use executor::ProviderExecutor;
pub use grok_web::{GROK_WEB_KEYS, GROK_WEB_PROVIDER};
pub use model::{ModelDefinition, ModelObject, ProviderMetadata};
pub use opencode::{
    OPENCODE_ZEN_BASE_URL, OPENCODE_ZEN_KEYS, OPENCODE_ZEN_MODELS, OPENCODE_ZEN_PROVIDER,
};
pub use qoder::{QODER_KEYS, QODER_PROVIDER};
pub use quota::{LiveModelQuotaItem, ProviderQuotaAccount};

/// Every driver the build knows about, in catalog order. The read routes serve
/// this list so the Providers page can reach a driver that has no connection yet.
pub const SEED_PROVIDERS: &[ProviderMetadata] = &[
    OPENCODE_ZEN_PROVIDER,
    QODER_PROVIDER,
    CLINE_PROVIDER,
    GROK_WEB_PROVIDER,
    CODEX_PROVIDER,
    CODEBUDDY_PROVIDER,
    CODEBUDDY_CN_PROVIDER,
];
pub use registry::{ProviderRegistry, ResolvedModel};
