use std::sync::Arc;

use crate::config::APIConfig;

#[derive(Clone, Debug)]
pub struct AppState {
    pub config: Arc<APIConfig>,
}

impl AppState {
    pub fn new(config: APIConfig) -> Self {
        Self {
            config: Arc::new(config),
        }
    }
}
