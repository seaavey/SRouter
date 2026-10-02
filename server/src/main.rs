use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;

use srouter_server::features::providers::ProviderRegistry;
use srouter_server::infrastructure::database::AppDatabase;
use srouter_server::infrastructure::database::admin_auth::SQLxAdminAuthStore;
use srouter_server::infrastructure::database::api_keys::SQLxAPIKeyStore;
use srouter_server::infrastructure::telemetry;
use srouter_server::{APIConfig, AppState, SecurityState, app::create_router, http::listeners};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    telemetry::init();
    let environment: HashMap<String, String> = std::env::vars().collect();
    let config = APIConfig::from_env_map(&environment)?;
    // Wildcard bind matches the Node listener and keeps Docker/VPS traffic reachable.
    let address = SocketAddr::from(([0, 0, 0, 0], config.port));

    // Opening the database brings SQLite to schema v3 before the listeners start.
    let database = AppDatabase::connect(&config).await?;
    let api_key_store = Arc::new(SQLxAPIKeyStore::new(database.clone()));
    let admin_store = Arc::new(SQLxAdminAuthStore::new(database.clone()));
    let security =
        SecurityState::with_repository(api_key_store.clone(), admin_store.clone(), api_key_store)
            .with_admin_auth(admin_store);
    let registry = ProviderRegistry::with_database(Some(database.clone()))?;
    // Warm up the live catalog off the boot path: a first request that arrives
    // before this lands joins the same fetch instead of starting a second one.
    let warmup = registry.clone();
    tokio::spawn(async move {
        warmup.maybe_refresh_catalogs(false).await;
    });
    let state = AppState::with_security(config, registry, security).with_database(database);

    listeners::serve_main(create_router(state), address).await?;

    Ok(())
}
