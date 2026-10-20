//! SQLx reads and writes for customer accounts (`users`, schema v5). Free
//! functions rather than a store trait: there is no `Empty` implementation to
//! satisfy, and the routes already read `state.database` the way `features/logs`
//! and `features/settings` do.

use sqlx::sqlite::SqliteRow;
use sqlx::{Row, SqlitePool};

use crate::clock::now_ms;
use crate::constants;
use crate::error::APIError;
use crate::features::admin_auth::hash_session_token;
use crate::features::users::model::{
    CreatedUser, UpdateUserInput, User, generate_user_id, generate_user_token, user_token_prefix_of,
};
use crate::infrastructure::database::AppDatabase;

use super::row::text;

pub async fn list_users(database: &AppDatabase) -> Result<Vec<User>, APIError> {
    let pool = pool(database)?;
    let rows = sqlx::query(
        "SELECT id, name, token_prefix, enabled, created_at FROM users \
         ORDER BY created_at DESC, id",
    )
    .fetch_all(&pool)
    .await
    .map_err(sql_error(constants::database::context::LIST_USERS))?;

    rows.iter().map(user_from_row).collect()
}

pub async fn find_user(database: &AppDatabase, id: &str) -> Result<Option<User>, APIError> {
    let pool = pool(database)?;
    let row =
        sqlx::query("SELECT id, name, token_prefix, enabled, created_at FROM users WHERE id = ?")
            .bind(id)
            .fetch_optional(&pool)
            .await
            .map_err(sql_error(constants::database::context::READ_USER))?;

    row.as_ref().map(user_from_row).transpose()
}

/// Resolves the sha256 hash a login carries (`hash_session_token`, the same
/// at-rest rule the cookie follows) to its account.
pub async fn find_by_token(
    database: &AppDatabase,
    token_hash: &str,
) -> Result<Option<User>, APIError> {
    let pool = pool(database)?;
    let row = sqlx::query(
        "SELECT id, name, token_prefix, enabled, created_at FROM users WHERE token_hash = ?",
    )
    .bind(token_hash)
    .fetch_optional(&pool)
    .await
    .map_err(sql_error(constants::database::context::FIND_USER_BY_TOKEN))?;

    row.as_ref().map(user_from_row).transpose()
}

pub async fn create_user(database: &AppDatabase, name: &str) -> Result<CreatedUser, APIError> {
    let pool = pool(database)?;
    let id = generate_user_id()?;
    let token = generate_user_token()?;
    let token_prefix = user_token_prefix_of(&token);
    let created_at = now_ms();

    sqlx::query(
        "INSERT INTO users (id, name, token_hash, token_prefix, enabled, created_at) \
         VALUES (?, ?, ?, ?, 1, ?)",
    )
    .bind(&id)
    .bind(name)
    .bind(hash_session_token(&token))
    .bind(&token_prefix)
    .bind(created_at)
    .execute(&pool)
    .await
    .map_err(sql_error(constants::database::context::CREATE_USER))?;

    Ok(CreatedUser {
        user: User {
            id,
            name: name.to_owned(),
            token_prefix,
            enabled: true,
            created_at,
        },
        token,
    })
}

/// Applies a partial update. Disabling also ends the account's console sessions
/// inside the same transaction: a separate delete could commit the flag while
/// the session survived, leaving a disabled customer signed in.
pub async fn update_user(
    database: &AppDatabase,
    id: &str,
    patch: UpdateUserInput,
) -> Result<Option<User>, APIError> {
    let pool = pool(database)?;
    let mut transaction = pool
        .begin()
        .await
        .map_err(sql_error(constants::database::context::START_USER_UPDATE))?;

    let Some(mut user) = read_user(&mut transaction, id).await? else {
        return Ok(None);
    };
    let disabling = patch.enabled == Some(false);

    if let Some(name) = patch.name {
        user.name = name;
    }
    if let Some(enabled) = patch.enabled {
        user.enabled = enabled;
    }

    sqlx::query("UPDATE users SET name = ?, enabled = ? WHERE id = ?")
        .bind(&user.name)
        .bind(i64::from(user.enabled))
        .bind(&user.id)
        .execute(&mut *transaction)
        .await
        .map_err(sql_error(constants::database::context::UPDATE_USER))?;

    if disabling {
        delete_sessions(&mut transaction, &user.id).await?;
    }

    transaction
        .commit()
        .await
        .map_err(sql_error(constants::database::context::COMMIT_USER_UPDATE))?;

    Ok(Some(user))
}

/// Mints a replacement login token and clears the old one's sessions in one
/// transaction, so a rotation can never leave the previous session alive.
pub async fn rotate_token(
    database: &AppDatabase,
    id: &str,
) -> Result<Option<CreatedUser>, APIError> {
    let pool = pool(database)?;
    let mut transaction = pool
        .begin()
        .await
        .map_err(sql_error(constants::database::context::START_USER_UPDATE))?;

    let Some(mut user) = read_user(&mut transaction, id).await? else {
        return Ok(None);
    };
    let token = generate_user_token()?;
    user.token_prefix = user_token_prefix_of(&token);

    sqlx::query("UPDATE users SET token_hash = ?, token_prefix = ? WHERE id = ?")
        .bind(hash_session_token(&token))
        .bind(&user.token_prefix)
        .bind(&user.id)
        .execute(&mut *transaction)
        .await
        .map_err(sql_error(constants::database::context::ROTATE_USER_TOKEN))?;

    delete_sessions(&mut transaction, &user.id).await?;

    transaction
        .commit()
        .await
        .map_err(sql_error(constants::database::context::COMMIT_USER_UPDATE))?;

    Ok(Some(CreatedUser { user, token }))
}

async fn read_user(
    transaction: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    id: &str,
) -> Result<Option<User>, APIError> {
    let row =
        sqlx::query("SELECT id, name, token_prefix, enabled, created_at FROM users WHERE id = ?")
            .bind(id)
            .fetch_optional(&mut **transaction)
            .await
            .map_err(sql_error(constants::database::context::READ_USER))?;

    row.as_ref().map(user_from_row).transpose()
}

async fn delete_sessions(
    transaction: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    user_id: &str,
) -> Result<(), APIError> {
    sqlx::query("DELETE FROM auth_sessions WHERE user_id = ?")
        .bind(user_id)
        .execute(&mut **transaction)
        .await
        .map_err(sql_error(
            constants::database::context::DELETE_USER_SESSIONS,
        ))?;

    Ok(())
}

fn user_from_row(row: &SqliteRow) -> Result<User, APIError> {
    Ok(User {
        id: text(row, "id")?,
        name: text(row, "name")?,
        token_prefix: text(row, "token_prefix")?,
        enabled: row.try_get::<i64, _>("enabled").unwrap_or(0) != 0,
        created_at: row.try_get::<i64, _>("created_at").unwrap_or(0),
    })
}

fn pool(database: &AppDatabase) -> Result<SqlitePool, APIError> {
    database.sqlite_required(constants::database::USERS_UNSUPPORTED)
}

fn sql_error(context: &'static str) -> impl FnOnce(sqlx::Error) -> APIError {
    move |error| APIError::new(500, constants::database::with_context(context, &error))
}
