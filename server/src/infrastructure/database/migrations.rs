//! Version-guarded schema application (contract: `docs/schemas-database.md`).
//!
//! Fresh files get the v2 DDL directly. Legacy v1 files (any table present,
//! `user_version` below 2) are transformed first: shape-changed tables are
//! read, dropped and recreated by the DDL, renamed tables keep their rows,
//! and the transformed data is restored before the new version is recorded.
//! The whole run happens in one transaction, so a failure leaves the file at
//! its previous version.

use std::collections::{HashMap, HashSet};

use serde_json::{Map as JsonMap, Value as JsonValue};
use sha2::{Digest, Sha256};
use sqlx::sqlite::{SqlitePool, SqliteRow};
use sqlx::{Row, Transaction};

use crate::error::APIError;

/// The schema version this build writes. A database reporting a higher
/// version is refused instead of downgraded.
const SCHEMA_VERSION: i64 = 2;

/// The complete v2 DDL (`server/migrations/0002_v2_schema.sql`), every
/// statement written as `IF NOT EXISTS`.
const SCHEMA_SQL: &str = include_str!("../../../migrations/0002_v2_schema.sql");

/// Brings the SQLite file to [`SCHEMA_VERSION`].
pub async fn run(pool: &SqlitePool) -> Result<(), APIError> {
    let version: i64 = sqlx::query_scalar("PRAGMA user_version")
        .fetch_one(pool)
        .await
        .map_err(sql_error("read the schema version"))?;

    if version == SCHEMA_VERSION {
        return Ok(());
    }
    if version > SCHEMA_VERSION {
        return Err(APIError::new(
            500,
            format!(
                "the database schema version is {version}, newer than this server supports \
                 ({SCHEMA_VERSION}); refusing to open it"
            ),
        ));
    }

    let mut transaction = pool
        .begin()
        .await
        .map_err(sql_error("start the schema migration"))?;

    let tables = table_names(&mut transaction).await?;
    let legacy = if tables.is_empty() {
        LegacyData::default()
    } else {
        capture_legacy(&mut transaction, &tables).await?
    };

    sqlx::raw_sql(SCHEMA_SQL)
        .execute(&mut *transaction)
        .await
        .map_err(sql_error("apply the v2 schema"))?;

    legacy.restore(&mut transaction).await?;

    sqlx::query("PRAGMA user_version = 2")
        .execute(&mut *transaction)
        .await
        .map_err(sql_error("record the schema version"))?;

    transaction
        .commit()
        .await
        .map_err(sql_error("commit the schema migration"))
}

fn sql_error(context: &'static str) -> impl FnOnce(sqlx::Error) -> APIError {
    move |error| APIError::new(500, format!("{context}: {error}"))
}

async fn table_names(
    transaction: &mut Transaction<'_, sqlx::Sqlite>,
) -> Result<HashSet<String>, APIError> {
    let rows = sqlx::query("SELECT name FROM sqlite_master WHERE type = 'table'")
        .fetch_all(&mut **transaction)
        .await
        .map_err(sql_error("list the existing tables"))?;

    Ok(table_name_set(rows))
}

async fn table_columns(
    transaction: &mut Transaction<'_, sqlx::Sqlite>,
    table: &str,
) -> Result<HashSet<String>, APIError> {
    // `table` is always a literal from this module, never external input.
    let statement = format!("SELECT name FROM pragma_table_info('{table}')");
    let rows = sqlx::raw_sql(sqlx::AssertSqlSafe(statement))
        .fetch_all(&mut **transaction)
        .await
        .map_err(sql_error("inspect a table's columns"))?;

    Ok(table_name_set(rows))
}

fn table_name_set(rows: Vec<SqliteRow>) -> HashSet<String> {
    rows.iter()
        .filter_map(|row| row.try_get::<String, _>("name").ok())
        .filter(|name| !name.starts_with("sqlite_"))
        .collect()
}

// ---------------------------------------------------------------------------
// Legacy capture: read v1 rows, drop/rename so the v2 DDL can shape the file.
// ---------------------------------------------------------------------------

#[derive(Default)]
struct LegacyData {
    api_keys: Vec<APIKeyRow>,
    providers: Vec<ProviderRow>,
    overrides: Vec<OverrideRow>,
    fallback_rules: Vec<FallbackRuleRow>,
}

async fn capture_legacy(
    transaction: &mut Transaction<'_, sqlx::Sqlite>,
    tables: &HashSet<String>,
) -> Result<LegacyData, APIError> {
    let mut data = LegacyData::default();

    // Shape-changed tables are read fully and dropped; the v2 DDL recreates
    // them and restore() puts the transformed rows back.
    if tables.contains("api_keys") {
        let columns = table_columns(transaction, "api_keys").await?;
        if columns.contains("key") {
            data.api_keys = read_api_keys(transaction).await?;
            drop_table(transaction, "api_keys").await?;
        } else if !columns.contains("key_hash") {
            return Err(APIError::new(
                500,
                "the api_keys table has neither a 'key' nor a 'key_hash' column",
            ));
        }
    }

    if tables.contains("providers") {
        let columns = table_columns(transaction, "providers").await?;
        if columns.contains("api_key") {
            data.providers = read_providers(transaction).await?;
            drop_table(transaction, "providers").await?;
        } else if !columns.contains("credentials") {
            return Err(APIError::new(
                500,
                "the providers table has neither an 'api_key' nor a 'credentials' column",
            ));
        }
    }

    if tables.contains("custom_models") || tables.contains("hidden_models") {
        data.overrides = read_overrides(transaction, tables).await?;
        drop_table(transaction, "custom_models").await?;
        drop_table(transaction, "hidden_models").await?;
    }

    if tables.contains("fallback_rules") {
        data.fallback_rules = read_fallback_rules(transaction).await?;
        drop_table(transaction, "fallback_rules").await?;
    }

    // Renames keep their rows; the v2 DDL skips them via IF NOT EXISTS.
    if tables.contains("admin_account") && !tables.contains("admin_accounts") {
        rename_table(transaction, "admin_account", "admin_accounts").await?;
    }
    if tables.contains("system_settings") && !tables.contains("settings") {
        rename_table(transaction, "system_settings", "settings").await?;
    }

    // Tables kept as-is still miss the columns Node's ALTERs used to add.
    ensure_columns(
        transaction,
        "oauth_sessions",
        &[("claimed_at", "INTEGER"), ("device_code", "TEXT")],
    )
    .await?;
    ensure_columns(
        transaction,
        "request_logs",
        &[
            ("ip_address", "TEXT"),
            ("user_agent", "TEXT"),
            ("cached_tokens", "INTEGER NOT NULL DEFAULT 0"),
            ("cache_creation_tokens", "INTEGER NOT NULL DEFAULT 0"),
            ("reasoning_tokens", "INTEGER NOT NULL DEFAULT 0"),
            ("estimated_cost", "REAL NOT NULL DEFAULT 0"),
            ("fallback_occurred", "INTEGER NOT NULL DEFAULT 0"),
            ("fallback_path", "TEXT"),
            ("fallback_reason", "TEXT"),
            ("resolved_model", "TEXT"),
        ],
    )
    .await?;

    if tables.contains("srouter_schema_meta") {
        drop_table(transaction, "srouter_schema_meta").await?;
    }

    Ok(data)
}

async fn drop_table(
    transaction: &mut Transaction<'_, sqlx::Sqlite>,
    table: &str,
) -> Result<(), APIError> {
    // `table` is always a literal from this module.
    let statement = format!("DROP TABLE IF EXISTS {table}");
    sqlx::raw_sql(sqlx::AssertSqlSafe(statement))
        .execute(&mut **transaction)
        .await
        .map_err(sql_error("drop a legacy table"))?;
    Ok(())
}

async fn rename_table(
    transaction: &mut Transaction<'_, sqlx::Sqlite>,
    from: &str,
    to: &str,
) -> Result<(), APIError> {
    // Both names are literals from this module.
    let statement = format!("ALTER TABLE {from} RENAME TO {to}");
    sqlx::raw_sql(sqlx::AssertSqlSafe(statement))
        .execute(&mut **transaction)
        .await
        .map_err(sql_error("rename a legacy table"))?;
    Ok(())
}

async fn ensure_columns(
    transaction: &mut Transaction<'_, sqlx::Sqlite>,
    table: &str,
    columns: &[(&str, &str)],
) -> Result<(), APIError> {
    let existing = table_columns(transaction, table).await?;
    if existing.is_empty() {
        return Ok(()); // absent table: the v2 DDL creates it complete
    }

    for (name, definition) in columns {
        if existing.contains(*name) {
            continue;
        }
        // `table` and `name` are literals from this module.
        let statement = format!("ALTER TABLE {table} ADD COLUMN {name} {definition}");
        sqlx::raw_sql(sqlx::AssertSqlSafe(statement))
            .execute(&mut **transaction)
            .await
            .map_err(sql_error("add a column older databases are missing"))?;
    }
    Ok(())
}

async fn read_api_keys(
    transaction: &mut Transaction<'_, sqlx::Sqlite>,
) -> Result<Vec<APIKeyRow>, APIError> {
    let rows = sqlx::query("SELECT * FROM api_keys")
        .fetch_all(&mut **transaction)
        .await
        .map_err(sql_error("read the legacy api_keys table"))?;

    rows.iter()
        .map(|row| {
            let secret = required_text(row, "key")?;
            Ok(APIKeyRow {
                id: required_text(row, "id")?,
                key_hash: sha256_hex(&secret),
                key_prefix: secret.chars().take(8).collect(),
                name: column_text(row, "name").unwrap_or_default(),
                enabled: column_integer(row, "enabled").unwrap_or(1),
                rate_limit: column_integer(row, "rate_limit").unwrap_or(0),
                quota_limit: column_integer(row, "quota_limit").unwrap_or(0),
                usage_tokens: column_integer(row, "usage_tokens").unwrap_or(0),
                credit_limit: column_real(row, "credit_limit").unwrap_or(0.0),
                usage_cost: column_real(row, "usage_cost").unwrap_or(0.0),
                allowed_models: column_text(row, "allowed_models"),
                created_at: column_integer(row, "created_at").unwrap_or(0),
            })
        })
        .collect()
}

async fn read_providers(
    transaction: &mut Transaction<'_, sqlx::Sqlite>,
) -> Result<Vec<ProviderRow>, APIError> {
    let rows = sqlx::query("SELECT * FROM providers")
        .fetch_all(&mut **transaction)
        .await
        .map_err(sql_error("read the legacy providers table"))?;

    rows.iter()
        .map(|row| {
            let mut credentials = JsonMap::new();
            for column in [
                "api_key",
                "access_token",
                "refresh_token",
                "account_id",
                "organization_id",
            ] {
                if let Some(value) = column_text(row, column) {
                    credentials.insert(column.to_owned(), JsonValue::String(value));
                }
            }
            for column in ["token_expires_at", "last_refreshed_at"] {
                if let Some(value) = column_integer(row, column) {
                    credentials.insert(column.to_owned(), JsonValue::from(value));
                }
            }

            // Malformed or absent JSON simply drops the meta key.
            let mut meta = JsonMap::new();
            for column in ["custom_headers", "provider_specific_data"] {
                if let Some(parsed) = column_text(row, column)
                    .and_then(|raw| serde_json::from_str::<JsonValue>(&raw).ok())
                    .filter(|value| !value.is_null())
                {
                    meta.insert(column.to_owned(), parsed);
                }
            }

            Ok(ProviderRow {
                id: required_text(row, "id")?,
                provider_id: required_text(row, "provider_id")?,
                name: column_text(row, "name").unwrap_or_default(),
                alias: column_text(row, "alias"),
                category: column_text(row, "category").unwrap_or_default(),
                protocol: column_text(row, "protocol").unwrap_or_default(),
                base_url: column_text(row, "base_url"),
                enabled: column_integer(row, "enabled").unwrap_or(1),
                credentials: JsonValue::Object(credentials).to_string(),
                meta: JsonValue::Object(meta).to_string(),
                created_at: column_integer(row, "created_at").unwrap_or(0),
            })
        })
        .collect()
}

/// Merges `custom_models` and `hidden_models` into one row per model with two
/// flags; a model in both tables gets `custom = 1` and `hidden = 1`, and the
/// earliest `created_at` wins.
async fn read_overrides(
    transaction: &mut Transaction<'_, sqlx::Sqlite>,
    tables: &HashSet<String>,
) -> Result<Vec<OverrideRow>, APIError> {
    let mut merged: HashMap<(String, String), (i64, i64, i64)> = HashMap::new();

    for (table, is_custom) in [("custom_models", true), ("hidden_models", false)] {
        if !tables.contains(table) {
            continue;
        }
        // `table` is a literal from this loop.
        let statement = format!("SELECT provider_id, model_id, created_at FROM {table}");
        let rows = sqlx::raw_sql(sqlx::AssertSqlSafe(statement))
            .fetch_all(&mut **transaction)
            .await
            .map_err(sql_error("read the legacy model override tables"))?;

        for row in &rows {
            let key = (
                required_text(row, "provider_id")?,
                required_text(row, "model_id")?,
            );
            let created_at = column_integer(row, "created_at").unwrap_or(0);
            let entry = merged.entry(key).or_insert((0, 0, i64::MAX));
            if is_custom {
                entry.0 = 1;
            } else {
                entry.1 = 1;
            }
            entry.2 = entry.2.min(created_at);
        }
    }

    Ok(merged
        .into_iter()
        .map(
            |((provider_id, model_id), (custom, hidden, created_at))| OverrideRow {
                provider_id,
                model_id,
                custom,
                hidden,
                created_at: if created_at == i64::MAX {
                    0
                } else {
                    created_at
                },
            },
        )
        .collect())
}

async fn read_fallback_rules(
    transaction: &mut Transaction<'_, sqlx::Sqlite>,
) -> Result<Vec<FallbackRuleRow>, APIError> {
    let rows = sqlx::query("SELECT * FROM fallback_rules")
        .fetch_all(&mut **transaction)
        .await
        .map_err(sql_error("read the legacy fallback_rules table"))?;

    rows.iter()
        .map(|row| {
            Ok(FallbackRuleRow {
                id: required_text(row, "id")?,
                source_model: required_text(row, "source_model")?,
                target_model: required_text(row, "target_model")?,
                priority: column_integer(row, "priority").unwrap_or(1),
                enabled: column_integer(row, "enabled").unwrap_or(1),
                trigger_on_status: column_text(row, "trigger_on_status"),
                max_retries: column_integer(row, "max_retries").unwrap_or(1),
                created_at: column_integer(row, "created_at").unwrap_or(0),
            })
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Row access helpers: a column that does not exist in an older file reads as
// NULL instead of failing the whole migration.
// ---------------------------------------------------------------------------

fn column_text(row: &SqliteRow, column: &str) -> Option<String> {
    row.try_get::<Option<String>, _>(column).unwrap_or(None)
}

fn column_integer(row: &SqliteRow, column: &str) -> Option<i64> {
    row.try_get::<Option<i64>, _>(column).unwrap_or(None)
}

fn column_real(row: &SqliteRow, column: &str) -> Option<f64> {
    row.try_get::<Option<f64>, _>(column).unwrap_or(None)
}

fn required_text(row: &SqliteRow, column: &str) -> Result<String, APIError> {
    column_text(row, column).ok_or_else(|| {
        APIError::new(
            500,
            format!("a legacy row has no usable value in column '{column}'"),
        )
    })
}

fn sha256_hex(secret: &str) -> String {
    hex::encode(Sha256::digest(secret.as_bytes()))
}

// ---------------------------------------------------------------------------
// Restore: re-insert the transformed rows into the freshly created v2 tables.
// ---------------------------------------------------------------------------

struct APIKeyRow {
    id: String,
    key_hash: String,
    key_prefix: String,
    name: String,
    enabled: i64,
    rate_limit: i64,
    quota_limit: i64,
    usage_tokens: i64,
    credit_limit: f64,
    usage_cost: f64,
    allowed_models: Option<String>,
    created_at: i64,
}

struct ProviderRow {
    id: String,
    provider_id: String,
    name: String,
    alias: Option<String>,
    category: String,
    protocol: String,
    base_url: Option<String>,
    enabled: i64,
    credentials: String,
    meta: String,
    created_at: i64,
}

struct OverrideRow {
    provider_id: String,
    model_id: String,
    custom: i64,
    hidden: i64,
    created_at: i64,
}

struct FallbackRuleRow {
    id: String,
    source_model: String,
    target_model: String,
    priority: i64,
    enabled: i64,
    trigger_on_status: Option<String>,
    max_retries: i64,
    created_at: i64,
}

impl LegacyData {
    async fn restore(
        &self,
        transaction: &mut Transaction<'_, sqlx::Sqlite>,
    ) -> Result<(), APIError> {
        for key in &self.api_keys {
            sqlx::query(
                "INSERT INTO api_keys (id, key_hash, key_prefix, name, enabled, rate_limit, \
                 quota_limit, usage_tokens, credit_limit, usage_cost, allowed_models, created_at) \
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(&key.id)
            .bind(&key.key_hash)
            .bind(&key.key_prefix)
            .bind(&key.name)
            .bind(key.enabled)
            .bind(key.rate_limit)
            .bind(key.quota_limit)
            .bind(key.usage_tokens)
            .bind(key.credit_limit)
            .bind(key.usage_cost)
            .bind(&key.allowed_models)
            .bind(key.created_at)
            .execute(&mut **transaction)
            .await
            .map_err(sql_error("restore an API key row"))?;
        }

        for provider in &self.providers {
            sqlx::query(
                "INSERT INTO providers (id, provider_id, name, alias, category, protocol, \
                 base_url, enabled, credentials, meta, created_at) \
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(&provider.id)
            .bind(&provider.provider_id)
            .bind(&provider.name)
            .bind(&provider.alias)
            .bind(&provider.category)
            .bind(&provider.protocol)
            .bind(&provider.base_url)
            .bind(provider.enabled)
            .bind(&provider.credentials)
            .bind(&provider.meta)
            .bind(provider.created_at)
            .execute(&mut **transaction)
            .await
            .map_err(sql_error("restore a provider row"))?;
        }

        for override_row in &self.overrides {
            sqlx::query(
                "INSERT INTO provider_model_overrides (provider_id, model_id, custom, hidden, \
                 created_at) VALUES (?, ?, ?, ?, ?)",
            )
            .bind(&override_row.provider_id)
            .bind(&override_row.model_id)
            .bind(override_row.custom)
            .bind(override_row.hidden)
            .bind(override_row.created_at)
            .execute(&mut **transaction)
            .await
            .map_err(sql_error("restore a model override row"))?;
        }

        for rule in &self.fallback_rules {
            sqlx::query(
                "INSERT INTO fallback_rules (id, source_model, target_model, priority, enabled, \
                 trigger_on_status, max_retries, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(&rule.id)
            .bind(&rule.source_model)
            .bind(&rule.target_model)
            .bind(rule.priority)
            .bind(rule.enabled)
            .bind(&rule.trigger_on_status)
            .bind(rule.max_retries)
            .bind(rule.created_at)
            .execute(&mut **transaction)
            .await
            .map_err(sql_error("restore a fallback rule row"))?;
        }

        Ok(())
    }
}
