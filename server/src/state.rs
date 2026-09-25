use std::sync::Arc;

use crate::config::ApiConfig;

#[derive(Clone, Debug)]
pub struct AppState {
    pub config: Arc<ApiConfig>,
}

impl AppState {
    pub fn new(config: ApiConfig) -> Self {
        Self {
            config: Arc::new(config),
        }
    }
}
