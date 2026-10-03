//! Provider connection store behind the provider catalog. Only management
//! columns are read: `credentials` never leaves the database.

use serde_json::Value;
use sqlx::{Row, Sqlite, SqlitePool, Transaction, sqlite::SqliteRow};

use crate::clock::now_ms;
use crate::constants;
use crate::error::APIError;
use crate::infrastructure::database::AppDatabase;

/// Prefix of the settings keys holding a provider's enabled flag.
pub(crate) const PROVIDER_ENABLED_PREFIX: &str = "provider_enabled_";

/// A stored provider connection, without any secret material.
#[derive(Clone, Debug)]
pub struct ProviderConnection {
    pub id: String,
    pub provider_id: String,
    pub name: String,
    pub alias: Option<String>,
    pub category: String,
    pub protocol: String,
    pub base_url: Option<String>,
    pub enabled: bool,
    pub created_at: i64,
}

impl ProviderConnection {
    /// Whether this connection belongs to `base_id`. Mirrors Node's
    /// `BaseIdOf(providerId || id)`: the driver id is either the base id
    /// itself or a `<base>_`/`<base>-` namespaced variant.
    pub fn base_id_is(&self, base_id: &str) -> bool {
        let driver = if self.provider_id.is_empty() {
            self.id.as_str()
        } else {
            self.provider_id.as_str()
        };

        matches_base_id(driver, base_id)
    }
}

/// Node's `BaseIdOf` test: the base id itself, or a `<base>_`/`<base>-`
/// namespaced variant of it.
pub(crate) fn matches_base_id(driver: &str, base_id: &str) -> bool {
    driver == base_id
        || driver.starts_with(&format!("{base_id}_"))
        || driver.starts_with(&format!("{base_id}-"))
}

/// Lists stored connections, newest first, with seed driver rows excluded.
/// PostgreSQL has no query carrier yet, so it reports no connections instead of
/// failing the request.
pub async fn list_connections(database: &AppDatabase) -> Result<Vec<ProviderConnection>, APIError> {
    let Some(pool) = database.sqlite_pool() else {
        return Ok(Vec::new());
    };

    let rows = sqlx::query(
        "SELECT id, provider_id, name, alias, category, protocol, base_url, enabled, meta, created_at \
         FROM providers ORDER BY created_at DESC",
    )
    .fetch_all(pool)
    .await
    .map_err(|error| {
        APIError::new(
            500,
            constants::database::could_not_read_provider_connections(&error),
        )
    })?;

    let mut connections = Vec::with_capacity(rows.len());
    for row in &rows {
        // Seed rows describe drivers, not connections, and would otherwise be
        // counted as a live provider.
        if is_seed_row(optional_text(row, "meta")?.as_deref()) {
            continue;
        }

        connections.push(ProviderConnection {
            id: text(row, "id")?,
            provider_id: text(row, "provider_id")?,
            name: text(row, "name")?,
            alias: optional_text(row, "alias")?,
            category: text(row, "category")?,
            protocol: text(row, "protocol")?,
            base_url: optional_text(row, "base_url")?,
            enabled: integer(row, "enabled")? != 0,
            created_at: integer(row, "created_at")?,
        });
    }

    Ok(connections)
}

/// Whether any stored row—seed or connection—is driven by `base_id`. Node's
/// existence check counts seed rows too, so this one skips the seed filter.
pub async fn provider_exists(database: &AppDatabase, base_id: &str) -> Result<bool, APIError> {
    let Some(pool) = database.sqlite_pool() else {
        return Ok(false);
    };

    let rows = sqlx::query("SELECT id, provider_id FROM providers")
        .fetch_all(pool)
        .await
        .map_err(|error| {
            APIError::new(
                500,
                constants::database::could_not_read_provider_connections(&error),
            )
        })?;

    for row in &rows {
        let provider_id = text(row, "provider_id")?;
        let driver = if provider_id.is_empty() {
            text(row, "id")?
        } else {
            provider_id
        };

        if matches_base_id(&driver, base_id) {
            return Ok(true);
        }
    }

    Ok(false)
}

/// Whether a provider is enabled. A missing row—or any value other than
/// `"false"`—reads as enabled, matching Node's default-true setting.
pub async fn provider_enabled(database: &AppDatabase, base_id: &str) -> Result<bool, APIError> {
    let Some(pool) = database.sqlite_pool() else {
        return Ok(true);
    };

    let value = sqlx::query_scalar::<_, String>("SELECT value FROM settings WHERE key = ?")
        .bind(enabled_key(base_id))
        .fetch_optional(pool)
        .await
        .map_err(|error| {
            APIError::new(
                500,
                constants::database::could_not_read_provider_flag(&error),
            )
        })?;

    Ok(value.as_deref() != Some("false"))
}

/// The edits one `PATCH /v1/providers/{provider_id}` carries. Each list holds
/// the model ids the request wants in that state, so an empty list changes
/// nothing.
#[derive(Debug, Default)]
pub struct ProviderPatch {
    pub enabled: Option<bool>,
    pub hidden: Vec<String>,
    pub restored: Vec<String>,
    pub favorited: Vec<String>,
    pub unfavorited: Vec<String>,
}

impl ProviderPatch {
    /// Whether the patch asks for any change at all.
    pub fn is_empty(&self) -> bool {
        self.enabled.is_none()
            && self.hidden.is_empty()
            && self.restored.is_empty()
            && self.favorited.is_empty()
            && self.unfavorited.is_empty()
    }
}

/// Applies every edit of a patch in one transaction, so a statement that fails
/// never leaves the provider half updated. The lists run in field order (hide,
/// restore, favorite, unfavorite), so a model named by two lists ends up in the
/// state of the last one that mentions it.
pub async fn apply_provider_patch(
    database: &AppDatabase,
    base_id: &str,
    patch: &ProviderPatch,
) -> Result<(), APIError> {
    let pool = write_pool(database)?;
    let mut transaction = pool.begin().await.map_err(|error| {
        APIError::new(
            500,
            constants::database::could_not_start_provider_update(&error),
        )
    })?;

    if let Some(enabled) = patch.enabled {
        set_enabled_flag(&mut transaction, base_id, enabled).await?;
    }
    for model_id in &patch.hidden {
        hide_model(&mut transaction, base_id, model_id).await?;
    }
    for model_id in &patch.restored {
        restore_model(&mut transaction, base_id, model_id).await?;
    }
    for model_id in &patch.favorited {
        favorite_model(&mut transaction, model_id).await?;
    }
    for model_id in &patch.unfavorited {
        unfavorite_model(&mut transaction, model_id).await?;
    }

    transaction.commit().await.map_err(|error| {
        APIError::new(
            500,
            constants::database::could_not_commit_provider_update(&error),
        )
    })
}

/// Upserts the enabled flag of one provider driver.
async fn set_enabled_flag(
    transaction: &mut Transaction<'_, Sqlite>,
    base_id: &str,
    enabled: bool,
) -> Result<(), APIError> {
    sqlx::query(
        "INSERT INTO settings (key, value) VALUES (?, ?) \
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind(enabled_key(base_id))
    .bind(if enabled { "true" } else { "false" })
    .execute(&mut **transaction)
    .await
    .map_err(|error| {
        APIError::new(
            500,
            constants::database::could_not_store_provider_flag(&error),
        )
    })?;

    Ok(())
}

/// Flags one model as hidden. A row that already exists (a custom model, or one
/// hidden under a different spelling) is updated in place, because schema v2
/// merged the custom-model and hidden-model tables into one row; inserting
/// again would shadow it. Idempotent, and the id is stored lowercased so the
/// read side matches it whatever the request spelled.
async fn hide_model(
    transaction: &mut Transaction<'_, Sqlite>,
    base_id: &str,
    model_id: &str,
) -> Result<(), APIError> {
    let model_id = model_id.to_lowercase();

    let flagged = sqlx::query(
        "UPDATE provider_model_overrides SET hidden = 1 \
         WHERE provider_id = ? AND lower(model_id) = ?",
    )
    .bind(base_id)
    .bind(&model_id)
    .execute(&mut **transaction)
    .await
    .map_err(|error| APIError::new(500, constants::database::could_not_hide_model(&error)))?
    .rows_affected();

    if flagged > 0 {
        return Ok(());
    }

    sqlx::query(
        "INSERT INTO provider_model_overrides (provider_id, model_id, custom, hidden, created_at) \
         VALUES (?, ?, 0, 1, ?)",
    )
    .bind(base_id)
    .bind(&model_id)
    .bind(now_ms())
    .execute(&mut **transaction)
    .await
    .map_err(|error| APIError::new(500, constants::database::could_not_hide_model(&error)))?;

    Ok(())
}

/// Clears the hidden flag of one model, then drops the row when it carried
/// nothing else. Idempotent: restoring a model that is not hidden is a no-op,
/// while Node answers 404 there, because a set-shaped patch cannot fail halfway
/// for it.
async fn restore_model(
    transaction: &mut Transaction<'_, Sqlite>,
    base_id: &str,
    model_id: &str,
) -> Result<(), APIError> {
    let model_id = model_id.to_lowercase();

    sqlx::query(
        "UPDATE provider_model_overrides SET hidden = 0 \
         WHERE provider_id = ? AND lower(model_id) = ? AND hidden = 1",
    )
    .bind(base_id)
    .bind(&model_id)
    .execute(&mut **transaction)
    .await
    .map_err(|error| APIError::new(500, constants::database::could_not_restore_model(&error)))?;

    sqlx::query(
        "DELETE FROM provider_model_overrides \
         WHERE provider_id = ? AND lower(model_id) = ? AND custom = 0 AND hidden = 0",
    )
    .bind(base_id)
    .bind(&model_id)
    .execute(&mut **transaction)
    .await
    .map_err(|error| {
        APIError::new(
            500,
            constants::database::could_not_drop_restored_row(&error),
        )
    })?;

    Ok(())
}

/// Favorites one model. `favorite_models` carries no provider dimension, so the
/// row is keyed by the model id alone. Idempotent.
async fn favorite_model(
    transaction: &mut Transaction<'_, Sqlite>,
    model_id: &str,
) -> Result<(), APIError> {
    let model_id = model_id.to_lowercase();

    sqlx::query(
        "INSERT INTO favorite_models (model_id, created_at) \
         SELECT ?, ? WHERE NOT EXISTS (SELECT 1 FROM favorite_models WHERE lower(model_id) = ?)",
    )
    .bind(&model_id)
    .bind(now_ms())
    .bind(&model_id)
    .execute(&mut **transaction)
    .await
    .map_err(|error| APIError::new(500, constants::database::could_not_favorite_model(&error)))?;

    Ok(())
}

/// Drops the favorite row of one model, if any. Idempotent.
async fn unfavorite_model(
    transaction: &mut Transaction<'_, Sqlite>,
    model_id: &str,
) -> Result<(), APIError> {
    let model_id = model_id.to_lowercase();

    sqlx::query("DELETE FROM favorite_models WHERE lower(model_id) = ?")
        .bind(&model_id)
        .execute(&mut **transaction)
        .await
        .map_err(|error| {
            APIError::new(500, constants::database::could_not_unfavorite_model(&error))
        })?;

    Ok(())
}

/// The settings key holding a provider's enabled flag. Normalized to the base
/// id on both write and read, unlike Node, where the toggle writes the raw path
/// param but boot reads the base id, so a toggle through an alias is lost.
fn enabled_key(base_id: &str) -> String {
    format!("{PROVIDER_ENABLED_PREFIX}{base_id}")
}

/// The SQLite pool for a write. Writes fail loudly on a backend that cannot
/// persist them instead of pretending the change landed.
fn write_pool(database: &AppDatabase) -> Result<&SqlitePool, APIError> {
    database.sqlite_pool().ok_or_else(postgres_unsupported)
}

fn postgres_unsupported() -> APIError {
    APIError::new(500, constants::database::PROVIDERS_UNSUPPORTED)
}

/// Node tags seed rows with `meta.provider_specific_data.__seed__ = "true"`.
/// Unreadable or malformed meta is treated as a real connection, matching the
/// optional-chain read Node performs there.
fn is_seed_row(meta: Option<&str>) -> bool {
    let Some(parsed) = meta.and_then(|raw| serde_json::from_str::<Value>(raw).ok()) else {
        return false;
    };

    parsed
        .get("provider_specific_data")
        .and_then(|data| data.get("__seed__"))
        .and_then(Value::as_str)
        == Some("true")
}

fn text(row: &SqliteRow, column: &str) -> Result<String, APIError> {
    row.try_get::<String, _>(column)
        .map_err(|error| APIError::new(500, constants::database::column_unreadable(column, &error)))
}

fn optional_text(row: &SqliteRow, column: &str) -> Result<Option<String>, APIError> {
    row.try_get::<Option<String>, _>(column)
        .map_err(|error| APIError::new(500, constants::database::column_unreadable(column, &error)))
}

fn integer(row: &SqliteRow, column: &str) -> Result<i64, APIError> {
    row.try_get::<i64, _>(column)
        .map_err(|error| APIError::new(500, constants::database::column_unreadable(column, &error)))
}

/// A stored Qoder connection's usable credentials. It never enters a response or
/// a log line; it exists so the executor can sign one upstream request.
#[derive(Clone, Debug)]
pub struct QoderCredentials {
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

/// Loads the credentials of the newest Qoder connection. This build writes the
/// JSON layout; the camelCase spellings are accepted as well so a row written by
/// the Node build still reads (plan decision D2).
pub async fn load_qoder_credentials(
    database: &AppDatabase,
) -> Result<Option<QoderCredentials>, APIError> {
    let Some(pool) = database.sqlite_pool() else {
        return Ok(None);
    };

    let rows = sqlx::query(
        "SELECT credentials FROM providers \
         WHERE provider_id = 'qoder' OR provider_id LIKE 'qoder_%' OR provider_id LIKE 'qoder-%' \
            OR id = 'qoder' OR id LIKE 'qoder_%' OR id LIKE 'qoder-%' \
         ORDER BY created_at DESC",
    )
    .fetch_all(pool)
    .await
    .map_err(|error| {
        APIError::new(
            500,
            constants::database::with_context("read Qoder credentials", error),
        )
    })?;

    for row in &rows {
        let raw = row.try_get::<String, _>("credentials").map_err(|error| {
            APIError::new(
                500,
                constants::database::column_unreadable("credentials", &error),
            )
        })?;

        if let Some(credentials) = parse_qoder_credentials(&raw) {
            return Ok(Some(credentials));
        }
    }

    Ok(None)
}

/// Writes or refreshes one Qoder connection. The id is the primary key, so a
/// repeated callback for the same account updates the token in place.
pub async fn upsert_qoder_connection(
    database: &AppDatabase,
    write: &QoderConnectionWrite,
) -> Result<(), APIError> {
    let pool = write_pool(database)?;
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
    .execute(pool)
    .await
    .map_err(|error| {
        APIError::new(
            500,
            constants::database::with_context("store the Qoder connection", error),
        )
    })?;

    Ok(())
}

/// Reads one credential field under either spelling. Empty strings count as
/// missing, so a token that was cleared cannot be mistaken for a stored one.
fn credential_string(object: &serde_json::Map<String, Value>, keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| object.get(*key).and_then(Value::as_str))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
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
        access_token,
        refresh_token,
        token_expires_at,
        user_id,
        name,
        email,
    })
}

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
    let pool = write_pool(database)?;
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
    let pool = write_pool(database)?;
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
    .execute(pool)
    .await
    .map_err(|error| {
        APIError::new(
            500,
            constants::database::with_context("store the Grok Web connection", error),
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
        let raw = row.try_get::<String, _>("credentials").map_err(|error| {
            APIError::new(
                500,
                constants::database::column_unreadable("credentials", &error),
            )
        })?;

        if let Some(mut credentials) = parse_cline_credentials(&raw) {
            let id = row.try_get::<String, _>("id").map_err(|error| {
                APIError::new(500, constants::database::column_unreadable("id", &error))
            })?;
            credentials.id = id;
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
    let pool = write_pool(database)?;

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
    .fetch_all(pool)
    .await
    .map_err(|error| {
        APIError::new(
            500,
            constants::database::with_context("read Grok Web credentials", error),
        )
    })?;

    for row in &rows {
        let raw = row.try_get::<String, _>("credentials").map_err(|error| {
            APIError::new(
                500,
                constants::database::column_unreadable("credentials", &error),
            )
        })?;

        if let Some(mut credentials) = parse_grok_web_credentials(&raw) {
            let id = row.try_get::<String, _>("id").map_err(|error| {
                APIError::new(500, constants::database::column_unreadable("id", &error))
            })?;
            credentials.id = id;
            return Ok(Some(credentials));
        }
    }

    Ok(None)
}

/// Credential store for Grok Web: the `sso` session cookie of one account.
#[derive(Clone, Debug, serde::Serialize)]
pub struct GrokWebCredentials {
    /// The providers row id this connection lives under.
    pub id: String,
    /// The bare `sso` cookie value — never the `sso=` prefixed form.
    pub sso: String,
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
    .fetch_all(pool)
    .await
    .map_err(|error| {
        APIError::new(
            500,
            constants::database::with_context("read Codex credentials", &error),
        )
    })?;

    for row in &rows {
        let raw = row.try_get::<String, _>("credentials").map_err(|error| {
            APIError::new(
                500,
                constants::database::column_unreadable("credentials", &error),
            )
        })?;

        if let Some(mut credentials) = parse_codex_credentials(&raw) {
            let id = row.try_get::<String, _>("id").map_err(|error| {
                APIError::new(500, constants::database::column_unreadable("id", &error))
            })?;
            credentials.id = id;
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
    let pool = write_pool(database)?;

    let current = sqlx::query_scalar::<_, String>("SELECT credentials FROM providers WHERE id = ?")
        .bind(id)
        .fetch_optional(pool)
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
    .execute(pool)
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
    let pool = write_pool(database)?;
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
    .execute(pool)
    .await
    .map_err(|error| {
        APIError::new(
            500,
            constants::database::with_context("store the Codex connection", &error),
        )
    })?;

    Ok(())
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
