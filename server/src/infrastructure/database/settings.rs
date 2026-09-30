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
