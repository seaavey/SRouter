//! Favorite model ids behind the model catalog.

use std::collections::HashSet;

use sqlx::Row;

use crate::error::APIError;
use crate::infrastructure::database::AppDatabase;

/// Reads every favorited model id, lowercased so catalog entries can be matched
/// without depending on how the row was spelled when it was stored.
pub async fn favorite_model_ids(database: &AppDatabase) -> Result<HashSet<String>, APIError> {
    // PostgreSQL has no query carrier yet, so the catalog serves with no flags
    // instead of failing the request.
    let Some(pool) = database.sqlite_pool() else {
        return Ok(HashSet::new());
    };

    let rows = sqlx::query("SELECT model_id FROM favorite_models")
        .fetch_all(pool)
        .await
        .map_err(|error| APIError::new(500, format!("could not read favorite models: {error}")))?;

    let mut favorites = HashSet::with_capacity(rows.len());
    for row in &rows {
        let model_id = row.try_get::<String, _>("model_id").map_err(|error| {
            APIError::new(500, format!("could not read a favorite id: {error}"))
        })?;

        favorites.insert(model_id.to_lowercase());
    }

    Ok(favorites)
}
