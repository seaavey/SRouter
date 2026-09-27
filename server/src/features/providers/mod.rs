//! Provider management, registry lifecycle, and provider implementations.

pub mod adapter;
pub mod model;
pub mod opencode;
pub mod registry;

/// Backward-compatibility alias for `adapters::opencode_zen`.
pub mod adapters {
    pub use super::adapter::*;
    pub use super::opencode as opencode_zen;
}

pub use adapter::{
    OpenAIAdapter, OpenAIExecutor, ProviderAdapter, ProviderExecutor, ProviderStream,
};
pub use model::{ModelDefinition, ProviderMetadata};
pub use opencode::{
    OPENCODE_ZEN_BASE_URL, OPENCODE_ZEN_KEYS, OPENCODE_ZEN_MODELS, OPENCODE_ZEN_PROVIDER,
};
pub use registry::{ProviderRegistry, ResolvedModel};
