use std::collections::HashMap;
use std::net::SocketAddr;

use srouter_server::{APIConfig, AppState, app::create_router, http::listeners};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let environment: HashMap<String, String> = std::env::vars().collect();
    let config = APIConfig::from_env_map(&environment)?;
    // Wildcard bind matches the Node listener and keeps Docker/VPS traffic reachable.
    let address = SocketAddr::from(([0, 0, 0, 0], config.port));
    let state = AppState::new(config)?;

    if !state.security.is_persistence_configured() {
        eprintln!(
            "warning: security stores are not configured; key auth, rate limits, and model allowlists read no persisted data"
        );
    }

    listeners::serve_main(create_router(state), address).await?;

    Ok(())
}
