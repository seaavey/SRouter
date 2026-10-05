//! Cline credential store: the WorkOS device-flow session behind `cline`.

use serde_json::Value;

use crate::clock::now_ms;
use crate::constants;
use crate::error::APIError;
use crate::infrastructure::database::AppDatabase;
use crate::infrastructure::database::row::text;

use super::credential_string;

/// The connection row the auth routes write after a successful device flow.
#[derive(Clone, Debug)]
pub struct ClineConnectionWrite {
    pub id: String,
    pub name: String,
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub token_expires_at: Option<i64>,
    pub email: String,
}

/// Upserts a Cline connection. INSERT with ON CONFLICT for the primary key,
/// mirroring `upsert_qoder_connection`.
pub async fn upsert_cline_connection(
    database: &AppDatabase,
    write: &ClineConnectionWrite,
) -> Result<(), APIError> {
    let pool = database.sqlite_required(constants::database::PROVIDERS_UNSUPPORTED)?;
    let credentials = serde_json::json!({
        "access_token": write.access_token,
        "refresh_token": write.refresh_token,
        "token_expires_at": write.token_expires_at,
        "last_refreshed_at": now_ms(),
        "provider_specific_data": {
            "authMethod": "workos-device",
            "email": write.email,
        },
    });

    sqlx::query(
        "INSERT INTO providers
         (id, provider_id, name, category, protocol, enabled, credentials, meta, base_url, created_at)
         VALUES (?, 'cline', ?, 'oauth', 'openai', 1, ?, '{}', 'https://api.cline.bot/api/v1', ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name, credentials = excluded.credentials, enabled = 1",
    )
    .bind(&write.id)
    .bind(&write.name)
    .bind(credentials.to_string())
    .bind(now_ms())
    .execute(pool)
    .await
    .map_err(|error| {
        APIError::new(
            500,
            constants::database::with_context("store the Cline connection", error),
        )
    })?;

    Ok(())
}

/// Loads the credentials of the newest enabled Cline connection.
/// Accepts snake_case and camelCase aliases (plan D2).
pub async fn load_cline_credentials(
    database: &AppDatabase,
) -> Result<Option<ClineCredentials>, APIError> {
    let Some(pool) = database.sqlite_pool() else {
        return Ok(None);
    };

    let rows = sqlx::query(
        "SELECT id, credentials FROM providers
         WHERE provider_id = 'cline' AND enabled = 1
         ORDER BY created_at DESC
         LIMIT 1",
    )
    .fetch_all(pool)
    .await
    .map_err(|error| {
        APIError::new(
            500,
            constants::database::with_context("read Cline credentials", error),
        )
    })?;

    for row in &rows {
        let raw = text(row, "credentials")?;

        if let Some(mut credentials) = parse_cline_credentials(&raw) {
            credentials.id = text(row, "id")?;
            return Ok(Some(credentials));
        }
    }

    Ok(None)
}

/// Parses a Cline credentials JSON row, accepting snake_case and camelCase
/// spellings (plan D2). Malformed or empty JSON yields `None`.
fn parse_cline_credentials(raw: &str) -> Option<ClineCredentials> {
    let value: Value = serde_json::from_str(raw).ok()?;
    let object = value.as_object()?;

    let access_token = credential_string(object, &["access_token", "accessToken"])?;
    let refresh_token = credential_string(object, &["refresh_token", "refreshToken"]);
    let token_expires_at = object
        .get("token_expires_at")
        .or_else(|| object.get("expiresAt"))
        .and_then(|v| v.as_i64())
        .or_else(|| {
            object
                .get("tokenExpiresAt")
                .or_else(|| object.get("expiresAt"))
                .and_then(|v| v.as_i64())
        });

    let specific = object
        .get("provider_specific_data")
        .and_then(Value::as_object);
    let last_refreshed_at = specific
        .and_then(|data| {
            data.get("last_refreshed_at")
                .or_else(|| data.get("lastRefreshedAt"))
                .and_then(|v| v.as_i64())
        })
        .or_else(|| {
            object
                .get("last_refreshed_at")
                .or_else(|| object.get("lastRefreshedAt"))
                .and_then(|v| v.as_i64())
        });

    Some(ClineCredentials {
        id: String::new(),
        access_token,
        refresh_token,
        token_expires_at,
        last_refreshed_at,
    })
}

/// Writes the refreshed credential fields back into the providers row and
/// re-enables it. The row always exists here (its credentials were just read
/// to obtain the refresh token), so a plain UPDATE is correct: `ON CONFLICT`
/// is only valid on INSERT and SQLite rejects it on UPDATE.
pub async fn update_cline_tokens(
    database: &AppDatabase,
    id: &str,
    access: &str,
    refresh: &str,
    expires_at_ms: Option<i64>,
    refreshed_at_ms: i64,
) -> Result<(), APIError> {
    let pool = database.sqlite_required(constants::database::PROVIDERS_UNSUPPORTED)?;

    let credentials = serde_json::json!({
        "access_token": access,
        "refresh_token": refresh,
        "token_expires_at": expires_at_ms,
        "last_refreshed_at": refreshed_at_ms,
        "provider_specific_data": {
            "authMethod": "workos-device",
        },
    });

    sqlx::query(
        "UPDATE providers
         SET credentials = ?, enabled = 1
         WHERE id = ?",
    )
    .bind(credentials.to_string())
    .bind(id)
    .execute(pool)
    .await
    .map_err(|error| {
        APIError::new(
            500,
            constants::database::with_context("update Cline tokens", error),
        )
    })?;

    Ok(())
}

/// Credential store for Cline: access token, refresh token, and timestamps.
#[derive(Clone, Debug, serde::Serialize)]
pub struct ClineCredentials {
    /// The providers row id this connection lives under (the WHERE target for token updates).
    pub id: String,
    pub access_token: String,
    pub refresh_token: Option<String>,
    /// Milliseconds since the Unix epoch, `None` when the upstream never said.
    pub token_expires_at: Option<i64>,
    pub last_refreshed_at: Option<i64>,
}

impl ClineCredentials {
    /// Whether the device token has already lapsed.
    pub fn is_expired(&self, now_ms: i64) -> bool {
        self.token_expires_at.is_some_and(|expiry| expiry <= now_ms)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_cline_credentials_snake_case() {
        let raw = r#"{
            "access_token": "workos:token-abc123",
            "refresh_token": "workos:ref-abc123",
            "token_expires_at": 1700000000000,
            "last_refreshed_at": 1700000000000,
            "provider_specific_data": {"authMethod": "workos-device", "email": "user@example.com"}
        }"#;

        let credentials =
            parse_cline_credentials(raw).expect("should parse snake_case credentials");
        assert_eq!(credentials.access_token, "workos:token-abc123");
        assert_eq!(
            credentials.refresh_token,
            Some("workos:ref-abc123".to_string())
        );
        assert_eq!(credentials.token_expires_at, Some(1700000000000));
        assert_eq!(credentials.last_refreshed_at, Some(1700000000000));
    }

    #[test]
    fn parse_cline_credentials_camel_case() {
        let raw = r#"{
            "accessToken": "workos:token-abc123",
            "refreshToken": "workos:ref-abc123",
            "expiresAt": 1700000000000,
            "lastRefreshedAt": 1700000000000,
            "provider_specific_data": {"authMethod": "workos-device", "email": "user@example.com"}
        }"#;

        let credentials = parse_cline_credentials(raw).expect("should parse camelCase credentials");
        assert_eq!(credentials.access_token, "workos:token-abc123");
        assert_eq!(
            credentials.refresh_token,
            Some("workos:ref-abc123".to_string())
        );
        assert_eq!(credentials.token_expires_at, Some(1700000000000));
        assert_eq!(credentials.last_refreshed_at, Some(1700000000000));
    }

    #[test]
    fn parse_cline_credentials_malformed_yields_none() {
        let raw = r#"not json"#;

        let credentials = parse_cline_credentials(raw);
        assert!(credentials.is_none(), "malformed JSON should yield None");
    }

    #[test]
    fn parse_cline_credentials_empty_string_yields_none() {
        let raw = r#""#;

        let credentials = parse_cline_credentials(raw);
        assert!(credentials.is_none(), "empty string should yield None");
    }

    #[test]
    fn cline_credentials_is_expired() {
        let credentials = ClineCredentials {
            id: "cline-account".to_owned(),
            access_token: "workos:token".to_string(),
            refresh_token: None,
            token_expires_at: Some(1000),
            last_refreshed_at: None,
        };
        // expired: stored expiry <= now
        assert!(credentials.is_expired(1000));
        // not expired: stored expiry > now
        assert!(!credentials.is_expired(999));
        // no expiry: never expired
        assert!(!credentials.is_expired(0));
    }

    #[test]
    fn cline_credentials_round_trip() {
        let credentials = ClineCredentials {
            id: "cline-account".to_owned(),
            access_token: "workos:token-xyz".to_string(),
            refresh_token: Some("workos:ref-xyz".to_string()),
            token_expires_at: Some(2000000000000),
            last_refreshed_at: Some(1000000000000),
        };

        let json = serde_json::to_string(&credentials).expect("should serialize");
        let roundtripped = parse_cline_credentials(&json).expect("should parse round-trip");

        assert_eq!(roundtripped.access_token, credentials.access_token);
        assert_eq!(roundtripped.refresh_token, credentials.refresh_token);
        assert_eq!(roundtripped.token_expires_at, credentials.token_expires_at);
        assert_eq!(
            roundtripped.last_refreshed_at,
            credentials.last_refreshed_at
        );
    }
}
