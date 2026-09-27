//! SQLx-backed admin account and session state against schema v2. As with the
//! API-key store, only the SQLite backend is implemented because PostgreSQL has
//! no schema-version carrier yet.

use futures_util::future::BoxFuture;

use crate::error::APIError;
use crate::features::admin_auth::{AdminAuthRepository, AdminSessionStore};
use crate::infrastructure::database::AppDatabase;

/// Admin account rows (`admin_accounts`, singleton `id = 1`) and login sessions
/// (`admin_sessions`); only the sha256 token hash is ever stored.
#[derive(Clone)]
pub struct SQLxAdminAuthStore {
    database: AppDatabase,
}

impl SQLxAdminAuthStore {
    pub fn new(database: AppDatabase) -> Self {
        Self { database }
    }
}

impl AdminAuthRepository for SQLxAdminAuthStore {
    fn has_admin_account(&self) -> BoxFuture<'_, Result<bool, APIError>> {
        Box::pin(async move {
            let pool = self.pool()?;
            let exists: i64 =
                sqlx::query_scalar("SELECT COUNT(*) FROM admin_accounts WHERE id = 1")
                    .fetch_one(pool)
                    .await
                    .map_err(sql_error("read the admin account"))?;

            Ok(exists > 0)
        })
    }

    fn create_admin_account(
        &self,
        password_hash: &str,
        now_ms: i64,
    ) -> BoxFuture<'_, Result<bool, APIError>> {
        let password_hash = password_hash.to_owned();

        Box::pin(async move {
            let pool = self.pool()?;
            // `INSERT OR IGNORE` makes the singleton check atomic: a concurrent
            // setup wins once and the loser observes zero affected rows.
            let result = sqlx::query(
                "INSERT OR IGNORE INTO admin_accounts (id, password_hash, created_at, updated_at) \
                 VALUES (1, ?, ?, ?)",
            )
            .bind(password_hash)
            .bind(now_ms)
            .bind(now_ms)
            .execute(pool)
            .await
            .map_err(sql_error("create the admin account"))?;

            Ok(result.rows_affected() > 0)
        })
    }

    fn get_password_hash(&self) -> BoxFuture<'_, Result<Option<String>, APIError>> {
        Box::pin(async move {
            let pool = self.pool()?;

            sqlx::query_scalar::<_, String>("SELECT password_hash FROM admin_accounts WHERE id = 1")
                .fetch_optional(pool)
                .await
                .map_err(sql_error("read the admin password hash"))
        })
    }

    fn update_password_hash(
        &self,
        password_hash: &str,
        now_ms: i64,
    ) -> BoxFuture<'_, Result<bool, APIError>> {
        let password_hash = password_hash.to_owned();

        Box::pin(async move {
            let pool = self.pool()?;
            let result = sqlx::query(
                "UPDATE admin_accounts SET password_hash = ?, updated_at = ? WHERE id = 1",
            )
            .bind(password_hash)
            .bind(now_ms)
            .execute(pool)
            .await
            .map_err(sql_error("update the admin password hash"))?;

            Ok(result.rows_affected() > 0)
        })
    }

    fn create_session(
        &self,
        token_hash: &str,
        created_at: i64,
        expires_at: i64,
    ) -> BoxFuture<'_, Result<(), APIError>> {
        let token_hash = token_hash.to_owned();

        Box::pin(async move {
            let pool = self.pool()?;
            sqlx::query(
                "INSERT OR REPLACE INTO admin_sessions (token_hash, created_at, expires_at) \
                 VALUES (?, ?, ?)",
            )
            .bind(token_hash)
            .bind(created_at)
            .bind(expires_at)
            .execute(pool)
            .await
            .map_err(sql_error("create an admin session"))?;

            Ok(())
        })
    }

    fn delete_session(&self, token_hash: &str) -> BoxFuture<'_, Result<bool, APIError>> {
        let token_hash = token_hash.to_owned();

        Box::pin(async move {
            let pool = self.pool()?;
            let result = sqlx::query("DELETE FROM admin_sessions WHERE token_hash = ?")
                .bind(token_hash)
                .execute(pool)
                .await
                .map_err(sql_error("delete an admin session"))?;

            Ok(result.rows_affected() > 0)
        })
    }
}

impl AdminSessionStore for SQLxAdminAuthStore {
    fn has_valid_session<'a>(
        &'a self,
        token_hash: &'a str,
        now_ms: i64,
    ) -> BoxFuture<'a, Result<bool, APIError>> {
        Box::pin(async move {
            let pool = self.pool()?;
            let count: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM admin_sessions WHERE token_hash = ? AND expires_at > ?",
            )
            .bind(token_hash)
            .bind(now_ms)
            .fetch_one(pool)
            .await
            .map_err(sql_error("read an admin session"))?;

            Ok(count > 0)
        })
    }
}

impl SQLxAdminAuthStore {
    fn pool(&self) -> Result<&sqlx::SqlitePool, APIError> {
        self.database.sqlite_pool().ok_or_else(|| {
            APIError::new(
                500,
                "the PostgreSQL backend has no admin stores yet; schema v2 is SQLite-only",
            )
        })
    }
}

fn sql_error(context: &'static str) -> impl FnOnce(sqlx::Error) -> APIError {
    move |error| APIError::new(500, format!("{context}: {error}"))
}
