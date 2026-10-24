use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;

use srouter_server::features::admin_auth::bootstrap_admin_account_from_env;
use srouter_server::features::providers::ProviderRegistry;
use srouter_server::features::providers::custom::register_custom_providers;
use srouter_server::infrastructure::database::AppDatabase;
use srouter_server::infrastructure::database::admin_auth::SQLxAdminAuthStore;
use srouter_server::infrastructure::database::api_keys::{
    SQLxAPIKeyStore, reconcile_usage_from_logs,
};
use srouter_server::infrastructure::telemetry;
use srouter_server::{
    APIConfig, AppState, SecurityState, app::create_router, clock, http::listeners,
};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    dotenvy::dotenv().ok();
    telemetry::init();
    let environment: HashMap<String, String> = std::env::vars().collect();
    let config = APIConfig::from_env_map(&environment)?;
    // Development stays parseable for the suites that assert on it, but a
    // running server never starts there (owner ruling 2026-10-10). Printed
    // rather than returned because `Result`'s termination reports `Debug`,
    // which would name the variant without saying what was refused.
    if !config.is_production {
        eprintln!("NODE_ENV=development is refused: the server boots in production mode only");
        std::process::exit(1);
    }
    // Wildcard bind matches the Node listener and keeps Docker/VPS traffic reachable.
    let address = SocketAddr::from(([0, 0, 0, 0], config.port));

    // Opening the database brings SQLite to schema v7 before the listeners start.
    let database = AppDatabase::connect(&config).await?;
    // A key whose route billed nothing kept `usage_tokens` at zero while the
    // request log already held its tokens, so the counters are repaired from the
    // log on boot. Best-effort like the log itself: a failure must not stop boot,
    // because the request path settles usage correctly either way.
    match reconcile_usage_from_logs(&database).await {
        Ok(0) => {}
        Ok(raised) => tracing::info!(
            keys = raised,
            "raised API-key usage to the totals in the request log"
        ),
        Err(error) => tracing::warn!(error = %error, "could not reconcile API-key usage"),
    }
    let api_key_store = Arc::new(SQLxAPIKeyStore::new(database.clone()));
    let admin_store = Arc::new(SQLxAdminAuthStore::new(database.clone()));
    // Apply `SROUTER_ADMIN_PASSWORD` before the listener starts, exactly like
    // Node's `bootstrapAdminAccountFromEnv` invoked from `boot()`: create the
    // account on first boot, reset the password on every later boot.
    bootstrap_admin_account_from_env(admin_store.as_ref(), &config, clock::now_ms()).await?;
    let security =
        SecurityState::with_repository(api_key_store.clone(), admin_store.clone(), api_key_store)
            .with_admin_auth(admin_store);
    let registry = ProviderRegistry::with_database(Some(database.clone()))?;
    // Custom providers live in `providers` rows rather than compiled-in
    // definitions, so they join the registry from the database. A failure here
    // must not kill boot: the built-in drivers still serve.
    if let Err(error) = register_custom_providers(&registry, &database).await {
        tracing::warn!(error = %error, "could not register stored custom providers");
    }
    // Warm up the live catalog off the boot path: a first request that arrives
    // before this lands joins the same fetch instead of starting a second one.
    let warmup = registry.clone();
    tokio::spawn(async move {
        warmup.maybe_refresh_catalogs(false).await;
    });
    // Background OAuth token refresh sweeper matching Node's startTokenRefreshSweeper:
    // starts with a 5-second initial delay, then sweeps every 60 seconds.
    let sweeper = registry.clone();
    tokio::spawn(async move {
        tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
        sweeper.sweep_tokens().await;
        let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(60));
        loop {
            interval.tick().await;
            sweeper.sweep_tokens().await;
        }
    });
    let state = AppState::with_security(config, registry, security).with_database(database);

    listeners::serve_main(create_router(state), address).await?;

    Ok(())
}
