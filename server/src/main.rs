use std::collections::HashMap;

use srouter_server::{ApiConfig, AppState, ConfigError};

fn main() -> Result<(), ConfigError> {
    let environment: HashMap<String, String> = std::env::vars().collect();
    let config = ApiConfig::from_env_map(&environment)?;
    let _state = AppState::new(config);

    Ok(())
}
