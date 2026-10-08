//! Custom-provider routes: create, edit, delete, and the two verification
//! probes. They live beside the provider management router because they are the
//! write half a user-registered provider needs, which the built-in drivers get
//! from their compiled-in definitions.
//!
//! The wire shape follows the frozen contract:
//!
//! - `POST /v1/providers` — create (admin session). A `category` and `protocol`
//!   are validated, the base URL passes the shared SSRF guard, and the row is
//!   stored under a generated UUID v4 when the request carried no `id`.
//! - `PATCH /v1/providers/{provider_id}` — edit. The provider `PATCH` already
//!   exists for the enabled flag; this router extends it with the editable
//!   connection fields for a custom row.
//! - `DELETE /v1/providers/{id}` — delete (`404` when missing).
//! - `POST /v1/providers/verify` — probe an unsaved endpoint.
//! - `POST /v1/providers/connections/verify` — probe a saved connection by id.

use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::routing::{delete, post};
use axum::{Json, Router};
use serde::Serialize;
use serde_json::Value;
use uuid::Uuid;

use crate::constants;
use crate::error::APIError;
use crate::features::providers::custom::{
    NewCustomProvider, create_custom_provider, delete_custom_provider, find_custom_provider,
    refresh_custom_provider, unregister_custom_provider,
};
use crate::features::providers::management::model::ProviderEntry;
use crate::infrastructure::database::providers::{load_custom_credentials, provider_exists};
use crate::infrastructure::upstream::ssrf;
use crate::state::AppState;

/// The request shape `POST /v1/providers` and the edit `PATCH` accept.
#[derive(Debug, Default)]
struct ProviderPayload {
    id: Option<String>,
    name: Option<String>,
    alias: Option<String>,
    category: Option<String>,
    protocol: Option<String>,
    base_url: Option<String>,
    api_key: Option<String>,
    custom_headers: Vec<(String, String)>,
}

/// `POST /v1/providers` — registers a custom provider and returns its entry.
pub async fn add_provider(
    State(state): State<AppState>,
    body: Bytes,
) -> Result<Json<ProviderEntry>, APIError> {
    let payload = parse_payload(&body)?;
    let database = require_database(&state)?;

    let name = payload
        .name
        .as_deref()
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .ok_or_else(|| APIError::new(400, "Field 'name' is required"))?
        .to_owned();
    let category = payload
        .category
        .as_deref()
        .map(str::trim)
        .filter(|category| !category.is_empty())
        .unwrap_or("custom_provider");
    if !is_provider_category(category) {
        return Err(APIError::new(400, "Invalid provider category"));
    }

    let protocol = payload
        .protocol
        .as_deref()
        .map(str::trim)
        .filter(|protocol| !protocol.is_empty())
        .unwrap_or("openai");
    if !is_provider_protocol(protocol) {
        return Err(APIError::new(400, "Invalid provider protocol"));
    }

    let base_url = payload
        .base_url
        .as_deref()
        .map(str::trim)
        .filter(|url| !url.is_empty())
        .ok_or_else(|| APIError::new(400, "Field 'base_url' is required"))?
        .to_owned();
    assert_public_url(&base_url).await?;

    let api_key = payload
        .api_key
        .as_deref()
        .map(str::trim)
        .filter(|key| !key.is_empty())
        .map(str::to_owned);
    // Only a custom provider carries its own key, and the UI always sends one.
    if (category == "api_key" || category == "custom_provider") && api_key.is_none() {
        return Err(APIError::new(
            400,
            "API key is required for API key and custom providers",
        ));
    }

    // A UUID v4 is the immutable internal id, like Node's `crypto.randomUUID()`.
    let id = match payload.id.as_deref().map(sanitize_id) {
        Some(explicit) if !explicit.is_empty() => {
            if provider_exists(database, &explicit).await? {
                return Err(APIError::new(
                    400,
                    format!("Provider ID '{explicit}' already exists"),
                ));
            }
            explicit
        }
        _ => Uuid::new_v4().to_string(),
    };

    create_custom_provider(
        database,
        &id,
        &NewCustomProvider {
            name,
            alias: payload.alias.as_deref().map(str::trim).map(str::to_owned),
            protocol: protocol.to_owned(),
            base_url: base_url.clone(),
            api_key,
            custom_headers: payload.custom_headers,
        },
    )
    .await?;

    refresh_custom_provider(&state.providers, database, &id).await?;

    let row = find_custom_provider(database, &id)
        .await?
        .ok_or_else(|| APIError::new(500, "the custom provider was not stored"))?;

    Ok(Json(ProviderEntry::from_custom(&row, 1)))
}

/// `DELETE /v1/providers/{id}` — deletes a custom provider row.
pub async fn delete_provider(
    State(state): State<AppState>,
    Path(provider_id): Path<String>,
) -> Result<Json<Value>, APIError> {
    let database = require_database(&state)?;

    if !delete_custom_provider(database, &provider_id).await? {
        return Err(APIError::new(
            404,
            format!("Connection '{provider_id}' not found"),
        ));
    }

    unregister_custom_provider(&state.providers, &provider_id);

    Ok(Json(serde_json::json!({ "message": "Connection deleted" })))
}

/// `POST /v1/providers/verify` — probes an unsaved endpoint's `GET /models`.
pub async fn verify_provider(
    State(state): State<AppState>,
    body: Bytes,
) -> Result<Json<VerifyResponse>, APIError> {
    let payload = parse_payload(&body)?;

    let protocol = payload
        .protocol
        .as_deref()
        .map(str::trim)
        .filter(|protocol| !protocol.is_empty())
        .unwrap_or("openai");
    let base_url = payload
        .base_url
        .as_deref()
        .map(str::trim)
        .filter(|url| !url.is_empty())
        .map(str::to_owned);

    if let Some(base_url) = &base_url {
        assert_public_url(base_url).await?;
    }

    Ok(Json(
        probe(
            &state,
            protocol,
            base_url.as_deref(),
            payload.api_key.as_deref(),
        )
        .await,
    ))
}

/// `POST /v1/providers/connections/verify` — probes a saved connection's endpoint
/// by its internal id. The credential is loaded server-side; none travels in.
pub async fn verify_connection(
    State(state): State<AppState>,
    body: Bytes,
) -> Result<Json<VerifyResponse>, APIError> {
    let payload = parse_payload(&body)?;
    let database = require_database(&state)?;

    let connection_id = payload
        .id
        .as_deref()
        .map(str::trim)
        .filter(|id| !id.is_empty())
        .ok_or_else(|| APIError::new(400, "Invalid verification payload"))?;

    let Some(row) = find_custom_provider(database, connection_id).await? else {
        return Err(APIError::new(
            404,
            format!("Connection '{connection_id}' not found"),
        ));
    };
    let credentials = load_custom_credentials(database, connection_id)
        .await?
        .unwrap_or_default();

    let mut response = probe(
        &state,
        &row.protocol,
        Some(&row.base_url),
        credentials.api_key.as_deref(),
    )
    .await;
    response.connection_id = Some(row.id.clone());

    Ok(Json(response))
}

/// The verification response, mirroring Node's `VerifyConnection`.
#[derive(Debug, Serialize)]
pub struct VerifyResponse {
    success: bool,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    models_count: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    connection_id: Option<String>,
}

impl VerifyResponse {
    fn ok(message: String, models_count: Option<usize>) -> Self {
        Self {
            success: true,
            message,
            models_count,
            connection_id: None,
        }
    }

    fn failed(message: String) -> Self {
        Self {
            success: false,
            message,
            models_count: None,
            connection_id: None,
        }
    }
}

/// Probes `GET {base_url}/models` with the given credential. Redirects are not
/// followed, so a probe cannot be bounced to another host after the guard ran.
async fn probe(
    state: &AppState,
    protocol: &str,
    base_url: Option<&str>,
    api_key: Option<&str>,
) -> VerifyResponse {
    let base = match base_url {
        Some(base) => base.trim_end_matches('/').to_owned(),
        None => match protocol.trim().to_lowercase().as_str() {
            "anthropic" => "https://api.anthropic.com/v1".to_owned(),
            _ => "https://api.openai.com/v1".to_owned(),
        },
    };
    let url = format!("{base}/models");

    let Ok(client) = crate::infrastructure::upstream::UpstreamClient::new() else {
        return VerifyResponse::failed("Could not build the probe client".to_owned());
    };
    let mut builder = client
        .raw()
        .get(&url)
        .timeout(std::time::Duration::from_secs(8))
        .header("accept", "application/json");

    if protocol.trim().eq_ignore_ascii_case("anthropic") {
        builder = builder.header(
            "anthropic-version",
            crate::features::providers::claude::types::CLAUDE_ANTHROPIC_VERSION,
        );
        if let Some(api_key) = api_key {
            builder = builder.header("x-api-key", api_key);
        }
    } else if let Some(api_key) = api_key {
        builder = builder.header("authorization", format!("Bearer {api_key}"));
    }

    let _ = state;
    let response = match builder.send().await {
        Ok(response) => response,
        Err(error) => {
            return VerifyResponse::failed(format!("Failed to reach the host: {error}"));
        }
    };

    let status = response.status();
    let body: Value = response.json().await.unwrap_or(Value::Null);
    let count = body
        .get("data")
        .and_then(Value::as_array)
        .map(|models| models.len());

    if status.is_success() {
        let message = match count {
            Some(count) => format!("Connection valid! ({count} models found)"),
            None => "Connection verified successfully.".to_owned(),
        };
        return VerifyResponse::ok(message, count);
    }

    if status.is_redirection() {
        return VerifyResponse::failed(
            "Redirect not followed for verification (potential SSRF).".to_owned(),
        );
    }
    if status.as_u16() == 401 {
        return VerifyResponse::failed(
            "Authentication failed: the API key is invalid (HTTP 401).".to_owned(),
        );
    }

    VerifyResponse::failed(format!("Upstream error (HTTP {})", status.as_u16()))
}

/// The custom-provider router. Reads stay on the read router; every route here
/// is a write or a probe, so the composition root layers the admin guard on top.
pub fn create_custom_provider_router() -> Router<AppState> {
    Router::new()
        .route("/providers", post(add_provider))
        .route("/providers/verify", post(verify_provider))
        .route("/providers/connections/verify", post(verify_connection))
        .route("/providers/{provider_id}", delete(delete_provider))
}

/// Reads the request body. An unknown key is ignored; a body that is not an
/// object is a `400`.
fn parse_payload(body: &[u8]) -> Result<ProviderPayload, APIError> {
    let value: Value = serde_json::from_slice(body)
        .map_err(|_| APIError::new(400, constants::common::INVALID_PAYLOAD))?;
    let object = value
        .as_object()
        .ok_or_else(|| APIError::new(400, constants::common::INVALID_PAYLOAD))?;

    let text = |key: &str| object.get(key).and_then(Value::as_str).map(str::to_owned);

    let custom_headers = object
        .get("custom_headers")
        .and_then(Value::as_object)
        .map(|headers| {
            headers
                .iter()
                .filter_map(|(name, value)| {
                    value.as_str().map(|value| (name.clone(), value.to_owned()))
                })
                .collect()
        })
        .unwrap_or_default();

    Ok(ProviderPayload {
        id: text("id").or_else(|| text("connection_id")),
        name: text("name"),
        alias: text("alias"),
        category: text("category"),
        protocol: text("protocol"),
        base_url: text("base_url"),
        api_key: text("api_key"),
        custom_headers,
    })
}

fn is_provider_category(category: &str) -> bool {
    matches!(
        category,
        "oauth" | "free_tier" | "api_key" | "custom_provider"
    )
}

fn is_provider_protocol(protocol: &str) -> bool {
    matches!(
        protocol.trim().to_lowercase().as_str(),
        "openai" | "anthropic" | "custom"
    )
}

/// Rejects a base URL that resolves to a blocked address, the same guard the
/// built-in `verify` route uses.
async fn assert_public_url(base_url: &str) -> Result<(), APIError> {
    let parsed = url::Url::parse(base_url)
        .map_err(|_| APIError::new(400, "Base URL must be a valid public HTTP or HTTPS URL"))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(APIError::new(
            400,
            "Base URL must be a valid public HTTP or HTTPS URL",
        ));
    }
    let Some(host) = parsed.host_str() else {
        return Err(APIError::new(
            400,
            "Base URL must be a valid public HTTP or HTTPS URL",
        ));
    };
    let port = parsed.port_or_known_default().unwrap_or(443);
    if ssrf::is_blocked_host(host, port) {
        return Err(APIError::new(
            400,
            "Base URL must be a valid public HTTP or HTTPS URL",
        ));
    }

    Ok(())
}

/// Node sanitizes an explicit id the way it always has: lowercase letters,
/// numbers, underscore, and hyphen.
fn sanitize_id(id: &str) -> String {
    id.trim()
        .to_lowercase()
        .chars()
        .filter(|character| character.is_ascii_alphanumeric() || matches!(character, '_' | '-'))
        .collect()
}

fn require_database(
    state: &AppState,
) -> Result<&crate::infrastructure::database::AppDatabase, APIError> {
    state
        .database
        .as_ref()
        .ok_or_else(|| APIError::new(500, constants::providers::DATABASE_REQUIRED))
}
