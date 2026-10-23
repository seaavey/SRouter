//! Per-driver credential stores behind the provider catalog. Each driver owns
//! one module with its credential shape, its parser, and the load/upsert/update
//! queries that read and write the `providers.credentials` column.

mod antigravity;
mod claude;
mod cline;
mod codebuddy;
mod codex;
mod commandcode;
mod custom;
mod grok_web;
mod qoder;

use serde_json::Value;

use crate::clock::now_ms;
use crate::constants;
use crate::error::APIError;
use crate::infrastructure::database::AppDatabase;
use crate::infrastructure::database::row::text;

pub use antigravity::{
    AntigravityConnectionWrite, AntigravityCredentials, load_antigravity_credentials,
    update_antigravity_project_id, update_antigravity_tokens, upsert_antigravity_connection,
};
pub use claude::{
    ClaudeConnectionWrite, ClaudeCredentials, load_claude_credentials, update_claude_tokens,
    upsert_claude_connection,
};
pub use cline::{
    ClineConnectionWrite, ClineCredentials, load_cline_credentials, update_cline_tokens,
    upsert_cline_connection,
};
pub use codebuddy::{
    CodeBuddyConnectionWrite, CodeBuddyCredentials, load_codebuddy_credentials,
    upsert_codebuddy_connection,
};
pub use codex::{
    CodexConnectionWrite, CodexCredentials, load_codex_credentials, update_codex_tokens,
    upsert_codex_connection,
};
pub use commandcode::{
    CommandCodeConnectionWrite, CommandCodeCredentials, load_commandcode_credentials,
    upsert_commandcode_connection,
};
pub use custom::{CustomCredentials, load_custom_credentials};
pub use grok_web::{
    GrokWebConnectionWrite, GrokWebCredentials, load_grok_web_credentials,
    upsert_grok_web_connection,
};
pub use qoder::{
    QoderConnectionWrite, QoderCredentials, load_qoder_credentials, upsert_qoder_connection,
};

/// The identity keys a credential names its account under, most specific first:
/// an explicit user or account id, then the account email.
const ACCOUNT_IDENTITY_KEYS: &[&str] = &["userId", "user_id", "accountId", "account_id", "email"];

/// The keys a credential states its access-token expiry under. Every driver
/// writes the canonical `token_expires_at`; the rest are the spellings the Node
/// build left behind.
const TOKEN_EXPIRY_KEYS: &[&str] = &[
    "token_expires_at",
    "tokenExpiresAt",
    "expires_at",
    "expiresAt",
];

/// What the account check reads from a stored connection: the account the
/// credential was issued to, and when its access token stops working.
#[derive(Clone, Debug)]
pub struct ConnectionAccount {
    /// The providers row id this account lives under.
    pub id: String,
    /// The account id or email the credential names. `None` when the store names
    /// none—every driver that only records a token.
    pub identity: Option<String>,
    /// Milliseconds since the Unix epoch, `None` when the upstream never said.
    pub expires_at: Option<i64>,
}

/// Reads the account behind every stored row, newest first. The credential blob
/// is parsed here and dropped: only the identity key and the expiry leave, so no
/// token can reach a response.
pub async fn load_connection_accounts(
    database: &AppDatabase,
) -> Result<Vec<ConnectionAccount>, APIError> {
    let Some(pool) = database.sqlite_pool() else {
        return Ok(Vec::new());
    };

    let rows = sqlx::query("SELECT id, credentials FROM providers ORDER BY created_at DESC")
        .fetch_all(&pool)
        .await
        .map_err(|error| {
            APIError::new(
                500,
                constants::database::with_context("read provider credentials", error),
            )
        })?;

    let mut accounts = Vec::with_capacity(rows.len());
    for row in &rows {
        let Some(object) = serde_json::from_str::<Value>(&text(row, "credentials")?)
            .ok()
            .and_then(|value| value.as_object().cloned())
        else {
            continue;
        };

        accounts.push(ConnectionAccount {
            id: text(row, "id")?,
            identity: account_identity(&object),
            expires_at: account_expiry_ms(&object),
        });
    }

    Ok(accounts)
}

/// The account a credential belongs to, lowercased so two spellings of one
/// address match. `None` when the store names no account.
///
/// The row label is deliberately not a fallback: `grok-web` labels every one of
/// its accounts "Grok Web", so a label match would report unrelated accounts as
/// the same one.
fn account_identity(object: &serde_json::Map<String, Value>) -> Option<String> {
    // The device flows tuck the identity into `provider_specific_data`
    // (`qoder`.`userId`, `cline`.`email`); `codex` keeps `account_id` on top.
    object
        .get("provider_specific_data")
        .and_then(Value::as_object)
        .and_then(|data| credential_string(data, ACCOUNT_IDENTITY_KEYS))
        .or_else(|| credential_string(object, ACCOUNT_IDENTITY_KEYS))
        .map(|identity| identity.to_lowercase())
}

/// When a stored access token stops working, under any spelling.
fn account_expiry_ms(object: &serde_json::Map<String, Value>) -> Option<i64> {
    TOKEN_EXPIRY_KEYS
        .iter()
        .find_map(|key| object.get(*key).and_then(Value::as_i64))
}

/// Reads one credential field under either spelling. Empty strings count as
/// missing, so a token that was cleared cannot be mistaken for a stored one.
pub(super) fn credential_string(
    object: &serde_json::Map<String, Value>,
    keys: &[&str],
) -> Option<String> {
    keys.iter()
        .find_map(|key| object.get(*key).and_then(Value::as_str))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

/// Merges rotated tokens into an existing credentials object, preserving every
/// other key (a driver's organization or project id above all). Writes the
/// canonical `token_expires_at` so a migrated row's stale value is overwritten
/// rather than shadowed.
pub(super) fn merge_rotated_tokens(
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

/// Reads one provider's credential blob for a read-merge-write update. A row
/// that is missing or unparseable reads as an empty object, so a refresh still
/// stores the new tokens.
pub(super) async fn read_credentials(
    database: &AppDatabase,
    id: &str,
    action: &str,
) -> Result<Value, APIError> {
    let pool = database.sqlite_required(constants::database::PROVIDERS_UNSUPPORTED)?;
    let current = sqlx::query_scalar::<_, String>("SELECT credentials FROM providers WHERE id = ?")
        .bind(id)
        .fetch_optional(&pool)
        .await
        .map_err(|error| APIError::new(500, constants::database::with_context(action, &error)))?;

    Ok(current
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
        .filter(Value::is_object)
        .unwrap_or_else(|| Value::Object(serde_json::Map::new())))
}

/// Stores a provider's credential blob and re-enables the row.
pub(super) async fn write_credentials(
    database: &AppDatabase,
    id: &str,
    credentials: &Value,
    action: &str,
) -> Result<(), APIError> {
    let pool = database.sqlite_required(constants::database::PROVIDERS_UNSUPPORTED)?;

    sqlx::query(
        "UPDATE providers
         SET credentials = ?, enabled = 1
         WHERE id = ?",
    )
    .bind(credentials.to_string())
    .bind(id)
    .execute(&pool)
    .await
    .map_err(|error| APIError::new(500, constants::database::with_context(action, &error)))?;

    Ok(())
}

/// The row a driver writes when it stores a connection.
pub(super) struct ConnectionRow<'a> {
    pub id: &'a str,
    pub provider_id: &'a str,
    pub name: &'a str,
    pub category: &'a str,
    pub protocol: &'a str,
    /// The upstream base URL, when the driver has one.
    pub base_url: Option<&'a str>,
    /// The credential blob, already shaped by the driver.
    pub credentials: Value,
    /// The action the error message names. It is per driver because the message
    /// is client-visible.
    pub action: &'a str,
}

/// Writes or replaces one connection row. The id is the primary key, so a
/// repeated callback for the same account updates the row in place.
pub(super) async fn upsert_connection(
    database: &AppDatabase,
    row: &ConnectionRow<'_>,
) -> Result<(), APIError> {
    let pool = database.sqlite_required(constants::database::PROVIDERS_UNSUPPORTED)?;

    sqlx::query(
        "INSERT INTO providers
         (id, provider_id, name, category, protocol, enabled, credentials, meta, base_url, created_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, '{}', ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name, credentials = excluded.credentials, enabled = 1",
    )
    .bind(row.id)
    .bind(row.provider_id)
    .bind(row.name)
    .bind(row.category)
    .bind(row.protocol)
    .bind(row.credentials.to_string())
    .bind(row.base_url)
    .bind(now_ms())
    .execute(&pool)
    .await
    .map_err(|error| {
        APIError::new(
            500,
            constants::database::with_context(row.action, error),
        )
    })?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use serde_json::{Value, json};

    use super::{account_expiry_ms, account_identity, merge_rotated_tokens};

    fn object(value: Value) -> serde_json::Map<String, Value> {
        value.as_object().cloned().expect("an object literal")
    }

    #[test]
    fn merge_preserves_unknown_credentials() {
        let merged = merge_rotated_tokens(
            json!({"organization_id": "org-1", "access_token": "old"}),
            "new-access",
            "new-refresh",
            Some(1_700_000_000_000),
            1_700_000_000_001,
        );

        assert_eq!(merged["organization_id"], "org-1");
        assert_eq!(merged["access_token"], "new-access");
        assert_eq!(merged["refresh_token"], "new-refresh");
        assert_eq!(merged["token_expires_at"], 1_700_000_000_000_i64);
        assert_eq!(merged["last_refreshed_at"], 1_700_000_000_001_i64);
    }

    #[test]
    fn the_identity_prefers_the_user_id_over_the_email() {
        let identity = account_identity(&object(json!({
            "email": "person@example.com",
            "provider_specific_data": {"userId": "user-1"},
        })));

        assert_eq!(identity.as_deref(), Some("user-1"));
    }

    #[test]
    fn the_identity_folds_the_address_case() {
        let identity = account_identity(&object(
            json!({"provider_specific_data": {"email": "Person@Example.com"}}),
        ));

        assert_eq!(identity.as_deref(), Some("person@example.com"));
    }

    #[test]
    fn a_credential_that_names_no_account_has_no_identity() {
        assert!(account_identity(&object(json!({"api_key": "sk-test"}))).is_none());
        assert!(account_identity(&object(json!({}))).is_none());
    }

    #[test]
    fn the_expiry_reads_the_canonical_key_first() {
        assert_eq!(
            account_expiry_ms(&object(json!({
                "token_expires_at": 1_700_000_000_000_i64,
                "expires_at": 1_800_000_000_000_i64,
            }))),
            Some(1_700_000_000_000)
        );
        assert_eq!(account_expiry_ms(&object(json!({"expiresAt": 5}))), Some(5));
        assert_eq!(
            account_expiry_ms(&object(json!({"api_key": "sk-test"}))),
            None
        );
    }
}
