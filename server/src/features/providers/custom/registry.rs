//! Wiring between the stored custom-provider rows and the live registry.
//!
//! The registry is built from the compiled-in drivers at boot. A custom provider
//! lives in a `providers` row, so it is registered from the database: once on
//! boot and again after every create or delete, mirroring Node's
//! `loadSavedProvidersFromDB`.
//!
//! Registration goes through `ProviderRegistry::register_runtime`, which needs
//! no `&mut self`, so a request can add or drop a provider while other requests
//! read the catalog.

use crate::error::APIError;
use crate::features::providers::ProviderRegistry;
use crate::features::providers::custom::{adapter_from_row, find_custom_provider};
use crate::infrastructure::database::AppDatabase;
use crate::infrastructure::database::providers::list_custom_providers;

/// Registers every stored custom provider. Called on boot, after the built-in
/// drivers are in place.
pub async fn register_custom_providers(
    registry: &ProviderRegistry,
    database: &AppDatabase,
) -> Result<(), APIError> {
    for row in list_custom_providers(database).await? {
        let adapter = adapter_from_row(row, Some(database.clone()))?;
        registry.register_runtime(adapter);
    }

    Ok(())
}

/// Re-reads one provider row and (re)registers it, so an edited provider serves
/// its new base URL and credentials immediately.
pub async fn refresh_custom_provider(
    registry: &ProviderRegistry,
    database: &AppDatabase,
    id: &str,
) -> Result<(), APIError> {
    registry.unregister(id);

    if let Some(row) = find_custom_provider(database, id).await? {
        let adapter = adapter_from_row(row, Some(database.clone()))?;
        registry.register_runtime(adapter);
    }

    Ok(())
}

/// Drops one provider from the live registry, after its row was deleted.
pub fn unregister_custom_provider(registry: &ProviderRegistry, id: &str) {
    registry.unregister(id);
}
