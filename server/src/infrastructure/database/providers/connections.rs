//! The provider connection catalog: listing, existence, enablement, and the
//! `PATCH` edits (enable toggle, hide/restore/favorite). Only management columns
//! are read here; credentials live in the `credentials` submodule.

use serde_json::Value;
use sqlx::{Sqlite, Transaction};

use crate::clock::now_ms;
use crate::constants;
use crate::error::APIError;
use crate::infrastructure::database::AppDatabase;
use crate::infrastructure::database::row::{integer, optional_text, text};

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
    .fetch_all(&pool)
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

/// A provider row read for quota inspection, with credentials included.
#[derive(Clone, Debug)]
pub struct ProviderForQuota {
    pub id: String,
    pub provider_id: String,
    pub name: String,
    pub category: String,
    pub enabled: bool,
    pub credentials_raw: String,
}

/// Lists stored providers for quota inspection with their credentials intact,
/// newest first, excluding seed driver rows.
pub async fn list_providers_for_quota(
    database: &AppDatabase,
) -> Result<Vec<ProviderForQuota>, APIError> {
    let Some(pool) = database.sqlite_pool() else {
        return Ok(Vec::new());
    };

    let rows = sqlx::query(
        "SELECT id, provider_id, name, category, enabled, credentials, meta \
         FROM providers ORDER BY created_at DESC",
    )
    .fetch_all(&pool)
    .await
    .map_err(|error| {
        APIError::new(
            500,
            constants::database::could_not_read_provider_connections(&error),
        )
    })?;

    let mut result = Vec::with_capacity(rows.len());
    for row in &rows {
        if is_seed_row(optional_text(row, "meta")?.as_deref()) {
            continue;
        }

        result.push(ProviderForQuota {
            id: text(row, "id")?,
            provider_id: text(row, "provider_id")?,
            name: text(row, "name")?,
            category: text(row, "category")?,
            enabled: integer(row, "enabled")? != 0,
            credentials_raw: text(row, "credentials")?,
        });
    }

    Ok(result)
}

/// Whether any stored row—seed or connection—is driven by `base_id`. Node's
/// existence check counts seed rows too, so this one skips the seed filter.
pub async fn provider_exists(database: &AppDatabase, base_id: &str) -> Result<bool, APIError> {
    let Some(pool) = database.sqlite_pool() else {
        return Ok(false);
    };

    let rows = sqlx::query("SELECT id, provider_id FROM providers")
        .fetch_all(&pool)
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
        .fetch_optional(&pool)
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
    let pool = database.sqlite_required(constants::database::PROVIDERS_UNSUPPORTED)?;
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
