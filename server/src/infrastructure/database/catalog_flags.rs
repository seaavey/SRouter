//! Favorite and hidden model ids behind the model catalog.

use std::collections::HashSet;

use sqlx::Row;

use crate::constants;
use crate::error::APIError;
use crate::infrastructure::database::AppDatabase;
use crate::infrastructure::database::providers::PROVIDER_ENABLED_PREFIX;

/// Reads every favorited model id, lowercased so catalog entries can be matched
/// without depending on how the row was spelled when it was stored.
pub async fn favorite_model_ids(database: &AppDatabase) -> Result<HashSet<String>, APIError> {
    // PostgreSQL has no query carrier yet, so the catalog serves with no flags
    // instead of failing the request.
    let Some(pool) = database.sqlite_pool() else {
        return Ok(HashSet::new());
    };

    let rows = sqlx::query("SELECT model_id FROM favorite_models")
        .fetch_all(&pool)
        .await
        .map_err(|error| {
            APIError::new(
                500,
                constants::database::could_not_read_favorite_models(&error),
            )
        })?;

    let mut favorites = HashSet::with_capacity(rows.len());
    for row in &rows {
        let model_id = row.try_get::<String, _>("model_id").map_err(|error| {
            APIError::new(500, constants::database::could_not_read_favorite_id(&error))
        })?;

        favorites.insert(model_id.to_lowercase());
    }

    Ok(favorites)
}

/// Reads the ids of the providers switched off, lowercased. The stored key is
/// `provider_enabled_<base id>`, so the prefix comes off here.
pub async fn disabled_provider_ids(database: &AppDatabase) -> Result<HashSet<String>, APIError> {
    let Some(pool) = database.sqlite_pool() else {
        return Ok(HashSet::new());
    };

    let rows = sqlx::query(
        "SELECT key FROM settings WHERE key LIKE 'provider_enabled_%' AND value = 'false'",
    )
    .fetch_all(&pool)
    .await
    .map_err(|error| {
        APIError::new(
            500,
            constants::database::could_not_read_provider_flags(&error),
        )
    })?;

    let mut disabled = HashSet::with_capacity(rows.len());
    for row in &rows {
        let key = row.try_get::<String, _>("key").map_err(|error| {
            APIError::new(
                500,
                constants::database::could_not_read_provider_flag_key(&error),
            )
        })?;

        if let Some(provider_id) = key.strip_prefix(PROVIDER_ENABLED_PREFIX) {
            disabled.insert(provider_id.to_lowercase());
        }
    }

    Ok(disabled)
}

/// Reads every hidden model id, lowercased so catalog entries can be matched
/// without depending on how the row was spelled when it was stored. The flag is
/// global: `provider_model_overrides.hidden` carries no provider dimension in
/// the catalog filter, matching Node's `getAllHiddenModelsDB` call.
pub async fn hidden_model_ids(database: &AppDatabase) -> Result<HashSet<String>, APIError> {
    let Some(pool) = database.sqlite_pool() else {
        return Ok(HashSet::new());
    };

    let rows = sqlx::query("SELECT model_id FROM provider_model_overrides WHERE hidden = 1")
        .fetch_all(&pool)
        .await
        .map_err(|error| {
            APIError::new(
                500,
                constants::database::could_not_read_hidden_models(&error),
            )
        })?;

    let mut hidden = HashSet::with_capacity(rows.len());
    for row in &rows {
        let model_id = row.try_get::<String, _>("model_id").map_err(|error| {
            APIError::new(
                500,
                constants::database::could_not_read_hidden_model_id(&error),
            )
        })?;

        hidden.insert(model_id.to_lowercase());
    }

    Ok(hidden)
}
