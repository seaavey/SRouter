//! CodeBuddy credential store: the OAuth session behind `codebuddy` /
//! `codebuddy-cn`.

use serde_json::Value;

use crate::clock::now_ms;
use crate::constants;
use crate::error::APIError;
use crate::infrastructure::database::AppDatabase;
use crate::infrastructure::database::row::text;

use super::credential_string;

/// The connection row the auth routes write after a successful login.
#[derive(Clone, Debug)]
pub struct CodeBuddyConnectionWrite {
    pub id: String,
    pub provider_id: String,
    pub name: String,
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub token_expires_at: Option<i64>,
    pub base_url: String,
}

pub async fn upsert_codebuddy_connection(
    database: &AppDatabase,
    write: &CodeBuddyConnectionWrite,
) -> Result<(), APIError> {
    let pool = database.sqlite_required(constants::database::PROVIDERS_UNSUPPORTED)?;
    let credentials = serde_json::json!({
        "access_token": write.access_token,
        "refresh_token": write.refresh_token,
        "token_expires_at": write.token_expires_at,
        "last_refreshed_at": now_ms(),
    });

    sqlx::query(
        "INSERT INTO providers
         (id, provider_id, name, category, protocol, enabled, credentials, meta, base_url, created_at)
         VALUES (?, ?, ?, 'oauth', 'openai', 1, ?, '{}', ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name, credentials = excluded.credentials, base_url = excluded.base_url,
           enabled = 1",
    )
    .bind(&write.id)
    .bind(&write.provider_id)
    .bind(&write.name)
    .bind(credentials.to_string())
    .bind(&write.base_url)
    .bind(now_ms())
    .execute(pool)
    .await
    .map_err(|error| {
        APIError::new(
            500,
            constants::database::with_context("store the CodeBuddy connection", error),
        )
    })?;

    Ok(())
}

/// Credential store for CodeBuddy: the OAuth session behind `codebuddy` /
/// `codebuddy-cn`. Only the access token is needed for inference; refresh is
/// deferred, so the rest of the stored row is left unread.
#[derive(Clone, Debug)]
pub struct CodeBuddyCredentials {
    pub access_token: String,
}

/// Loads the access token of the newest enabled connection whose `provider_id`
/// matches exactly. `codebuddy` is a prefix of `codebuddy-cn`, so an exact match
/// is what keeps the two flavors apart (a `matches_base_id` test would not).
pub async fn load_codebuddy_credentials(
    database: &AppDatabase,
    provider_id: &str,
) -> Result<Option<CodeBuddyCredentials>, APIError> {
    let Some(pool) = database.sqlite_pool() else {
        return Ok(None);
    };

    let rows = sqlx::query(
        "SELECT credentials FROM providers
         WHERE provider_id = ? AND enabled = 1
         ORDER BY created_at DESC
         LIMIT 1",
    )
    .bind(provider_id)
    .fetch_all(pool)
    .await
    .map_err(|error| {
        APIError::new(
            500,
            constants::database::with_context("read CodeBuddy credentials", error),
        )
    })?;

    for row in &rows {
        let raw = text(row, "credentials")?;

        if let Some(credentials) = parse_codebuddy_credentials(&raw) {
            return Ok(Some(credentials));
        }
    }

    Ok(None)
}

/// Parses a CodeBuddy credentials JSON row. Malformed JSON or a missing access
/// token yields `None`, which the executor reports as "not connected".
fn parse_codebuddy_credentials(raw: &str) -> Option<CodeBuddyCredentials> {
    let value: Value = serde_json::from_str(raw).ok()?;
    let object = value.as_object()?;

    Some(CodeBuddyCredentials {
        access_token: credential_string(object, &["access_token", "accessToken"])?,
    })
}
