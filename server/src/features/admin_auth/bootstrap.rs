//! Admin bootstrap from the environment, parity with Node's
//! `bootstrapAdminAccountFromEnv` (`apps/api/src/services/adminAuth.ts`):
//! when `SROUTER_ADMIN_PASSWORD` is set, the account is created when missing and
//! the password is reset on every later boot (the documented recovery path).
//! Without the variable nothing is auto-created, so first-run setup still
//! happens through the dashboard (`POST /v1/admin/setup`).

use crate::config::APIConfig;
use crate::error::APIError;

use super::password::hash_admin_password;
use super::repository::AdminAuthRepository;

/// Applies the configured `SROUTER_ADMIN_PASSWORD` to the singleton admin
/// account. A missing or empty value leaves the database untouched.
pub async fn bootstrap_admin_account_from_env(
    repository: &dyn AdminAuthRepository,
    config: &APIConfig,
    now_ms: i64,
) -> Result<(), APIError> {
    let Some(password) = config
        .admin_password
        .as_deref()
        .filter(|password| !password.is_empty())
    else {
        return Ok(());
    };

    let password_hash = hash_admin_password(password)?;
    if repository.has_admin_account().await? {
        repository
            .update_password_hash(&password_hash, now_ms)
            .await?;
    } else {
        repository
            .create_admin_account(&password_hash, now_ms)
            .await?;
    }

    Ok(())
}
