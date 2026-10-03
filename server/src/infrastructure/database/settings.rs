//! Settings persistence backed by SQLite.

use crate::constants;
use crate::error::APIError;
use crate::infrastructure::database::AppDatabase;

/// Reads the `require_api_key` setting flag. Defaults to `false` when missing.
pub async fn get_require_api_key(database: &AppDatabase) -> Result<bool, APIError> {
    let Some(pool) = database.sqlite_pool() else {
        return Ok(false);
    };

    let value =
        sqlx::query_scalar::<_, String>("SELECT value FROM settings WHERE key = 'require_api_key'")
            .fetch_optional(pool)
            .await
            .map_err(|error| {
                APIError::new(
                    500,
                    constants::database::could_not_read_require_api_key(&error),
                )
            })?;

    Ok(matches!(value.as_deref(), Some("true") | Some("1")))
}

/// Sets the `require_api_key` setting flag.
pub async fn set_require_api_key(database: &AppDatabase, required: bool) -> Result<(), APIError> {
    let Some(pool) = database.sqlite_pool() else {
        return Err(APIError::new(
            500,
            constants::database::SETTINGS_DATABASE_REQUIRED,
        ));
    };

    let val = if required { "true" } else { "false" };
    sqlx::query(
        "INSERT INTO settings (key, value) VALUES ('require_api_key', ?) \
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind(val)
    .execute(pool)
    .await
    .map_err(|error| {
        APIError::new(
            500,
            constants::database::could_not_update_require_api_key(&error),
        )
    })?;

    Ok(())
}

/// Reads one settings row by key. A key that is not stored reads as `None`, so
/// a caller can tell "unset" from "empty".
pub async fn get_setting(database: &AppDatabase, key: &str) -> Result<Option<String>, APIError> {
    let Some(pool) = database.sqlite_pool() else {
        return Ok(None);
    };

    sqlx::query_scalar::<_, String>("SELECT value FROM settings WHERE key = ?")
        .bind(key)
        .fetch_optional(pool)
        .await
        .map_err(|error| {
            APIError::new(
                500,
                constants::database::with_context(format!("read setting '{key}'"), error),
            )
        })
}

/// Writes one settings row by key.
pub async fn set_setting(database: &AppDatabase, key: &str, value: &str) -> Result<(), APIError> {
    let Some(pool) = database.sqlite_pool() else {
        return Err(APIError::new(
            500,
            constants::database::SETTINGS_DATABASE_REQUIRED,
        ));
    };

    sqlx::query(
        "INSERT INTO settings (key, value) VALUES (?, ?) \
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind(key)
    .bind(value)
    .execute(pool)
    .await
    .map_err(|error| {
        APIError::new(
            500,
            constants::database::with_context(format!("write setting '{key}'"), error),
        )
    })?;

    Ok(())
}
