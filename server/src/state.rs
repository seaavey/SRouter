use std::sync::Arc;

use crate::config::APIConfig;
use crate::error::APIError;
use crate::features::providers::ProviderRegistry;

/// Shared runtime dependencies, constructed once by the composition root.
#[derive(Clone)]
pub struct AppState {
    pub config: Arc<APIConfig>,
    pub providers: Arc<ProviderRegistry>,
}

impl AppState {
    /// Builds the state with the built-in provider registry.
    pub fn new(config: APIConfig) -> Result<Self, APIError> {
        Ok(Self::with_registry(
            config,
            ProviderRegistry::with_defaults()?,
        ))
    }

    /// Builds the state around an explicit registry. Tests inject a fake
    /// upstream here instead of reaching the real providers.
    pub fn with_registry(config: APIConfig, providers: ProviderRegistry) -> Self {
        Self {
            config: Arc::new(config),
            providers: Arc::new(providers),
        }
    }
}
