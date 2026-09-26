use sqlx::PgPool;
use sqlx::postgres::PgPoolOptions;

/// Opens a PostgreSQL pool from the configured connection URL.
pub async fn connect(database_url: &str) -> Result<PgPool, sqlx::Error> {
    PgPoolOptions::new()
        .max_connections(5)
        .connect(database_url)
        .await
}
