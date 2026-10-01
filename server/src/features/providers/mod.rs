//! Provider management, registry lifecycle, and provider implementations.

pub mod adapter;
pub mod cline;
pub mod management;
pub mod model;
pub mod opencode;
pub mod qoder;
pub mod registry;

/// Backward-compatibility alias for `adapters::opencode_zen`.
pub mod adapters {
    pub use super::adapter::*;
    pub use super::opencode as opencode_zen;
}

pub use adapter::{
    OpenAIAdapter, OpenAIExecutor, ProviderAdapter, ProviderExecutor, ProviderStream,
};
pub use cline::{CLINE_KEYS, CLINE_PROVIDER};
pub use model::{ModelDefinition, ModelObject, ProviderMetadata};
pub use opencode::{
    OPENCODE_ZEN_BASE_URL, OPENCODE_ZEN_KEYS, OPENCODE_ZEN_MODELS, OPENCODE_ZEN_PROVIDER,
};
pub use qoder::{QODER_KEYS, QODER_PROVIDER};

/// Every driver the build knows about, in catalog order. The read routes serve
/// this list so the Providers page can reach a driver that has no connection yet.
pub const SEED_PROVIDERS: &[ProviderMetadata] =
    &[OPENCODE_ZEN_PROVIDER, QODER_PROVIDER, CLINE_PROVIDER];
pub use registry::{ProviderRegistry, ResolvedModel};
