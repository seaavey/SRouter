//! Provider management, registry lifecycle, and provider-specific adapters.

pub mod adapters;
pub mod model;
pub mod registry;

pub use adapters::opencode_zen::{
    OPENCODE_ZEN_BASE_URL, OPENCODE_ZEN_MODELS, OPENCODE_ZEN_PROVIDER,
};
pub use model::{ModelDefinition, ProviderMetadata};
pub use registry::{ProviderRegistry, ResolvedModel};
