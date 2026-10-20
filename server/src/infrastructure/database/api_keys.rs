//! SQLx-backed API-key and admin-session stores against schema v2
//! (`docs/schemas-database.md`). Only the SQLite backend is implemented; the
//! PostgreSQL path has no schema-version carrier yet (tradeoff F), so these
//! stores report that explicitly instead of guessing.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use futures_util::future::BoxFuture;
use sqlx::sqlite::SqliteRow;
use sqlx::{Row, SqlitePool};

use crate::clock::now_ms;
use crate::constants;
use crate::error::APIError;
use crate::features::api_keys::model::{
    APIKey, APIKeyRecord, CreateAPIKeyInput, CreatedAPIKey, UpdateAPIKeyInput, generate_key_id,
    generate_key_secret, hash_api_key, key_prefix_of, normalize_allowed_models,
    parse_allowed_models, serialize_allowed_models,
};
use crate::features::api_keys::repository::APIKeyRepository;
use crate::features::api_keys::store::APIKeyStore;
use crate::infrastructure::database::AppDatabase;

use super::row::text;

const KEY_COLUMNS: &str = "id, key_prefix, name, user_id, enabled, rate_limit, quota_limit, \
                           usage_tokens, credit_limit, usage_cost, allowed_models, created_at";

/// Authentication and management store backed by `AppDatabase`.
#[derive(Clone)]
pub struct SQLxAPIKeyStore {
    database: AppDatabase,
    cache: Arc<Mutex<AuthCache>>,
}

#[derive(Default)]
struct AuthCache {
    keys: HashMap<String, Option<APIKeyRecord>>,
    require_api_key: Option<bool>,
}

impl SQLxAPIKeyStore {
    pub fn new(database: AppDatabase) -> Self {
        Self {
            database,
            cache: Arc::new(Mutex::new(AuthCache::default())),
        }
    }

    fn pool(&self) -> Result<SqlitePool, APIError> {
        self.database
            .sqlite_required(constants::database::API_KEYS_UNSUPPORTED)
    }

    fn clear_cache(&self) {
        if let Ok(mut cache) = self.cache.lock() {
            cache.keys.clear();
            cache.require_api_key = None;
        }
    }
}

impl APIKeyStore for SQLxAPIKeyStore {
    fn find_by_key<'a>(
        &'a self,
        key: &'a str,
    ) -> BoxFuture<'a, Result<Option<APIKeyRecord>, APIError>> {
        Box::pin(async move {
            let key_hash = hash_api_key(key);
            if let Ok(cache) = self.cache.lock()
                && let Some(record) = cache.keys.get(&key_hash)
            {
                return Ok(record.clone());
            }

            let pool = self.pool()?;
            let row = sqlx::query(
                "SELECT k.id, k.enabled, k.rate_limit, k.quota_limit, k.usage_tokens, \
                 k.credit_limit, k.usage_cost, k.allowed_models, \
                 COALESCE(u.enabled, 1) AS owner_enabled \
                 FROM api_keys k LEFT JOIN users u ON u.id = k.user_id WHERE k.key_hash = ?",
            )
            .bind(&key_hash)
            .fetch_optional(&pool)
            .await
            .map_err(sql_error(constants::database::context::LOOK_UP_API_KEY))?;

            let record = row.as_ref().map(auth_record_from_row);
            if let Ok(mut cache) = self.cache.lock() {
                cache.keys.insert(key_hash, record.clone());
            }

            Ok(record)
        })
    }

    fn require_api_key(&self) -> BoxFuture<'_, Result<bool, APIError>> {
        Box::pin(async move {
            if let Ok(cache) = self.cache.lock()
                && let Some(required) = cache.require_api_key
            {
                return Ok(required);
            }

            let pool = self.pool()?;
            let value = sqlx::query_scalar::<_, String>(
                "SELECT value FROM settings WHERE key = 'require_api_key'",
            )
            .fetch_optional(&pool)
            .await
            .map_err(sql_error(
                constants::database::context::READ_REQUIRE_API_KEY,
            ))?;

            let required = matches!(value.as_deref(), Some("true") | Some("1"));
            if let Ok(mut cache) = self.cache.lock() {
                cache.require_api_key = Some(required);
            }

            Ok(required)
        })
    }

    fn invalidate_cache(&self) {
        self.clear_cache();
    }
}

impl APIKeyRepository for SQLxAPIKeyStore {
    fn list(&self) -> BoxFuture<'_, Result<Vec<APIKey>, APIError>> {
        Box::pin(async move {
            let pool = self.pool()?;
            let statement =
                format!("SELECT {KEY_COLUMNS} FROM api_keys ORDER BY created_at DESC, id");
            let rows = sqlx::raw_sql(sqlx::AssertSqlSafe(statement))
                .fetch_all(&pool)
                .await
                .map_err(sql_error(constants::database::context::LIST_API_KEYS))?;

            rows.iter().map(api_key_from_row).collect()
        })
    }

    fn list_for_user(&self, user_id: &str) -> BoxFuture<'_, Result<Vec<APIKey>, APIError>> {
        let user_id = user_id.to_owned();

        Box::pin(async move {
            let pool = self.pool()?;
            let statement = format!(
                "SELECT {KEY_COLUMNS} FROM api_keys WHERE user_id = ? ORDER BY created_at DESC, id"
            );
            let rows = sqlx::query(sqlx::AssertSqlSafe(statement))
                .bind(&user_id)
                .fetch_all(&pool)
                .await
                .map_err(sql_error(constants::database::context::LIST_USER_API_KEYS))?;

            rows.iter().map(api_key_from_row).collect()
        })
    }

    fn create(&self, input: CreateAPIKeyInput) -> BoxFuture<'_, Result<CreatedAPIKey, APIError>> {
        Box::pin(async move {
            let pool = self.pool()?;
            let id = generate_key_id()?;
            let secret = generate_key_secret()?;
            let key_prefix = key_prefix_of(&secret);
            let created_at = now_ms();
            // An empty list means "unrestricted", so the stored row and the
            // response must both carry `NULL`/`null`.
            let allowed_models = normalize_allowed_models(input.allowed_models);
            let allowed_models_json = serialize_allowed_models(allowed_models.as_deref())?;
            if let Some(user_id) = input.user_id.as_deref() {
                ensure_user_exists(&pool, user_id).await?;
            }

            sqlx::query(
                "INSERT INTO api_keys (id, key_hash, key_prefix, name, user_id, enabled, rate_limit, \
                 quota_limit, usage_tokens, credit_limit, usage_cost, allowed_models, created_at) \
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 0, ?, ?)",
            )
            .bind(&id)
            .bind(hash_api_key(&secret))
            .bind(&key_prefix)
            .bind(&input.name)
            .bind(input.user_id.as_deref())
            .bind(i64::from(input.enabled))
            .bind(i64::from(input.rate_limit))
            .bind(i64::from(input.quota_limit))
            .bind(input.credit_limit)
            .bind(allowed_models_json)
            .bind(created_at)
            .execute(&pool)
            .await
            .map_err(sql_error(constants::database::context::CREATE_API_KEY))?;

            self.clear_cache();

            Ok(CreatedAPIKey {
                key: APIKey {
                    id,
                    key_prefix,
                    name: input.name,
                    user_id: input.user_id,
                    enabled: input.enabled,
                    rate_limit: input.rate_limit,
                    quota_limit: input.quota_limit,
                    usage_tokens: 0,
                    credit_limit: input.credit_limit,
                    usage_cost: 0.0,
                    allowed_models,
                    created_at,
                },
                secret,
            })
        })
    }

    fn update(
        &self,
        id: &str,
        patch: UpdateAPIKeyInput,
    ) -> BoxFuture<'_, Result<Option<APIKey>, APIError>> {
        let id = id.to_owned();

        Box::pin(async move {
            let pool = self.pool()?;
            let mut transaction = pool
                .begin()
                .await
                .map_err(sql_error(constants::database::context::START_KEY_UPDATE))?;

            let Some(mut key) = read_key(&mut transaction, &id).await? else {
                return Ok(None);
            };

            if let Some(name) = patch.name {
                key.name = name;
            }
            if let Some(Some(user_id)) = patch.user_id.as_ref() {
                ensure_user_exists(&mut *transaction, user_id).await?;
            }
            if let Some(user_id) = patch.user_id {
                key.user_id = user_id;
            }
            if let Some(enabled) = patch.enabled {
                key.enabled = enabled;
            }
            if let Some(rate_limit) = patch.rate_limit {
                key.rate_limit = rate_limit;
            }
            if let Some(quota_limit) = patch.quota_limit {
                key.quota_limit = quota_limit;
            }
            if let Some(credit_limit) = patch.credit_limit {
                key.credit_limit = credit_limit;
            }
            if let Some(models) = patch.allowed_models {
                // `[]` clears the allowlist exactly like an explicit `null`.
                key.allowed_models = normalize_allowed_models(models);
            }
            let allowed_models = serialize_allowed_models(key.allowed_models.as_deref())?;

            sqlx::query(
                "UPDATE api_keys SET name = ?, user_id = ?, enabled = ?, rate_limit = ?, \
                 quota_limit = ?, credit_limit = ?, allowed_models = ? WHERE id = ?",
            )
            .bind(&key.name)
            .bind(key.user_id.as_deref())
            .bind(i64::from(key.enabled))
            .bind(i64::from(key.rate_limit))
            .bind(i64::from(key.quota_limit))
            .bind(key.credit_limit)
            .bind(allowed_models)
            .bind(key.id.as_str())
            .execute(&mut *transaction)
            .await
            .map_err(sql_error(constants::database::context::UPDATE_API_KEY))?;

            transaction
                .commit()
                .await
                .map_err(sql_error(constants::database::context::COMMIT_KEY_UPDATE))?;

            self.clear_cache();

            Ok(Some(key))
        })
    }

    fn add_credit(&self, id: &str, amount: f64) -> BoxFuture<'_, Result<Option<APIKey>, APIError>> {
        let id = id.to_owned();

        Box::pin(async move {
            let pool = self.pool()?;
            let mut transaction = pool
                .begin()
                .await
                .map_err(sql_error(constants::database::context::START_CREDIT_UPDATE))?;

            let Some(mut key) = read_key(&mut transaction, &id).await? else {
                return Ok(None);
            };

            key.credit_limit += amount;

            sqlx::query("UPDATE api_keys SET credit_limit = ? WHERE id = ?")
                .bind(key.credit_limit)
                .bind(key.id.as_str())
                .execute(&mut *transaction)
                .await
                .map_err(sql_error(constants::database::context::ADD_CREDIT))?;

            transaction.commit().await.map_err(sql_error(
                constants::database::context::COMMIT_CREDIT_UPDATE,
            ))?;

            self.clear_cache();

            Ok(Some(key))
        })
    }

    fn delete(&self, id: &str) -> BoxFuture<'_, Result<bool, APIError>> {
        let id = id.to_owned();

        Box::pin(async move {
            let pool = self.pool()?;
            let result = sqlx::query("DELETE FROM api_keys WHERE id = ?")
                .bind(id)
                .execute(&pool)
                .await
                .map_err(sql_error(constants::database::context::DELETE_API_KEY))?;

            self.clear_cache();

            Ok(result.rows_affected() > 0)
        })
    }

    fn reserve_quota(
        &self,
        id: &str,
        reserved_tokens: i64,
    ) -> BoxFuture<'_, Result<bool, APIError>> {
        let id = id.to_owned();

        Box::pin(async move {
            if reserved_tokens <= 0 {
                return Ok(true);
            }

            let pool = self.pool()?;
            // The `WHERE` clause makes the check and the reservation atomic; a
            // zero-row update means the budget did not fit.
            let result = sqlx::query(
                "UPDATE api_keys SET usage_tokens = usage_tokens + ? \
                 WHERE id = ? AND (quota_limit = 0 OR usage_tokens + ? <= quota_limit)",
            )
            .bind(reserved_tokens)
            .bind(id)
            .bind(reserved_tokens)
            .execute(&pool)
            .await
            .map_err(sql_error(
                constants::database::context::RESERVE_API_KEY_QUOTA,
            ))?;

            Ok(result.rows_affected() > 0)
        })
    }

    fn settle_quota(
        &self,
        id: &str,
        reserved_tokens: i64,
        actual_tokens: i64,
    ) -> BoxFuture<'_, Result<(), APIError>> {
        let id = id.to_owned();

        Box::pin(async move {
            let difference = actual_tokens - reserved_tokens;
            if difference == 0 {
                return Ok(());
            }

            let pool = self.pool()?;
            sqlx::query("UPDATE api_keys SET usage_tokens = usage_tokens + ? WHERE id = ?")
                .bind(difference)
                .bind(id)
                .execute(&pool)
                .await
                .map_err(sql_error(
                    constants::database::context::SETTLE_API_KEY_QUOTA,
                ))?;

            // The cached auth record carries `usage_tokens`, and `api_key_auth`
            // rejects on it. Without this the cache keeps serving the pre-request
            // count, so an exhausted key authenticates until a restart.
            self.clear_cache();

            Ok(())
        })
    }

    fn increment_usage(
        &self,
        id: &str,
        tokens: i64,
        cost: f64,
    ) -> BoxFuture<'_, Result<(), APIError>> {
        let id = id.to_owned();

        Box::pin(async move {
            let pool = self.pool()?;
            sqlx::query(
                "UPDATE api_keys SET usage_tokens = usage_tokens + ?, \
                 usage_cost = usage_cost + ? WHERE id = ?",
            )
            .bind(tokens)
            .bind(cost)
            .bind(id)
            .execute(&pool)
            .await
            .map_err(sql_error(
                constants::database::context::INCREMENT_API_KEY_USAGE,
            ))?;

            // Same reason as `settle_quota`: `usage_cost` feeds the credit check.
            self.clear_cache();

            Ok(())
        })
    }
}

/// Raises each key's usage to the totals its own request log already records,
/// and never lowers a stored value.
///
/// A key served by a route that billed nothing kept `usage_tokens` at zero while
/// `request_logs` held its tokens, which is what the repair runs for on boot.
/// Only rows the client was charged for (`status_code = 200`) count, and the
/// raise is one-way: a key holding more than its log proves was billed by an
/// older path, and reducing it would silently refund quota already consumed.
/// The cost comparison carries a float tolerance so cents-level rounding does
/// not rewrite a key's spend on every boot. Returns how many keys it raised.
pub async fn reconcile_usage_from_logs(database: &AppDatabase) -> Result<u64, APIError> {
    let pool = database.sqlite_required(constants::database::API_KEYS_UNSUPPORTED)?;
    let result = sqlx::query(
        "UPDATE api_keys SET \
         usage_tokens = MAX(usage_tokens, COALESCE((SELECT SUM(l.total_tokens) FROM request_logs l \
             WHERE l.status_code = 200 AND (l.api_key_id = api_keys.id OR l.legacy_api_key_id = api_keys.id)), 0)), \
         usage_cost = MAX(usage_cost, COALESCE((SELECT SUM(l.estimated_cost) FROM request_logs l \
             WHERE l.status_code = 200 AND (l.api_key_id = api_keys.id OR l.legacy_api_key_id = api_keys.id)), 0)) \
         WHERE usage_tokens < COALESCE((SELECT SUM(l.total_tokens) FROM request_logs l \
             WHERE l.status_code = 200 AND (l.api_key_id = api_keys.id OR l.legacy_api_key_id = api_keys.id)), 0) \
         OR usage_cost + 0.000000001 < COALESCE((SELECT SUM(l.estimated_cost) FROM request_logs l \
             WHERE l.status_code = 200 AND (l.api_key_id = api_keys.id OR l.legacy_api_key_id = api_keys.id)), 0)",
    )
    .execute(&pool)
    .await
    .map_err(sql_error(
        constants::database::context::RECONCILE_API_KEY_USAGE,
    ))?;

    Ok(result.rows_affected())
}

async fn read_key(
    transaction: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    id: &str,
) -> Result<Option<APIKey>, APIError> {
    let statement = format!("SELECT {KEY_COLUMNS} FROM api_keys WHERE id = ?");
    let row = sqlx::query(sqlx::AssertSqlSafe(statement))
        .bind(id)
        .fetch_optional(&mut **transaction)
        .await
        .map_err(sql_error(constants::database::context::READ_API_KEY))?;

    row.as_ref().map(api_key_from_row).transpose()
}

fn api_key_from_row(row: &SqliteRow) -> Result<APIKey, APIError> {
    Ok(APIKey {
        id: text(row, "id")?,
        key_prefix: text(row, "key_prefix")?,
        name: text(row, "name")?,
        user_id: row.try_get::<Option<String>, _>("user_id").unwrap_or(None),
        enabled: row.try_get::<i64, _>("enabled").unwrap_or(0) != 0,
        rate_limit: u32_from(row, "rate_limit"),
        quota_limit: u32_from(row, "quota_limit"),
        usage_tokens: row.try_get::<i64, _>("usage_tokens").unwrap_or(0).max(0) as u64,
        credit_limit: row.try_get::<f64, _>("credit_limit").unwrap_or(0.0),
        usage_cost: row.try_get::<f64, _>("usage_cost").unwrap_or(0.0),
        allowed_models: parse_allowed_models(
            row.try_get::<Option<String>, _>("allowed_models")
                .unwrap_or(None)
                .as_deref(),
        ),
        created_at: row.try_get::<i64, _>("created_at").unwrap_or(0),
    })
}

fn auth_record_from_row(row: &SqliteRow) -> APIKeyRecord {
    APIKeyRecord {
        id: row.try_get::<String, _>("id").unwrap_or_default(),
        enabled: row.try_get::<i64, _>("enabled").unwrap_or(0) != 0,
        owner_enabled: row.try_get::<i64, _>("owner_enabled").unwrap_or(0) != 0,
        rate_limit: u32_from(row, "rate_limit"),
        quota_limit: row.try_get::<i64, _>("quota_limit").unwrap_or(0).max(0) as f64,
        usage_tokens: row.try_get::<i64, _>("usage_tokens").unwrap_or(0).max(0) as f64,
        credit_limit: row.try_get::<f64, _>("credit_limit").unwrap_or(0.0),
        usage_cost: row.try_get::<f64, _>("usage_cost").unwrap_or(0.0),
        allowed_models: parse_allowed_models(
            row.try_get::<Option<String>, _>("allowed_models")
                .unwrap_or(None)
                .as_deref(),
        ),
    }
}

fn u32_from(row: &SqliteRow, column: &str) -> u32 {
    u32::try_from(row.try_get::<i64, _>(column).unwrap_or(0).max(0)).unwrap_or(u32::MAX)
}

fn sql_error(context: &'static str) -> impl FnOnce(sqlx::Error) -> APIError {
    move |error| APIError::new(500, constants::database::with_context(context, &error))
}

/// Refuses an owner id with no `users` row. A disabled owner is accepted: its
/// key exists and cannot serve until the account is re-enabled.
async fn ensure_user_exists(
    executor: impl sqlx::Executor<'_, Database = sqlx::Sqlite>,
    user_id: &str,
) -> Result<(), APIError> {
    let found = sqlx::query_scalar::<_, i64>("SELECT 1 FROM users WHERE id = ?")
        .bind(user_id)
        .fetch_optional(executor)
        .await
        .map_err(sql_error(constants::database::context::CHECK_API_KEY_OWNER))?;

    if found.is_none() {
        return Err(APIError::new(400, constants::users::not_found(user_id)));
    }

    Ok(())
}
