//! OpenCode Console credential store and types.

use serde_json::Value;

use crate::clock::now_ms;
use crate::constants;
use crate::error::APIError;
use crate::infrastructure::database::AppDatabase;
use crate::infrastructure::database::row::text;

use super::{ConnectionRow, credential_string, upsert_connection, write_credentials};

/// The connection row the auth routes write after a successful device flow.
#[derive(Clone, Debug)]
pub struct OpenCodeConnectionWrite {
    pub id: String,
    pub name: String,
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub token_expires_at: Option<i64>,
    pub org_id: Option<String>,
    pub org_name: Option<String>,
    pub email: Option<String>,
}

/// Upserts an OpenCode connection.
pub async fn upsert_opencode_connection(
    database: &AppDatabase,
    write: &OpenCodeConnectionWrite,
) -> Result<(), APIError> {
    let credentials = serde_json::json!({
        "access_token": write.access_token,
        "refresh_token": write.refresh_token,
        "token_expires_at": write.token_expires_at,
        "last_refreshed_at": now_ms(),
        "provider_specific_data": {
            "authMethod": "device",
            "org_id": write.org_id,
            "org_name": write.org_name,
            "email": write.email,
        },
    });

    upsert_connection(
        database,
        &ConnectionRow {
            id: &write.id,
            provider_id: "opencode_zen",
            name: &write.name,
            category: "oauth",
            protocol: "openai",
            base_url: Some("https://opencode.ai/inference/v1"),
            credentials,
            action: constants::providers::opencode::STORE_CONNECTION,
        },
    )
    .await
}

/// Loads the credentials of every enabled OpenCode connection, newest first.
pub async fn load_opencode_credentials(
    database: &AppDatabase,
) -> Result<Vec<OpenCodeCredentials>, APIError> {
    let Some(pool) = database.sqlite_pool() else {
        return Ok(Vec::new());
    };

    let rows = sqlx::query(
        "SELECT id, credentials FROM providers
         WHERE (provider_id = 'opencode_zen' OR provider_id = 'opencode') AND enabled = 1
         ORDER BY created_at DESC",
    )
    .fetch_all(&pool)
    .await
    .map_err(|error| {
        APIError::new(
            500,
            constants::database::with_context("read OpenCode credentials", error),
        )
    })?;

    let mut connections = Vec::with_capacity(rows.len());
    for row in &rows {
        let raw = text(row, "credentials")?;
        if let Some(mut parsed) = parse_opencode_credentials(&raw) {
            parsed.id = text(row, "id")?;
            connections.push(parsed);
        }
    }

    Ok(connections)
}

/// The stored OpenCode connection credentials.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub struct OpenCodeCredentials {
    #[serde(default)]
    pub id: String,
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub token_expires_at: Option<i64>,
    pub last_refreshed_at: Option<i64>,
    pub org_id: Option<String>,
}

impl OpenCodeCredentials {
    pub fn is_expired(&self, now: i64) -> bool {
        self.token_expires_at
            .is_some_and(|expires_at| expires_at <= now)
    }
}

/// Parses an OpenCode credentials JSON blob.
pub fn parse_opencode_credentials(raw: &str) -> Option<OpenCodeCredentials> {
    let value: Value = serde_json::from_str(raw).ok()?;
    let object = value.as_object()?;

    let access_token = credential_string(object, &["access_token", "accessToken"])?;
    let refresh_token = credential_string(object, &["refresh_token", "refreshToken"]);

    let token_expires_at = object
        .get("token_expires_at")
        .or_else(|| object.get("tokenExpiresAt"))
        .or_else(|| object.get("expiresAt"))
        .and_then(Value::as_i64);

    let specific = object
        .get("provider_specific_data")
        .or_else(|| object.get("providerSpecificData"))
        .and_then(Value::as_object);

    let last_refreshed_at = specific
        .and_then(|data| {
            data.get("last_refreshed_at")
                .or_else(|| data.get("lastRefreshedAt"))
                .and_then(Value::as_i64)
        })
        .or_else(|| {
            object
                .get("last_refreshed_at")
                .or_else(|| object.get("lastRefreshedAt"))
                .and_then(Value::as_i64)
        });

    let org_id = specific
        .and_then(|data| credential_string(data, &["org_id", "orgId"]))
        .or_else(|| credential_string(object, &["org_id", "orgId"]));

    Some(OpenCodeCredentials {
        id: String::new(),
        access_token,
        refresh_token,
        token_expires_at,
        last_refreshed_at,
        org_id,
    })
}

/// Rewrites the tokens on one OpenCode connection row.
pub async fn update_opencode_tokens(
    database: &AppDatabase,
    id: &str,
    access_token: &str,
    refresh_token: Option<&str>,
    expires_at: Option<i64>,
    org_id: Option<&str>,
) -> Result<(), APIError> {
    let credentials = serde_json::json!({
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_expires_at": expires_at,
        "last_refreshed_at": now_ms(),
        "provider_specific_data": {
            "authMethod": "device",
            "org_id": org_id,
        },
    });

    write_credentials(
        database,
        id,
        &credentials,
        constants::providers::opencode::STORE_CONNECTION,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opencode_credentials_expiry_respects_the_clock() {
        let credentials = OpenCodeCredentials {
            id: "conn-1".to_owned(),
            access_token: "st_xyz".to_owned(),
            refresh_token: Some("rt_xyz".to_owned()),
            token_expires_at: Some(1000),
            last_refreshed_at: Some(500),
            org_id: Some("org_123".to_owned()),
        };
        assert!(credentials.is_expired(1000));
        assert!(!credentials.is_expired(999));
        assert!(credentials.is_expired(1001));
    }

    #[test]
    fn opencode_credentials_round_trip() {
        let credentials = OpenCodeCredentials {
            id: "conn-1".to_owned(),
            access_token: "st_12345".to_owned(),
            refresh_token: Some("rt_67890".to_owned()),
            token_expires_at: Some(2000000000000),
            last_refreshed_at: Some(1000000000000),
            org_id: Some("org_abc".to_owned()),
        };

        let raw = serde_json::json!({
            "access_token": credentials.access_token,
            "refresh_token": credentials.refresh_token,
            "token_expires_at": credentials.token_expires_at,
            "last_refreshed_at": credentials.last_refreshed_at,
            "provider_specific_data": {
                "org_id": credentials.org_id
            }
        })
        .to_string();

        let parsed = parse_opencode_credentials(&raw).expect("should parse");
        assert_eq!(parsed.access_token, credentials.access_token);
        assert_eq!(parsed.refresh_token, credentials.refresh_token);
        assert_eq!(parsed.token_expires_at, credentials.token_expires_at);
        assert_eq!(parsed.last_refreshed_at, credentials.last_refreshed_at);
        assert_eq!(parsed.org_id, credentials.org_id);
    }
}
