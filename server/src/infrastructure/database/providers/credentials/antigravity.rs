//! Antigravity credential store: the Google OAuth session behind `antigravity`.

use serde_json::Value;

use crate::clock::now_ms;
use crate::constants;
use crate::error::APIError;
use crate::infrastructure::database::AppDatabase;
use crate::infrastructure::database::row::text;

use super::credential_string;

/// A stored Antigravity connection's usable credentials. It never enters a
/// response or a log line; it exists so the executor can sign one upstream
/// request, refresh it, and carry the CloudCode project id.
#[derive(Clone, Debug)]
pub struct AntigravityCredentials {
    /// The providers row id this connection lives under (the WHERE target for
    /// token updates, and the per-connection refresh-lock key).
    pub id: String,
    pub access_token: String,
    pub refresh_token: Option<String>,
    /// Milliseconds since the Unix epoch, `None` when the upstream never said.
    pub expires_at: Option<i64>,
    /// The CloudCode project id resolved by `loadCodeAssist` (D5), if any.
    pub project_id: Option<String>,
}

impl AntigravityCredentials {
    /// Whether the access token has already lapsed.
    pub fn is_expired(&self, now_ms: i64) -> bool {
        self.expires_at.is_some_and(|expiry| expiry <= now_ms)
    }
}

/// The connection row the auth routes write after a successful OAuth exchange
/// or token import.
#[derive(Clone, Debug)]
pub struct AntigravityConnectionWrite {
    pub id: String,
    /// What the Providers page shows: the account email, or an Antigravity
    /// fallback name.
    pub name: String,
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_at: Option<i64>,
    pub project_id: Option<String>,
}

/// Loads the credentials of the newest enabled Antigravity connection. The
/// camelCase spellings are accepted as well so a row written by the Node build
/// still reads.
pub async fn load_antigravity_credentials(
    database: &AppDatabase,
) -> Result<Option<AntigravityCredentials>, APIError> {
    let Some(pool) = database.sqlite_pool() else {
        return Ok(None);
    };

    let rows = sqlx::query(
        "SELECT id, credentials FROM providers \
         WHERE enabled = 1 AND (provider_id = 'antigravity' OR provider_id LIKE 'antigravity_%' \
            OR provider_id LIKE 'antigravity-%' OR id = 'antigravity' OR id LIKE 'antigravity_%' \
            OR id LIKE 'antigravity-%') \
         ORDER BY created_at DESC",
    )
    .fetch_all(&pool)
    .await
    .map_err(|error| {
        APIError::new(
            500,
            constants::database::with_context("read Antigravity credentials", error),
        )
    })?;

    for row in &rows {
        let raw = text(row, "credentials")?;

        if let Some(mut credentials) = parse_antigravity_credentials(&raw) {
            credentials.id = text(row, "id")?;
            return Ok(Some(credentials));
        }
    }

    Ok(None)
}

/// Parses an Antigravity credentials JSON row. Malformed JSON or a missing
/// access token yields `None`, which the executor reports as "not connected".
fn parse_antigravity_credentials(raw: &str) -> Option<AntigravityCredentials> {
    let value: Value = serde_json::from_str(raw).ok()?;
    let object = value.as_object()?;

    let expires_at = [
        "token_expires_at",
        "tokenExpiresAt",
        "expires_at",
        "expiresAt",
    ]
    .iter()
    .find_map(|key| object.get(*key).and_then(Value::as_i64));

    Some(AntigravityCredentials {
        id: String::new(),
        access_token: credential_string(object, &["access_token", "accessToken"])?,
        refresh_token: credential_string(object, &["refresh_token", "refreshToken"]),
        expires_at,
        project_id: credential_string(object, &["project_id", "projectId"]),
    })
}

/// Builds the credentials JSON for a fresh connection. The canonical expiry key
/// is `token_expires_at` (the parser reads it first, and qoder/codex write it); a
/// second `expires_at` key would shadow a refreshed value on a migrated row.
fn connection_credentials(write: &AntigravityConnectionWrite, refreshed_at_ms: i64) -> Value {
    serde_json::json!({
        "access_token": write.access_token,
        "refresh_token": write.refresh_token,
        "token_expires_at": write.expires_at,
        "project_id": write.project_id,
        "last_refreshed_at": refreshed_at_ms,
    })
}

/// Merges rotated tokens into an existing credentials object, preserving every
/// other key (the project id above all). Writes the canonical `token_expires_at`
/// so a migrated row's stale value is overwritten rather than shadowed.
fn merge_rotated_tokens(
    mut credentials: Value,
    access_token: &str,
    refresh_token: &str,
    expires_at_ms: Option<i64>,
    refreshed_at_ms: i64,
) -> Value {
    credentials["access_token"] = Value::String(access_token.to_owned());
    credentials["refresh_token"] = Value::String(refresh_token.to_owned());
    credentials["token_expires_at"] = match expires_at_ms {
        Some(expires_at) => Value::from(expires_at),
        None => Value::Null,
    };
    credentials["last_refreshed_at"] = Value::from(refreshed_at_ms);
    credentials
}

/// Writes or refreshes one Antigravity connection. The id is the primary key,
/// so a repeated callback for the same account updates the token in place.
pub async fn upsert_antigravity_connection(
    database: &AppDatabase,
    write: &AntigravityConnectionWrite,
) -> Result<(), APIError> {
    let pool = database.sqlite_required(constants::database::PROVIDERS_UNSUPPORTED)?;
    let credentials = connection_credentials(write, now_ms());

    sqlx::query(
        "INSERT INTO providers \
         (id, provider_id, name, category, protocol, enabled, credentials, meta, created_at) \
         VALUES (?, 'antigravity', ?, 'oauth', 'openai', 1, ?, '{}', ?) \
         ON CONFLICT(id) DO UPDATE SET \
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
            constants::database::with_context("store the Antigravity connection", error),
        )
    })?;

    Ok(())
}

/// Writes the rotated token fields back into the Antigravity connection row,
/// keeping every credential the row already holds (the project id above all).
pub async fn update_antigravity_tokens(
    database: &AppDatabase,
    id: &str,
    access_token: &str,
    refresh_token: &str,
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
                constants::database::with_context("read the Antigravity credentials", error),
            )
        })?;

    let credentials = merge_rotated_tokens(
        current
            .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
            .filter(Value::is_object)
            .unwrap_or_else(|| Value::Object(serde_json::Map::new())),
        access_token,
        refresh_token,
        expires_at_ms,
        refreshed_at_ms,
    );

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
            constants::database::with_context("update Antigravity tokens", error),
        )
    })?;

    Ok(())
}

/// Writes the CloudCode project id resolved by `loadCodeAssist` (D5) into the
/// connection row, keeping every other credential key. The bootstrap runs once:
/// the executor sees the stored id on the next request.
pub async fn update_antigravity_project_id(
    database: &AppDatabase,
    id: &str,
    project_id: &str,
) -> Result<(), APIError> {
    let pool = database.sqlite_required(constants::database::PROVIDERS_UNSUPPORTED)?;

    let current = sqlx::query_scalar::<_, String>("SELECT credentials FROM providers WHERE id = ?")
        .bind(id)
        .fetch_optional(&pool)
        .await
        .map_err(|error| {
            APIError::new(
                500,
                constants::database::with_context("read the Antigravity credentials", error),
            )
        })?;

    let mut credentials = current
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
        .filter(Value::is_object)
        .unwrap_or_else(|| Value::Object(serde_json::Map::new()));
    credentials["project_id"] = Value::String(project_id.to_owned());

    sqlx::query("UPDATE providers SET credentials = ? WHERE id = ?")
        .bind(credentials.to_string())
        .bind(id)
        .execute(&pool)
        .await
        .map_err(|error| {
            APIError::new(
                500,
                constants::database::with_context("update the Antigravity project id", error),
            )
        })?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        AntigravityConnectionWrite, connection_credentials, merge_rotated_tokens,
        parse_antigravity_credentials,
    };

    #[test]
    fn parse_accepts_snake_case_credentials() {
        let raw = r#"{
            "access_token": "ya29.snake",
            "refresh_token": "1//snake",
            "expires_at": 1700000000000,
            "project_id": "snake-project"
        }"#;

        let credentials = parse_antigravity_credentials(raw).expect("snake credentials parse");

        assert_eq!(credentials.access_token, "ya29.snake");
        assert_eq!(credentials.refresh_token.as_deref(), Some("1//snake"));
        assert_eq!(credentials.expires_at, Some(1_700_000_000_000));
        assert_eq!(credentials.project_id.as_deref(), Some("snake-project"));
    }

    #[test]
    fn parse_accepts_camel_case_credentials() {
        let raw = r#"{
            "accessToken": "ya29.camel",
            "refreshToken": "1//camel",
            "tokenExpiresAt": 1700000000000,
            "projectId": "camel-project"
        }"#;

        let credentials = parse_antigravity_credentials(raw).expect("camel credentials parse");

        assert_eq!(credentials.access_token, "ya29.camel");
        assert_eq!(credentials.refresh_token.as_deref(), Some("1//camel"));
        assert_eq!(credentials.expires_at, Some(1_700_000_000_000));
        assert_eq!(credentials.project_id.as_deref(), Some("camel-project"));
    }

    #[test]
    fn parse_accepts_a_connection_without_optional_fields() {
        let credentials =
            parse_antigravity_credentials(r#"{"access_token": "AIzaSyKey"}"#).expect("parse");

        assert_eq!(credentials.access_token, "AIzaSyKey");
        assert_eq!(credentials.refresh_token, None);
        assert_eq!(credentials.expires_at, None);
        assert_eq!(credentials.project_id, None);
    }

    #[test]
    fn parse_rejects_a_missing_access_token() {
        assert!(parse_antigravity_credentials(r#"{"refresh_token": "1//only"}"#).is_none());
        assert!(parse_antigravity_credentials("not json").is_none());
    }

    /// A migrated Node row keeps `token_expires_at`; a refresh that wrote a second
    /// `expires_at` key must not shadow the canonical one.
    #[test]
    fn parse_reads_the_canonical_token_expires_at_key_when_both_are_present() {
        let raw = r#"{
            "access_token": "ya29.token",
            "token_expires_at": 1700000000000,
            "expires_at": 1800000000000
        }"#;

        let credentials = parse_antigravity_credentials(raw).expect("parse");

        assert_eq!(credentials.expires_at, Some(1_700_000_000_000));
    }

    #[test]
    fn writers_emit_the_canonical_token_expires_at_key() {
        let write = AntigravityConnectionWrite {
            id: "antigravity_1".to_owned(),
            name: "account@example.com".to_owned(),
            access_token: "ya29.fresh".to_owned(),
            refresh_token: Some("1//fresh".to_owned()),
            expires_at: Some(1_700_000_000_000),
            project_id: Some("project".to_owned()),
        };

        let fresh = connection_credentials(&write, 1_700_000_000_001);
        assert_eq!(fresh["token_expires_at"], 1_700_000_000_000_i64);
        assert!(fresh.get("expires_at").is_none());

        let migrated = serde_json::json!({
            "access_token": "ya29.stale",
            "token_expires_at": 1,
            "project_id": "project",
        });
        let rotated = merge_rotated_tokens(
            migrated,
            "ya29.fresh",
            "1//fresh",
            Some(1_700_000_000_000),
            1_700_000_000_001,
        );

        assert_eq!(rotated["token_expires_at"], 1_700_000_000_000_i64);
        assert!(rotated.get("expires_at").is_none());
        assert_eq!(rotated["project_id"], "project");
    }
}
