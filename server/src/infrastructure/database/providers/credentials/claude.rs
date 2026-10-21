//! Claude credential store: the Anthropic OAuth session behind `claude`.

use serde_json::Value;

use crate::clock::now_ms;
use crate::constants;
use crate::error::APIError;
use crate::infrastructure::database::AppDatabase;
use crate::infrastructure::database::row::text;

use super::{
    ConnectionRow, credential_string, merge_rotated_tokens, read_credentials, upsert_connection,
    write_credentials,
};

/// A stored Claude connection's usable credentials. It never enters a response
/// or a log line; it exists so the executor can sign one upstream request and
/// refresh it.
#[derive(Clone, Debug)]
pub struct ClaudeCredentials {
    /// The providers row id this connection lives under (the WHERE target for
    /// token updates, and the per-connection refresh-lock key).
    pub id: String,
    pub access_token: String,
    pub refresh_token: Option<String>,
    /// Milliseconds since the Unix epoch, `None` when the upstream never said.
    pub expires_at: Option<i64>,
    pub organization_id: Option<String>,
}

impl ClaudeCredentials {
    /// Whether the access token has already lapsed.
    pub fn is_expired(&self, now_ms: i64) -> bool {
        self.expires_at.is_some_and(|expiry| expiry <= now_ms)
    }
}

/// The connection row the auth routes write after a successful OAuth exchange
/// or token import.
#[derive(Clone, Debug)]
pub struct ClaudeConnectionWrite {
    pub id: String,
    /// What the Providers page shows: the account email, or a Claude fallback name.
    pub name: String,
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_at: Option<i64>,
    pub organization_id: Option<String>,
}

/// Loads the credentials of the newest enabled Claude connection. The camelCase
/// spellings are accepted as well so a row written by the Node build still reads.
pub async fn load_claude_credentials(
    database: &AppDatabase,
) -> Result<Option<ClaudeCredentials>, APIError> {
    let Some(pool) = database.sqlite_pool() else {
        return Ok(None);
    };

    let rows = sqlx::query(
        "SELECT id, credentials FROM providers \
         WHERE enabled = 1 AND (provider_id = 'claude' OR provider_id LIKE 'claude_%' \
            OR provider_id LIKE 'claude-%' OR id = 'claude' OR id LIKE 'claude_%' \
            OR id LIKE 'claude-%') \
         ORDER BY created_at DESC",
    )
    .fetch_all(&pool)
    .await
    .map_err(|error| {
        APIError::new(
            500,
            constants::database::with_context("read Claude credentials", error),
        )
    })?;

    for row in &rows {
        let raw = text(row, "credentials")?;

        if let Some(mut credentials) = parse_claude_credentials(&raw) {
            credentials.id = text(row, "id")?;
            return Ok(Some(credentials));
        }
    }

    Ok(None)
}

/// Parses a Claude credentials JSON row. Malformed JSON or a missing access
/// token yields `None`, which the executor reports as "not connected".
fn parse_claude_credentials(raw: &str) -> Option<ClaudeCredentials> {
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

    Some(ClaudeCredentials {
        id: String::new(),
        access_token: credential_string(object, &["access_token", "accessToken"])?,
        refresh_token: credential_string(object, &["refresh_token", "refreshToken"]),
        expires_at,
        organization_id: credential_string(object, &["organization_id", "organizationId"]),
    })
}

/// Builds the credentials JSON for a fresh connection. The canonical expiry key
/// is `token_expires_at` (the parser reads it first); a second `expires_at` key
/// would shadow a refreshed value on a migrated row.
fn connection_credentials(write: &ClaudeConnectionWrite, refreshed_at_ms: i64) -> Value {
    serde_json::json!({
        "access_token": write.access_token,
        "refresh_token": write.refresh_token,
        "token_expires_at": write.expires_at,
        "organization_id": write.organization_id,
        "last_refreshed_at": refreshed_at_ms,
    })
}

/// Writes or refreshes one Claude connection. The id is the primary key, so a
/// repeated callback for the same account updates the token in place.
pub async fn upsert_claude_connection(
    database: &AppDatabase,
    write: &ClaudeConnectionWrite,
) -> Result<(), APIError> {
    let credentials = connection_credentials(write, now_ms());

    upsert_connection(
        database,
        &ConnectionRow {
            id: &write.id,
            provider_id: "claude",
            name: &write.name,
            category: "oauth",
            protocol: "anthropic",
            base_url: None,
            credentials,
            action: constants::providers::claude::STORE_CONNECTION,
        },
    )
    .await
}

/// Writes the rotated token fields back into the Claude connection row, keeping
/// every credential the row already holds (the organization id above all).
pub async fn update_claude_tokens(
    database: &AppDatabase,
    id: &str,
    access_token: &str,
    refresh_token: &str,
    expires_at_ms: Option<i64>,
    refreshed_at_ms: i64,
) -> Result<(), APIError> {
    let current = read_credentials(database, id, "read the Claude credentials").await?;
    let credentials = merge_rotated_tokens(
        current,
        access_token,
        refresh_token,
        expires_at_ms,
        refreshed_at_ms,
    );
    write_credentials(database, id, &credentials, "update Claude tokens").await
}

#[cfg(test)]
mod tests {
    use super::{
        ClaudeConnectionWrite, connection_credentials, merge_rotated_tokens,
        parse_claude_credentials,
    };

    #[test]
    fn parse_accepts_snake_case_credentials() {
        let raw = r#"{
            "access_token": "sk-ant-oat01-snake",
            "refresh_token": "sk-ant-ort01-snake",
            "expires_at": 1700000000000,
            "organization_id": "org-snake"
        }"#;

        let credentials = parse_claude_credentials(raw).expect("snake credentials parse");

        assert_eq!(credentials.access_token, "sk-ant-oat01-snake");
        assert_eq!(
            credentials.refresh_token.as_deref(),
            Some("sk-ant-ort01-snake")
        );
        assert_eq!(credentials.expires_at, Some(1_700_000_000_000));
        assert_eq!(credentials.organization_id.as_deref(), Some("org-snake"));
    }

    #[test]
    fn parse_accepts_camel_case_credentials() {
        let raw = r#"{
            "accessToken": "sk-ant-oat01-camel",
            "refreshToken": "sk-ant-ort01-camel",
            "tokenExpiresAt": 1700000000000,
            "organizationId": "org-camel"
        }"#;

        let credentials = parse_claude_credentials(raw).expect("camel credentials parse");

        assert_eq!(credentials.access_token, "sk-ant-oat01-camel");
        assert_eq!(
            credentials.refresh_token.as_deref(),
            Some("sk-ant-ort01-camel")
        );
        assert_eq!(credentials.expires_at, Some(1_700_000_000_000));
        assert_eq!(credentials.organization_id.as_deref(), Some("org-camel"));
    }

    #[test]
    fn parse_rejects_a_missing_access_token() {
        assert!(parse_claude_credentials(r#"{"refresh_token": "only"}"#).is_none());
        assert!(parse_claude_credentials("not json").is_none());
    }

    #[test]
    fn parse_reads_the_canonical_token_expires_at_key_when_both_are_present() {
        let raw = r#"{
            "access_token": "sk-ant-oat01-token",
            "token_expires_at": 1700000000000,
            "expires_at": 1800000000000
        }"#;

        let credentials = parse_claude_credentials(raw).expect("parse");

        assert_eq!(credentials.expires_at, Some(1_700_000_000_000));
    }

    #[test]
    fn writers_emit_the_canonical_token_expires_at_key() {
        let write = ClaudeConnectionWrite {
            id: "claude_1".to_owned(),
            name: "account@example.com".to_owned(),
            access_token: "sk-ant-oat01-fresh".to_owned(),
            refresh_token: Some("sk-ant-ort01-fresh".to_owned()),
            expires_at: Some(1_700_000_000_000),
            organization_id: Some("org-1".to_owned()),
        };

        let fresh = connection_credentials(&write, 1_700_000_000_001);
        assert_eq!(fresh["token_expires_at"], 1_700_000_000_000_i64);
        assert!(fresh.get("expires_at").is_none());

        let migrated = serde_json::json!({
            "access_token": "sk-ant-oat01-stale",
            "token_expires_at": 1,
            "organization_id": "org-1",
        });
        let rotated = merge_rotated_tokens(
            migrated,
            "sk-ant-oat01-fresh",
            "sk-ant-ort01-fresh",
            Some(1_700_000_000_000),
            1_700_000_000_001,
        );

        assert_eq!(rotated["token_expires_at"], 1_700_000_000_000_i64);
        assert!(rotated.get("expires_at").is_none());
        assert_eq!(rotated["organization_id"], "org-1");
    }
}
