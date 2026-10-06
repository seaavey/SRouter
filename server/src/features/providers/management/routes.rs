//! `/v1/providers` management routes. Reads are served from the static provider
//! seed plus the stored connections; the enabled flag and the hidden/favorite
//! flags come from the database when one is wired in. Every write goes through a
//! single `PATCH /providers/{provider_id}`, and no route lists hidden models on
//! its own: the detail response is where those flags are read.

use std::collections::HashSet;

use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, patch, post};
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
use crate::infrastructure::database::catalog_flags::{
    favorite_model_ids, hidden_model_ids, hidden_model_ids_for_provider, list_favorite_model_ids,
};
use crate::infrastructure::database::providers::{
    ProviderConnection, ProviderPatch, add_favorite_model, apply_provider_patch,
    clear_model_hidden, list_connections, matches_base_id, provider_enabled, provider_exists,
    remove_favorite_model, set_model_hidden,
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
        // Node keeps these reads under the provider/favorites routers with the
        // same API-key guard as the rest of this surface.
        .route(
            "/providers/{provider_id}/hidden-models",
            get(list_hidden_models),
        )
        .route("/favorites", get(list_favorites))
}

/// Mutation routes. The composition root layers the admin-session guard on top,
/// matching the Node router, which requires `RequireAdmin` for every write.
/// One `PATCH` carries every edit the catalog page can make; the favorites and
/// hidden-models routes are the single-model surface the web client calls.
pub fn create_providers_management_router() -> Router<AppState> {
    Router::new()
        .route("/providers/{provider_id}", patch(patch_provider))
        .route(
            "/providers/{provider_id}/hidden-models",
            post(hide_model_route),
        )
        .route(
            "/providers/{provider_id}/hidden-models/{model_id}",
            delete(restore_model_route),
        )
        .route("/favorites", post(add_favorite_route))
        .route("/favorites/{model_id}", delete(remove_favorite_route))
}

#[derive(Serialize)]
struct ProviderListResponse {
    object: &'static str,
    data: Vec<ProviderEntry>,
}

/// `{ "models": [...] }`, the shape both `/v1/favorites` and the hidden-models
/// list return.
#[derive(Serialize)]
struct HiddenModelsResponse {
    models: Vec<String>,
}

/// `{ "message": "..." }`, the shape the single-model writes return.
#[derive(Serialize)]
struct MessageResponse {
    message: &'static str,
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

/// The body of a single-model write (`model_id`), matching Node's
/// `AddCustomModelSchema`.
fn parse_model_id_body(body: &[u8], invalid: &'static str) -> Result<String, APIError> {
    let value: Value = serde_json::from_slice(body).map_err(|_| APIError::new(400, invalid))?;
    value
        .get("model_id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|model_id| !model_id.is_empty())
        .map(str::to_owned)
        .ok_or_else(|| APIError::new(400, invalid))
}

/// `GET /v1/providers/:id/hidden-models` — Node returns `{models:[...]}` for the
/// provider's hidden ids. The provider normalizes to its base id, so a
/// connection id reads the rows the patch wrote.
async fn list_hidden_models(
    State(state): State<AppState>,
    Path(provider_id): Path<String>,
) -> Result<Json<HiddenModelsResponse>, APIError> {
    let database = require_database(&state)?;
    let normalized = provider_id.to_lowercase();
    let base_id = base_id_of(&normalized);

    Ok(Json(HiddenModelsResponse {
        models: hidden_model_ids_for_provider(database, base_id).await?,
    }))
}

/// `POST /v1/providers/:id/hidden-models` — hides one model, `201`.
async fn hide_model_route(
    State(state): State<AppState>,
    Path(provider_id): Path<String>,
    body: Bytes,
) -> Result<Response, APIError> {
    let model_id =
        parse_model_id_body(&body, constants::providers::hidden_models::INVALID_PAYLOAD)?;
    let database = require_database(&state)?;
    let normalized = provider_id.to_lowercase();
    let base_id = base_id_of(&normalized);

    set_model_hidden(database, base_id, &model_id).await?;

    Ok((
        StatusCode::CREATED,
        Json(MessageResponse {
            message: constants::providers::hidden_models::HIDDEN,
        }),
    )
        .into_response())
}

/// `DELETE /v1/providers/:id/hidden-models/:modelId` — restores one model, `404`
/// when it was not hidden, matching Node.
async fn restore_model_route(
    State(state): State<AppState>,
    Path((provider_id, model_id)): Path<(String, String)>,
) -> Result<Json<MessageResponse>, APIError> {
    let database = require_database(&state)?;
    let normalized = provider_id.to_lowercase();
    let base_id = base_id_of(&normalized);
    let model_id = decode_path_segment(&model_id);

    if !clear_model_hidden(database, base_id, &model_id).await? {
        return Err(APIError::new(
            404,
            constants::providers::hidden_models::not_found(&provider_id, &model_id),
        ));
    }

    Ok(Json(MessageResponse {
        message: constants::providers::hidden_models::RESTORED,
    }))
}

/// `GET /v1/favorites` — Node returns `{models:[...]}`.
async fn list_favorites(
    State(state): State<AppState>,
) -> Result<Json<HiddenModelsResponse>, APIError> {
    let database = require_database(&state)?;

    Ok(Json(HiddenModelsResponse {
        models: list_favorite_model_ids(database).await?,
    }))
}

/// `POST /v1/favorites` — adds one favorite, `201`.
async fn add_favorite_route(
    State(state): State<AppState>,
    body: Bytes,
) -> Result<Response, APIError> {
    let model_id = parse_model_id_body(&body, constants::providers::favorites::INVALID_PAYLOAD)?;
    let database = require_database(&state)?;

    add_favorite_model(database, &model_id).await?;

    Ok((
        StatusCode::CREATED,
        Json(MessageResponse {
            message: constants::providers::favorites::ADDED,
        }),
    )
        .into_response())
}

/// `DELETE /v1/favorites/:modelId` — removes one favorite, `404` when it was not
/// one, matching Node.
async fn remove_favorite_route(
    State(state): State<AppState>,
    Path(model_id): Path<String>,
) -> Result<Json<MessageResponse>, APIError> {
    let database = require_database(&state)?;
    let model_id = decode_path_segment(&model_id);

    if !remove_favorite_model(database, &model_id).await? {
        return Err(APIError::new(
            404,
            constants::providers::favorites::NOT_FOUND,
        ));
    }

    Ok(Json(MessageResponse {
        message: constants::providers::favorites::REMOVED,
    }))
}

/// Percent-decodes a path segment, because a model id can carry a slash or other
/// reserved characters the client encoded.
fn decode_path_segment(value: &str) -> String {
    url::form_urlencoded::parse(value.as_bytes())
        .map(|(key, _)| key.into_owned())
        .next()
        .unwrap_or_else(|| value.to_owned())
}
