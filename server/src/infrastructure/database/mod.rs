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
mod migrations;
pub mod oauth_sessions;
pub mod providers;
pub mod request_logs;
mod row;
pub mod settings;
mod sqlite;

use sqlx::{PgPool, SqlitePool};

use crate::config::APIConfig;
use crate::constants;
use crate::error::APIError;

/// The persistence backend selected by configuration.
#[derive(Clone)]
pub enum AppDatabase {
    Sqlite(SqlitePool),
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

        let pool = sqlite::connect(&config.database_path)
            .await
            .map_err(|error| {
                APIError::new(500, constants::database::could_not_open_sqlite(&error))
            })?;
        migrations::run(&pool).await?;
        Ok(Self::Sqlite(pool))
    }

    /// Returns the SQLite pool when the SQLite backend is active.
    pub fn sqlite_pool(&self) -> Option<&SqlitePool> {
        match self {
            Self::Sqlite(pool) => Some(pool),
            Self::Postgres(_) => None,
        }
    }

    /// Returns the SQLite pool for a write, or an error naming the feature that
    /// cannot run on the active backend. A store that cannot persist its row
    /// fails loudly instead of pretending the change landed.
    pub fn sqlite_required(&self, message: &str) -> Result<&SqlitePool, APIError> {
        self.sqlite_pool()
            .ok_or_else(|| APIError::new(500, message))
    }
}
