//! Antigravity catalog snapshot policy (D2).
//!
//! The catalog is static — there is no unauthenticated model endpoint — so
//! `maybe_refresh` never contacts upstream for the list. It only checks the
//! exact `antigravity` connection and flips the shared snapshot on (the 17 ids)
//! or off (empty). The snapshot is what `models()` advertises, so the provider
//! is invisible until a connection exists.

use std::sync::{Arc, RwLock, RwLockReadGuard, RwLockWriteGuard};

use super::executor::AntigravityExecutor;
use super::types::ANTIGRAVITY_MODEL_IDS;
use crate::infrastructure::database::providers::load_antigravity_credentials;

/// The advertised model ids of the last connection check.
#[derive(Debug, Default)]
pub struct AntigravityCatalog {
    pub models: Vec<String>,
}

/// The catalog handle the executor and the registry share.
pub type SharedCatalog = Arc<RwLock<AntigravityCatalog>>;

impl AntigravityCatalog {
    /// The starting snapshot: no connection has been seen, so nothing is
    /// advertised.
    pub fn empty() -> Self {
        Self::default()
    }

    /// Builds a shared handle holding the empty starting snapshot.
    pub fn shared_empty() -> SharedCatalog {
        Arc::new(RwLock::new(Self::empty()))
    }
}

/// Reads the snapshot without letting a panicking holder's poison spread.
pub fn read_catalog(catalog: &SharedCatalog) -> RwLockReadGuard<'_, AntigravityCatalog> {
    catalog
        .read()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Writes the snapshot without letting a panicking holder's poison spread.
pub fn write_catalog(catalog: &SharedCatalog) -> RwLockWriteGuard<'_, AntigravityCatalog> {
    catalog
        .write()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

impl AntigravityExecutor {
    /// Flips the static catalog on/off from the connection, then bootstraps the
    /// CloudCode project id (D5) when a `ya29.` token has none yet.
    pub async fn maybe_refresh(&self, _force: bool) {
        let Some(database) = self.database.as_ref() else {
            write_catalog(&self.catalog).models.clear();
            return;
        };

        match load_antigravity_credentials(database).await {
            Ok(Some(credentials)) => {
                write_catalog(&self.catalog).models = ANTIGRAVITY_MODEL_IDS
                    .iter()
                    .map(|id| (*id).to_owned())
                    .collect();

                if credentials.project_id.is_none() && credentials.access_token.starts_with("ya29.")
                {
                    let _ = self.ensure_project_id(&credentials).await;
                }
            }
            Ok(None) => {
                write_catalog(&self.catalog).models.clear();
            }
            Err(_) => {}
        }
    }
}
