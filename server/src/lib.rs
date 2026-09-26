pub mod app;
pub mod config;
pub mod error;
pub mod features;
pub mod http;
pub mod infrastructure;
pub mod state;

pub use config::{APIConfig, ConfigError};
pub use error::{APIError, ErrorBody, ErrorEnvelope};
pub use features::providers::{
    ModelDefinition, OPENCODE_ZEN_BASE_URL, OPENCODE_ZEN_MODELS, OPENCODE_ZEN_PROVIDER,
    ProviderMetadata,
};
pub use features::providers::{ProviderRegistry, ResolvedModel};
pub use infrastructure::database::AppDatabase;
pub use state::{AppState, SecurityState};
