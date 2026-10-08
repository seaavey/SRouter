//! Persistence behind the custom-provider routes: the `providers` rows a user
//! registers over HTTP, read and written as a whole.
//!
//! Node keeps one row per connection and rebuilds the whole registry after every
//! write (`loadSavedProvidersFromDB`). The Rust build does the same on boot and
//! after each write, so the read here returns every custom row and the caller
//! re-registers them.

use serde_json::{Map, Value};

use crate::clock::now_ms;
use crate::constants;
use crate::error::APIError;
use crate::infrastructure::database::AppDatabase;
use crate::infrastructure::database::row::{integer, optional_text, text};

/// One user-registered provider row. `credentials` is carried whole so it can be
/// re-read without touching a secret column.
#[derive(Clone, Debug)]
pub struct CustomProviderRow {
    pub id: String,
    pub name: String,
    pub alias: Option<String>,
    pub category: String,
    pub protocol: String,
    pub base_url: String,
    pub enabled: bool,
}

/// The fields `POST /v1/providers` accepts for a custom provider.
#[derive(Clone, Debug)]
pub struct NewCustomProvider {
    pub name: String,
    pub alias: Option<String>,
    pub protocol: String,
    pub base_url: String,
    pub api_key: Option<String>,
    pub custom_headers: Vec<(String, String)>,
}

/// Lists every custom provider: a row whose category is `custom_provider` and
/// whose id is not a seed marker. Newest first, like Node's catalog.
pub async fn list_custom_providers(
    database: &AppDatabase,
) -> Result<Vec<CustomProviderRow>, APIError> {
    let Some(pool) = database.sqlite_pool() else {
        return Ok(Vec::new());
    };

    let rows = sqlx::query(
        "SELECT id, name, alias, category, protocol, base_url, enabled, meta \
         FROM providers WHERE category = 'custom_provider' ORDER BY created_at DESC",
    )
    .fetch_all(&pool)
    .await
    .map_err(|error| {
        APIError::new(
            500,
            constants::database::could_not_read_provider_connections(&error),
        )
    })?;

    let mut providers = Vec::with_capacity(rows.len());
    for row in &rows {
        // A seed row tagged in meta is a driver, not a user provider.
        if is_seed_row(optional_text(row, "meta")?.as_deref()) {
            continue;
        }

        providers.push(CustomProviderRow {
            id: text(row, "id")?,
            name: text(row, "name")?,
            alias: optional_text(row, "alias")?,
            category: text(row, "category")?,
            protocol: text(row, "protocol")?,
            base_url: optional_text(row, "base_url")?.unwrap_or_default(),
            enabled: integer(row, "enabled")? != 0,
        });
    }

    Ok(providers)
}

/// Reads one custom provider by its internal id.
pub async fn find_custom_provider(
    database: &AppDatabase,
    id: &str,
) -> Result<Option<CustomProviderRow>, APIError> {
    Ok(list_custom_providers(database)
        .await?
        .into_iter()
        .find(|provider| provider.id == id))
}

/// Inserts one custom provider. The caller supplies the id (a UUID generated
/// when the request carried none), matching Node's immutable internal id.
pub async fn create_custom_provider(
    database: &AppDatabase,
    id: &str,
    provider: &NewCustomProvider,
) -> Result<(), APIError> {
    let pool = database.sqlite_required(constants::database::PROVIDERS_UNSUPPORTED)?;

    let credentials = credentials_json(provider);
    let meta = meta_json(provider);

    sqlx::query(
        "INSERT INTO providers \
         (id, provider_id, name, alias, category, protocol, base_url, enabled, credentials, meta, created_at) \
         VALUES (?, ?, ?, ?, 'custom_provider', ?, ?, 1, ?, ?, ?) \
         ON CONFLICT(id) DO UPDATE SET \
           name = excluded.name, alias = excluded.alias, protocol = excluded.protocol, \
           base_url = excluded.base_url, credentials = excluded.credentials, meta = excluded.meta",
    )
    .bind(id)
    .bind(id)
    .bind(&provider.name)
    .bind(provider.alias.as_deref())
    .bind(&provider.protocol)
    .bind(&provider.base_url)
    .bind(credentials.to_string())
    .bind(meta.to_string())
    .bind(now_ms())
    .execute(&pool)
    .await
    .map_err(|error| {
        APIError::new(
            500,
            constants::database::with_context("store the custom provider", error),
        )
    })?;

    Ok(())
}

/// Deletes one custom provider row. Returns whether a row was removed, so the
/// route can answer `404`.
pub async fn delete_custom_provider(database: &AppDatabase, id: &str) -> Result<bool, APIError> {
    let pool = database.sqlite_required(constants::database::PROVIDERS_UNSUPPORTED)?;

    let affected =
        sqlx::query("DELETE FROM providers WHERE id = ? AND category = 'custom_provider'")
            .bind(id)
            .execute(&pool)
            .await
            .map_err(|error| {
                APIError::new(
                    500,
                    constants::database::with_context("delete the custom provider", error),
                )
            })?
            .rows_affected();

    Ok(affected > 0)
}

/// The credential blob: the API key (Node's only accepted secret) plus any
/// custom headers, under the same keys the Node build writes.
fn credentials_json(provider: &NewCustomProvider) -> Value {
    let mut credentials = Map::new();
    if let Some(api_key) = provider
        .api_key
        .as_deref()
        .filter(|key| !key.trim().is_empty())
    {
        credentials.insert("api_key".to_owned(), Value::String(api_key.to_owned()));
    }

    Value::Object(credentials)
}

/// The meta blob: `custom_headers`, when the request carried any.
fn meta_json(provider: &NewCustomProvider) -> Value {
    let mut meta = Map::new();
    if !provider.custom_headers.is_empty() {
        let headers: Map<String, Value> = provider
            .custom_headers
            .iter()
            .map(|(name, value)| (name.clone(), Value::String(value.clone())))
            .collect();
        meta.insert("custom_headers".to_owned(), Value::Object(headers));
    }

    Value::Object(meta)
}

/// Node tags seed rows with `meta.provider_specific_data.__seed__ = "true"`.
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

#[cfg(test)]
mod tests {
    use super::{NewCustomProvider, credentials_json, meta_json};

    fn provider() -> NewCustomProvider {
        NewCustomProvider {
            name: "My Gateway".to_owned(),
            alias: Some("mine".to_owned()),
            protocol: "openai".to_owned(),
            base_url: "https://example.com/v1".to_owned(),
            api_key: Some("sk-test".to_owned()),
            custom_headers: vec![],
        }
    }

    #[test]
    fn writes_the_api_key_under_the_node_key_name() {
        let credentials = credentials_json(&provider());

        assert_eq!(credentials["api_key"], "sk-test");
    }

    #[test]
    fn omits_an_empty_api_key() {
        let mut provider = provider();
        provider.api_key = Some("   ".to_owned());

        assert!(credentials_json(&provider).as_object().unwrap().is_empty());
    }

    #[test]
    fn writes_custom_headers_under_meta() {
        let mut provider = provider();
        provider.custom_headers = vec![("X-Tenant".to_owned(), "acme".to_owned())];

        assert_eq!(meta_json(&provider)["custom_headers"]["X-Tenant"], "acme");
    }
}
