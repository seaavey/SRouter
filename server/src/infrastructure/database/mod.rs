//! Persistence backend selection. Opening a connection applies the versioned
//! schema (SQLite, `docs/schemas-database.md`); repository queries stay behind
//! the persistence gate in `docs/api-database-contract.md`.
//!
//! PostgreSQL is not supported yet: it has no schema carrier and no repository
//! statements, so a PostgreSQL boot would come up with no tables and answer
//! every request from empty defaults. `connect` refuses it instead of starting
//! a process that looks healthy and is not.

pub mod admin_auth;
pub mod api_keys;
pub mod catalog_flags;
pub(crate) mod migrations;
pub mod oauth_sessions;
pub mod providers;
pub mod request_logs;
pub(crate) mod row;
pub mod settings;
mod sqlite;

use std::path::Path;
use std::sync::Arc;

use sqlx::{PgPool, SqlitePool};

use crate::config::APIConfig;
use crate::constants;
use crate::error::APIError;

pub use sqlite::SqliteHandle;

/// The persistence backend selected by configuration.
#[derive(Clone)]
pub enum AppDatabase {
    Sqlite(Arc<SqliteHandle>),
    Postgres(PgPool),
}

impl AppDatabase {
    /// Opens SQLite at `APIConfig::database_path` and brings the file to schema
    /// v3 on connect (fresh install or legacy upgrade). A configured
    /// `DATABASE_URL` is refused: PostgreSQL support is not implemented, and
    /// starting without its schema would fail every request at runtime instead
    /// of at boot.
    pub async fn connect(config: &APIConfig) -> Result<Self, APIError> {
        if config.database_url.is_some() {
            return Err(APIError::new(
                500,
                constants::database::POSTGRES_UNSUPPORTED,
            ));
        }

        let handle = SqliteHandle::connect(&config.database_path)
            .await
            .map_err(|error| {
                APIError::new(500, constants::database::could_not_open_sqlite(&error))
            })?;
        migrations::run(&handle.pool()).await?;
        Ok(Self::Sqlite(handle))
    }

    /// The shared SQLite handle when the SQLite backend is active. The database
    /// importer needs it to swap the pool in place; everything else reads the
    /// pool through [`AppDatabase::sqlite_pool`].
    pub fn sqlite_handle(&self) -> Option<&Arc<SqliteHandle>> {
        match self {
            Self::Sqlite(handle) => Some(handle),
            Self::Postgres(_) => None,
        }
    }

    /// The active SQLite file path when the SQLite backend is active.
    pub fn sqlite_path(&self) -> Option<&Path> {
        self.sqlite_handle().map(|handle| handle.path())
    }

    /// Returns the SQLite pool when the SQLite backend is active.
    ///
    /// The pool is returned by value: `SqlitePool` is an `Arc` handle, so the
    /// clone is a refcount bump, and it can be held across an `.await` where a
    /// read guard could not.
    pub fn sqlite_pool(&self) -> Option<SqlitePool> {
        self.sqlite_handle().map(|handle| handle.pool())
    }

    /// Returns the SQLite pool for a write, or an error naming the feature that
    /// cannot run on the active backend. A store that cannot persist its row
    /// fails loudly instead of pretending the change landed.
    pub fn sqlite_required(&self, message: &str) -> Result<SqlitePool, APIError> {
        self.sqlite_pool()
            .ok_or_else(|| APIError::new(500, message))
    }
}
