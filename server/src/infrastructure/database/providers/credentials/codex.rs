//! Codex credential store: the ChatGPT OAuth session behind `openai_codex`.

use serde_json::Value;

use crate::clock::now_ms;
use crate::constants;
use crate::error::APIError;
use crate::infrastructure::database::AppDatabase;
use crate::infrastructure::database::row::text;

use super::credential_string;

/// Credential store for Codex: the ChatGPT OAuth session behind `openai_codex`.
#[derive(Clone, Debug)]
pub struct CodexCredentials {
    /// The providers row id this connection lives under (the WHERE target for token updates).
    pub id: String,
    pub access_token: String,
    pub refresh_token: Option<String>,
    /// The ChatGPT account the `chatgpt-account-id` header is built from.
    pub account_id: Option<String>,
    /// Milliseconds since the Unix epoch, `None` when the upstream never said.
    pub token_expires_at: Option<i64>,
    pub last_refreshed_at: Option<i64>,
}

impl CodexCredentials {
    /// Whether the access token has already lapsed.
    pub fn is_expired(&self, now_ms: i64) -> bool {
        self.token_expires_at.is_some_and(|expiry| expiry <= now_ms)
    }
}

/// Loads the credentials of the newest enabled `openai_codex` connection.
/// Accepts snake_case and camelCase spellings: the OAuth import writes the
/// Node field names while the refresh path writes the schema columns.
pub async fn load_codex_credentials(
    database: &AppDatabase,
) -> Result<Option<CodexCredentials>, APIError> {
    let Some(pool) = database.sqlite_pool() else {
        return Ok(None);
    };

    let rows = sqlx::query(
        "SELECT id, credentials FROM providers
         WHERE provider_id = 'openai_codex' AND enabled = 1
         ORDER BY created_at DESC
         LIMIT 1",
    )
    .fetch_all(&pool)
    .await
    .map_err(|error| {
        APIError::new(
            500,
            constants::database::with_context("read Codex credentials", &error),
        )
    })?;

    for row in &rows {
        let raw = text(row, "credentials")?;

        if let Some(mut credentials) = parse_codex_credentials(&raw) {
            credentials.id = text(row, "id")?;
            return Ok(Some(credentials));
        }
    }

    Ok(None)
}

/// Parses a Codex credentials JSON row. Malformed JSON or a missing access
/// token yields `None`, which the executor reports as "not connected".
fn parse_codex_credentials(raw: &str) -> Option<CodexCredentials> {
    let value: Value = serde_json::from_str(raw).ok()?;
    let object = value.as_object()?;

    Some(CodexCredentials {
        id: String::new(),
        access_token: credential_string(object, &["access_token", "accessToken"])?,
        refresh_token: credential_string(object, &["refresh_token", "refreshToken"]),
        account_id: credential_string(object, &["account_id", "accountId"]),
        token_expires_at: object
            .get("token_expires_at")
            .or_else(|| object.get("tokenExpiresAt"))
            .or_else(|| object.get("expiresAt"))
            .and_then(Value::as_i64),
        last_refreshed_at: object
            .get("last_refreshed_at")
            .or_else(|| object.get("lastRefreshedAt"))
            .and_then(Value::as_i64),
    })
}

/// Writes the rotated token fields back into the providers row, keeping every
/// credential the row already holds (the account id above all).
pub async fn update_codex_tokens(
    database: &AppDatabase,
    id: &str,
    access: &str,
    refresh: &str,
    expires_at_ms: Option<i64>,
    refreshed_at_ms: i64,
) -> Result<(), APIError> {
    let pool = database.sqlite_required(constants::database::PROVIDERS_UNSUPPORTED)?;

    let current = sqlx::query_scalar::<_, String>("SELECT credentials FROM providers WHERE id = ?")
        .bind(id)
        .fetch_optional(&pool)
        .await
        .map_err(|error| {
            APIError::new(
                500,
                constants::database::with_context("read the Codex credentials", &error),
            )
        })?;

    let mut credentials: Value = current
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
        .filter(Value::is_object)
        .unwrap_or_else(|| Value::Object(serde_json::Map::new()));
    credentials["access_token"] = Value::String(access.to_owned());
    credentials["refresh_token"] = Value::String(refresh.to_owned());
    credentials["token_expires_at"] = match expires_at_ms {
        Some(expires_at) => Value::from(expires_at),
        None => Value::Null,
    };
    credentials["last_refreshed_at"] = Value::from(refreshed_at_ms);

    sqlx::query(
        "UPDATE providers
         SET credentials = ?, enabled = 1
         WHERE id = ?",
    )
    .bind(credentials.to_string())
    .bind(id)
    .execute(&pool)
    .await
    .map_err(|error| {
        APIError::new(
            500,
            constants::database::with_context("update Codex tokens", &error),
        )
    })?;

    Ok(())
}

/// The Codex connection row the OAuth import writes after a token is saved.
#[derive(Clone, Debug)]
pub struct CodexConnectionWrite {
    pub id: String,
    pub name: String,
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub account_id: Option<String>,
    pub token_expires_at: Option<i64>,
}

/// Upserts a Codex connection. Reconnecting the same row replaces the session
/// and re-enables the driver, mirroring `upsert_cline_connection`.
pub async fn upsert_codex_connection(
    database: &AppDatabase,
    write: &CodexConnectionWrite,
) -> Result<(), APIError> {
    let pool = database.sqlite_required(constants::database::PROVIDERS_UNSUPPORTED)?;
    let credentials = serde_json::json!({
        "access_token": write.access_token,
        "refresh_token": write.refresh_token,
        "account_id": write.account_id,
        "token_expires_at": write.token_expires_at,
        "last_refreshed_at": now_ms(),
    });

    sqlx::query(
        "INSERT INTO providers
         (id, provider_id, name, category, protocol, enabled, credentials, meta, base_url, created_at)
         VALUES (?, 'openai_codex', ?, 'oauth', 'openai', 1, ?, '{}',
                 'https://chatgpt.com/backend-api/codex', ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name, credentials = excluded.credentials, enabled = 1",
    )
    .bind(&write.id)
    .bind(&write.name)
    .bind(credentials.to_string())
    .bind(now_ms())
    .execute(&pool)
    .await
    .map_err(|error| {
        APIError::new(
            500,
            constants::database::with_context("store the Codex connection", &error),
        )
    })?;

    Ok(())
}
