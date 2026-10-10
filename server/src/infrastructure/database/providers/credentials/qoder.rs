//! Qoder credential store: the device-flow session behind `qoder`.

use serde_json::Value;

use crate::clock::now_ms;
use crate::constants;
use crate::error::APIError;
use crate::infrastructure::database::AppDatabase;
use crate::infrastructure::database::row::text;

use super::credential_string;

/// A stored Qoder connection's usable credentials. It never enters a response or
/// a log line; it exists so the executor can sign one upstream request.
#[derive(Clone, Debug)]
pub struct QoderCredentials {
    /// The `providers` row id this connection lives under.
    pub id: String,
    pub access_token: String,
    pub refresh_token: Option<String>,
    /// Milliseconds since the Unix epoch, `None` when the upstream never said.
    pub token_expires_at: Option<i64>,
    pub user_id: String,
    pub name: String,
    pub email: String,
}

impl QoderCredentials {
    /// Whether the device token has already lapsed.
    pub fn is_expired(&self, now_ms: i64) -> bool {
        self.token_expires_at.is_some_and(|expiry| expiry <= now_ms)
    }
}

/// The connection row the auth routes write after a successful device flow.
#[derive(Clone, Debug)]
pub struct QoderConnectionWrite {
    pub id: String,
    /// What the Providers page shows: `Qoder (<account name>)`.
    pub name: String,
    /// The upstream account name, carried in the COSY identity block.
    pub account_name: String,
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub token_expires_at: Option<i64>,
    pub user_id: String,
    pub email: String,
    pub organization_id: String,
}

/// Loads the credentials of every enabled Qoder connection, newest first. This
/// build writes the JSON layout; the camelCase spellings are accepted as well so
/// a row written by the Node build still reads (plan decision D2).
pub async fn load_qoder_credentials(
    database: &AppDatabase,
) -> Result<Vec<QoderCredentials>, APIError> {
    let Some(pool) = database.sqlite_pool() else {
        return Ok(Vec::new());
    };

    let rows = sqlx::query(
        "SELECT id, credentials FROM providers \
         WHERE (provider_id = 'qoder' OR provider_id LIKE 'qoder_%' OR provider_id LIKE 'qoder-%' \
            OR id = 'qoder' OR id LIKE 'qoder_%' OR id LIKE 'qoder-%') \
           AND enabled = 1 \
         ORDER BY created_at DESC",
    )
    .fetch_all(&pool)
    .await
    .map_err(|error| {
        APIError::new(
            500,
            constants::database::with_context("read Qoder credentials", error),
        )
    })?;

    let mut connections = Vec::with_capacity(rows.len());
    for row in &rows {
        let raw = text(row, "credentials")?;

        if let Some(mut credentials) = parse_qoder_credentials(&raw) {
            credentials.id = text(row, "id")?;
            connections.push(credentials);
        }
    }

    Ok(connections)
}

/// Writes or refreshes one Qoder connection. The id is the primary key, so a
/// repeated callback for the same account updates the token in place.
pub async fn upsert_qoder_connection(
    database: &AppDatabase,
    write: &QoderConnectionWrite,
) -> Result<(), APIError> {
    let pool = database.sqlite_required(constants::database::PROVIDERS_UNSUPPORTED)?;
    let credentials = serde_json::json!({
        "access_token": write.access_token,
        "refresh_token": write.refresh_token,
        "token_expires_at": write.token_expires_at,
        "last_refreshed_at": now_ms(),
        "provider_specific_data": {
            "authMethod": "device",
            "userId": write.user_id,
            "email": write.email,
            "name": write.account_name,
            "organizationId": write.organization_id,
        },
    });

    sqlx::query(
        "INSERT INTO providers \
         (id, provider_id, name, category, protocol, enabled, credentials, meta, created_at) \
         VALUES (?, 'qoder', ?, 'oauth', 'openai', 1, ?, '{}', ?) \
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
            constants::database::with_context("store the Qoder connection", error),
        )
    })?;

    Ok(())
}

fn parse_qoder_credentials(raw: &str) -> Option<QoderCredentials> {
    let value: Value = serde_json::from_str(raw).ok()?;
    let object = value.as_object()?;

    let access_token = credential_string(object, &["access_token", "accessToken"])?;
    let refresh_token = credential_string(object, &["refresh_token", "refreshToken"]);
    let token_expires_at = [
        "token_expires_at",
        "tokenExpiresAt",
        "expires_at",
        "expiresAt",
    ]
    .iter()
    .find_map(|key| object.get(*key).and_then(Value::as_i64));

    let specific = object
        .get("provider_specific_data")
        .and_then(Value::as_object);
    let user_id = specific
        .and_then(|data| credential_string(data, &["userId", "user_id", "id"]))
        .or_else(|| credential_string(object, &["user_id", "userId", "id"]))
        .unwrap_or_default();
    let name = specific
        .and_then(|data| credential_string(data, &["name", "username"]))
        .or_else(|| credential_string(object, &["name", "username"]))
        .unwrap_or_default();
    let email = specific
        .and_then(|data| credential_string(data, &["email"]))
        .or_else(|| credential_string(object, &["email"]))
        .unwrap_or_default();

    Some(QoderCredentials {
        id: String::new(),
        access_token,
        refresh_token,
        token_expires_at,
        user_id,
        name,
        email,
    })
}
