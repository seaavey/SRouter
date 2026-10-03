//! `/v1/providers` management routes. Reads are served from the static provider
//! seed plus the stored connections; the enabled flag and the hidden/favorite
//! flags come from the database when one is wired in. Every write goes through a
//! single `PATCH /providers/{provider_id}`, and no route lists hidden models on
//! its own: the detail response is where those flags are read.

use std::collections::HashSet;

use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::routing::{get, patch};
use axum::{Json, Router};
use serde::Serialize;
use serde_json::Value;

use crate::constants;
use crate::error::APIError;
use crate::features::providers::management::model::{
    CatalogResponse, GroupedCatalog, ProviderConnectionView, ProviderEntry, ProviderModel,
};
use crate::features::providers::{ProviderMetadata, SEED_PROVIDERS};
use crate::infrastructure::database::AppDatabase;
use crate::infrastructure::database::catalog_flags::{favorite_model_ids, hidden_model_ids};
use crate::infrastructure::database::providers::{
    ProviderConnection, ProviderPatch, apply_provider_patch, list_connections, matches_base_id,
    provider_enabled, provider_exists,
};
use crate::state::AppState;

const INVALID_PATCH_PAYLOAD: &str = constants::common::INVALID_PAYLOAD;

/// Read routes. The composition root layers API-key auth on top, matching the
/// Node router, which installs no admin guard on `GET /providers`.
pub fn create_providers_read_router() -> Router<AppState> {
    Router::new()
        .route("/providers", get(list_providers))
        // Registered before the param route for readability; `matchit` gives
        // static segments priority either way.
        .route("/providers/catalog", get(get_catalog))
        .route("/providers/{provider_id}", get(get_provider))
}

/// Mutation routes. The composition root layers the admin-session guard on top,
/// matching the Node router, which requires `RequireAdmin` for every write.
/// One `PATCH` carries every edit the catalog page can make.
pub fn create_providers_management_router() -> Router<AppState> {
    Router::new().route("/providers/{provider_id}", patch(patch_provider))
}

#[derive(Serialize)]
struct ProviderListResponse {
    object: &'static str,
    data: Vec<ProviderEntry>,
}

async fn list_providers(
    State(state): State<AppState>,
) -> Result<Json<ProviderListResponse>, APIError> {
    let mut data = Vec::with_capacity(SEED_PROVIDERS.len());
    for metadata in SEED_PROVIDERS {
        data.push(provider_entry(&state, *metadata).await?);
    }

    Ok(Json(ProviderListResponse {
        object: "list",
        data,
    }))
}

async fn get_catalog(State(state): State<AppState>) -> Result<Json<CatalogResponse>, APIError> {
    let mut providers = Vec::with_capacity(SEED_PROVIDERS.len());
    for metadata in SEED_PROVIDERS {
        providers.push(provider_entry(&state, *metadata).await?);
    }
    let total = providers.len();

    let mut categories = GroupedCatalog::default();
    for provider in providers {
        categories.push(provider);
    }

    Ok(Json(CatalogResponse { total, categories }))
}

async fn get_provider(
    State(state): State<AppState>,
    Path(provider_id): Path<String>,
) -> Result<Json<ProviderEntry>, APIError> {
    // The whole detail payload, hidden models included: the `hidden` flag per
    // model is the only place the admin view learns what it can restore.
    Ok(Json(detail_entry(&state, &provider_id).await?))
}

/// Edits one provider in place: the enabled flag, plus the hidden and favorite
/// state of individual models. Every field is optional, so the catalog page
/// needs exactly one write route.
async fn patch_provider(
    State(state): State<AppState>,
    Path(provider_id): Path<String>,
    body: Bytes,
) -> Result<Json<ProviderEntry>, APIError> {
    let patch = parse_provider_patch(&body)?;
    let database = require_database(&state)?;
    // The path param is matched case-insensitively, like the detail route, and
    // the edits belong to the driver: a connection id (`opencode_zen_work`)
    // writes the same rows the catalog reads back.
    let normalized = provider_id.to_lowercase();
    let base_id = base_id_of(&normalized);

    let is_seed = SEED_PROVIDERS.iter().any(|metadata| metadata.id == base_id);
    if !is_seed && !provider_exists(database, base_id).await? {
        return Err(APIError::new(
            400,
            constants::providers::not_found(&provider_id),
        ));
    }

    apply_provider_patch(database, base_id, &patch).await?;

    // Read back after the write, so the response reports the stored state rather
    // than what the request asked for.
    Ok(Json(detail_entry(&state, base_id).await?))
}

/// Reads the editable fields out of the request body. An unknown key is ignored;
/// a request that names none of them is rejected instead of answered with a
/// silent no-op.
fn parse_provider_patch(body: &[u8]) -> Result<ProviderPatch, APIError> {
    let value: Value = serde_json::from_slice(body).map_err(|_| invalid_patch_payload())?;
    let object = value.as_object().ok_or_else(invalid_patch_payload)?;

    let mut patch = ProviderPatch::default();

    if let Some(enabled) = object.get("enabled") {
        // Only a real boolean is accepted, so `"yes"` and `1` cannot flip a
        // provider.
        patch.enabled = Some(enabled.as_bool().ok_or_else(invalid_patch_payload)?);
    }

    for (key, target) in [
        ("hide", &mut patch.hidden),
        ("restore", &mut patch.restored),
        ("favorite", &mut patch.favorited),
        ("unfavorite", &mut patch.unfavorited),
    ] {
        if let Some(list) = object.get(key) {
            *target = parse_model_ids(list)?;
        }
    }

    if patch.is_empty() {
        return Err(invalid_patch_payload());
    }

    Ok(patch)
}

/// Reads a list of model ids. Every entry has to be a non-empty string, so a bad
/// payload cannot write a meaningless row.
fn parse_model_ids(value: &Value) -> Result<Vec<String>, APIError> {
    value
        .as_array()
        .ok_or_else(invalid_patch_payload)?
        .iter()
        .map(|entry| match entry {
            Value::String(model_id) if !model_id.trim().is_empty() => {
                Ok(model_id.trim().to_owned())
            }
            _ => Err(invalid_patch_payload()),
        })
        .collect()
}

fn invalid_patch_payload() -> APIError {
    APIError::new(400, INVALID_PATCH_PAYLOAD)
}

/// Collapses a connection id onto its driver: the base id itself, or a
/// `<base>_`/`<base>-` namespaced variant of it.
fn base_id_of(provider_id: &str) -> &str {
    for metadata in SEED_PROVIDERS {
        if matches_base_id(provider_id, metadata.id) {
            return metadata.id;
        }
    }

    provider_id
}

/// Writes need a database to persist into; reporting success without one would
/// silently drop the operator's change.
fn require_database(state: &AppState) -> Result<&AppDatabase, APIError> {
    state
        .database
        .as_ref()
        .ok_or_else(|| APIError::new(500, constants::providers::DATABASE_REQUIRED))
}

/// Builds the detail entry: the catalog entry plus its connections and models.
/// Hidden models stay in the list, each carrying the `hidden` flag, so this view
/// is the only place that reports what an operator hid elsewhere.
async fn detail_entry(state: &AppState, provider_id: &str) -> Result<ProviderEntry, APIError> {
    // The models come from the same registry list `/v1/models` serves, unfiltered
    // so a hidden model is still visible, then flagged per entry.
    let metadata = provider_metadata(provider_id)?;
    let connections = provider_connections(state, metadata.id).await?;
    let connected_count = connections.iter().filter(|entry| entry.enabled).count();
    let views = connections
        .iter()
        .map(ProviderConnectionView::from)
        .collect();

    Ok(ProviderEntry::from_metadata(
        metadata,
        stored_enabled(state, metadata.id).await?,
        connected_count,
    )
    .with_details(views, provider_models(state).await?))
}

/// Resolves the path param against the static seed, case-insensitively. Aliases
/// are deliberately not accepted: the catalog holds base ids only.
fn provider_metadata(provider_id: &str) -> Result<ProviderMetadata, APIError> {
    if let Some(metadata) = SEED_PROVIDERS
        .iter()
        .find(|metadata| metadata.id.eq_ignore_ascii_case(provider_id))
    {
        return Ok(*metadata);
    }

    Err(APIError::new(
        404,
        constants::providers::not_found(provider_id),
    ))
}

/// Every advertised model with its hidden and favorite flags. One flag read
/// serves the whole list, so the route never queries per model.
async fn provider_models(state: &AppState) -> Result<Vec<ProviderModel>, APIError> {
    let (hidden, favorites) = catalog_flags(state).await?;

    Ok(state
        .providers
        .list_models()
        .iter()
        .map(|model| ProviderModel::from_model(model, &hidden, &favorites))
        .collect())
}

/// Reads the catalog flags, or empty sets when no database backs the process.
/// Both are expanded to every name the catalog advertises for the model an entry
/// names, so the admin view never shows one id of a model hidden or favorited
/// under another.
async fn catalog_flags(state: &AppState) -> Result<(HashSet<String>, HashSet<String>), APIError> {
    let Some(database) = state.database.as_ref() else {
        return Ok((HashSet::new(), HashSet::new()));
    };

    Ok((
        state.providers.names_of(&hidden_model_ids(database).await?),
        state
            .providers
            .names_of(&favorite_model_ids(database).await?),
    ))
}

/// Builds one catalog entry: the driver's stored enabled flag, its status, and
/// its live connections.
async fn provider_entry(
    state: &AppState,
    metadata: ProviderMetadata,
) -> Result<ProviderEntry, APIError> {
    let connections = provider_connections(state, metadata.id).await?;
    let connected_count = connections.iter().filter(|entry| entry.enabled).count();

    Ok(ProviderEntry::from_metadata(
        metadata,
        stored_enabled(state, metadata.id).await?,
        connected_count,
    ))
}

/// The provider's stored enabled flag. Without a database nothing is switched
/// off, so the catalog still serves every driver as enabled.
async fn stored_enabled(state: &AppState, base_id: &str) -> Result<bool, APIError> {
    match state.database.as_ref() {
        Some(database) => provider_enabled(database, base_id).await,
        None => Ok(true),
    }
}

/// The stored connections of one provider driver. Without a database the
/// catalog still serves, reporting no connections rather than failing.
async fn provider_connections(
    state: &AppState,
    base_id: &str,
) -> Result<Vec<ProviderConnection>, APIError> {
    let Some(database) = state.database.as_ref() else {
        return Ok(Vec::new());
    };

    Ok(list_connections(database)
        .await?
        .into_iter()
        .filter(|connection| connection.base_id_is(base_id))
        .collect())
}
