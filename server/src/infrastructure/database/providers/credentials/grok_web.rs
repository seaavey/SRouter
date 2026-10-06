//! Grok Web credential store: the `sso` session cookie of one account.

use serde_json::Value;

use crate::clock::now_ms;
use crate::constants;
use crate::error::APIError;
use crate::infrastructure::database::AppDatabase;
use crate::infrastructure::database::row::text;

use super::credential_string;

/// The connection row the Grok Web connect route writes after the cookie
/// probe succeeds.
#[derive(Clone, Debug)]
pub struct GrokWebConnectionWrite {
    pub id: String,
    pub name: String,
    /// The bare `sso` cookie value; the writer stores it under `api_key`
    /// because that is the field the Node `CreateProviderSchema` shape uses.
    pub sso: String,
}

/// Upserts a Grok Web connection. Reconnecting the same row replaces the
/// cookie and re-enables the driver.
pub async fn upsert_grok_web_connection(
    database: &AppDatabase,
    write: &GrokWebConnectionWrite,
) -> Result<(), APIError> {
    let pool = database.sqlite_required(constants::database::PROVIDERS_UNSUPPORTED)?;
    let credentials = serde_json::json!({
        "api_key": write.sso,
        "provider_specific_data": {
            "authMethod": "cookie",
        },
    });

    sqlx::query(
        "INSERT INTO providers
         (id, provider_id, name, category, protocol, enabled, credentials, meta, base_url, created_at)
         VALUES (?, 'grok-web', ?, 'api_key', 'openai', 1, ?, '{}', 'https://grok.com/', ?)
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
            constants::database::with_context("store the Grok Web connection", error),
        )
    })?;

    Ok(())
}

/// Loads the credentials of the newest enabled Grok Web connection.
pub async fn load_grok_web_credentials(
    database: &AppDatabase,
) -> Result<Option<GrokWebCredentials>, APIError> {
    let Some(pool) = database.sqlite_pool() else {
        return Ok(None);
    };

    let rows = sqlx::query(
        "SELECT id, credentials FROM providers
         WHERE provider_id = 'grok-web' AND enabled = 1
         ORDER BY created_at DESC
         LIMIT 1",
    )
    .fetch_all(&pool)
    .await
    .map_err(|error| {
        APIError::new(
            500,
            constants::database::with_context("read Grok Web credentials", error),
        )
    })?;

    for row in &rows {
        let raw = text(row, "credentials")?;

        if let Some(mut credentials) = parse_grok_web_credentials(&raw) {
            credentials.id = text(row, "id")?;
            return Ok(Some(credentials));
        }
    }

    Ok(None)
}

/// Parses a Grok Web credentials JSON row. The cookie lives under the Node
/// `CreateProviderSchema` field (`api_key`) and may be stored either as the
/// bare `sso` value or as a full `sso=<value>` pair; both spellings normalize
/// to the bare value. Malformed or empty JSON yields `None`.
fn parse_grok_web_credentials(raw: &str) -> Option<GrokWebCredentials> {
    let value: Value = serde_json::from_str(raw).ok()?;
    let object = value.as_object()?;

    let stored = credential_string(object, &["api_key", "apiKey", "sso"])?;
    let sso = stored
        .strip_prefix("sso=")
        .map(str::trim)
        .unwrap_or(stored.as_str());

    Some(GrokWebCredentials {
        id: String::new(),
        sso: sso.to_owned(),
    })
}

/// Credential store for Grok Web: the `sso` session cookie of one account.
#[derive(Clone, Debug, serde::Serialize)]
pub struct GrokWebCredentials {
    /// The providers row id this connection lives under.
    pub id: String,
    /// The bare `sso` cookie value — never the `sso=` prefixed form.
    pub sso: String,
}
