//! Persistence backend selection. Opening a connection applies the versioned
//! schema (SQLite, `docs/schemas-database.md`); repository queries stay behind
//! the persistence gate in `docs/api-database-contract.md`.

mod migrations;
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
    /// SQLite at `APIConfig::database_path`. The SQLite backend brings the
    /// file to schema v2 on connect (fresh install or legacy v1 transform);
    /// PostgreSQL is left untouched until it has a version carrier.
    pub async fn connect(config: &APIConfig) -> Result<Self, APIError> {
        match config.database_url.as_deref() {
            Some(database_url) => postgres::connect(database_url)
                .await
                .map(Self::Postgres)
                .map_err(|error| {
                    APIError::new(500, format!("could not connect to PostgreSQL: {error}"))
                }),
            None => {
                let pool = sqlite::connect(&config.database_path)
                    .await
                    .map_err(|error| {
                        APIError::new(500, format!("could not open the SQLite database: {error}"))
                    })?;
                migrations::run(&pool).await?;
                Ok(Self::Sqlite(pool))
            }
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
