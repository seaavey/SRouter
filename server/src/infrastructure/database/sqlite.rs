use std::path::Path;

use sqlx::SqlitePool;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};

/// Opens a SQLite pool, creating the data directory and database file when they
/// do not exist. Existing storage is never dropped or recreated.
pub async fn connect(path: &Path) -> Result<SqlitePool, sqlx::Error> {
    if let Some(parent) = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        std::fs::create_dir_all(parent).map_err(sqlx::Error::Io)?;
    }

    let options = SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(true)
        .foreign_keys(true);

    SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(options)
        .await
}
