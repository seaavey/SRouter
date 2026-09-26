//! Persistence backend selection. Opening a connection is all this module does:
//! migrations, schema conversion, and repository queries stay behind the schema
//! gate documented in `docs/api-database-contract.md`.

mod postgres;
mod sqlite;

use sqlx::{PgPool, SqlitePool};

use crate::config::APIConfig;
use crate::error::APIError;

/// The persistence backend selected by configuration.
#[derive(Clone)]
pub enum AppDatabase {
    Sqlite(SqlitePool),
    Postgres(PgPool),
}

impl AppDatabase {
    /// Connects to PostgreSQL when `DATABASE_URL` is configured, otherwise to
    /// SQLite at `APIConfig::database_path`. No migration or schema change is
    /// applied here.
    pub async fn connect(config: &APIConfig) -> Result<Self, APIError> {
        match config.database_url.as_deref() {
            Some(database_url) => postgres::connect(database_url)
                .await
                .map(Self::Postgres)
                .map_err(|error| {
                    APIError::new(500, format!("could not connect to PostgreSQL: {error}"))
                }),
            None => sqlite::connect(&config.database_path)
                .await
                .map(Self::Sqlite)
                .map_err(|error| {
                    APIError::new(500, format!("could not open the SQLite database: {error}"))
                }),
        }
    }

    /// Returns the SQLite pool when the SQLite backend is active.
    pub fn sqlite_pool(&self) -> Option<&SqlitePool> {
        match self {
            Self::Sqlite(pool) => Some(pool),
            Self::Postgres(_) => None,
        }
    }

    /// Returns the PostgreSQL pool when the PostgreSQL backend is active.
    pub fn postgres_pool(&self) -> Option<&PgPool> {
        match self {
            Self::Postgres(pool) => Some(pool),
            Self::Sqlite(_) => None,
        }
    }
}
