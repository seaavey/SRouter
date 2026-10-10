//! Shared SQLite row reads for the repository modules.
//!
//! Every store maps an unreadable column onto the same 500 with the column
//! name, so the three typed readers live here instead of being copied per
//! module.

use sqlx::Row;
use sqlx::sqlite::SqliteRow;

use crate::constants;
use crate::error::APIError;

/// Reads a required text column, naming it in the error when the value is not
/// a string.
pub(crate) fn text(row: &SqliteRow, column: &str) -> Result<String, APIError> {
    row.try_get::<String, _>(column)
        .map_err(|error| APIError::new(500, constants::database::column_unreadable(column, &error)))
}

/// Reads a nullable text column.
pub(crate) fn optional_text(row: &SqliteRow, column: &str) -> Result<Option<String>, APIError> {
    row.try_get::<Option<String>, _>(column)
        .map_err(|error| APIError::new(500, constants::database::column_unreadable(column, &error)))
}

/// Reads an integer column.
pub(crate) fn integer(row: &SqliteRow, column: &str) -> Result<i64, APIError> {
    row.try_get::<i64, _>(column)
        .map_err(|error| APIError::new(500, constants::database::column_unreadable(column, &error)))
}
