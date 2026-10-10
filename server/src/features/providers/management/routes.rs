//! `/v1/providers` management routes. Reads are served from the static provider
//! seed plus the stored custom providers; the enabled flag and the
//! hidden/favorite flags come from the database when one is wired in. The
//! provider-level write is a single `PATCH /providers/{provider_id}` that edits
//! a built-in driver's flags or a custom provider's connection fields; every
//! model-level operation lives under `/v1/models`.
//!
//! Create, delete, and the two verify probes live in [`super::custom_routes`],
//! because they are the write half only a custom provider needs.

use std::collections::HashSet;

use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::routing::{get, patch};
use axum::{Json, Router};
use serde::Serialize;
use serde_json::Value;

use crate::constants;
use crate::error::APIError;
use crate::features::catalog::merge_custom_models;
use crate::features::providers::custom::refresh_custom_provider;
use crate::features::providers::management::model::{
    CatalogResponse, GroupedCatalog, ProviderConnectionView, ProviderEntry, ProviderModel,
};
use crate::features::providers::rotation::round_robin_enabled;
use crate::features::providers::{ProviderMetadata, SEED_PROVIDERS};
use crate::infrastructure::database::AppDatabase;
use crate::infrastructure::database::catalog_flags::{favorite_model_ids, hidden_model_ids};
use crate::infrastructure::database::providers::{
    CustomProviderRow, NewCustomProvider, ProviderConnection, ProviderPatch, apply_provider_patch,
    create_custom_provider, find_custom_provider, list_connections, list_custom_providers,
    load_custom_credentials, matches_base_id, provider_enabled,
};
use crate::infrastructure::database::settings::set_setting;
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
/// The provider `PATCH` carries the provider-level edits: the enabled flag and
/// the model flags for a built-in driver, or the connection fields for a custom
/// provider. Every model-level operation lives under `/v1/models`.
pub fn create_providers_management_router() -> Router<AppState> {
    Router::new()
        .route("/providers/{provider_id}", patch(patch_provider))
        .route(
            "/providers/{provider_id}/round-robin",
            patch(patch_round_robin),
        )
}

#[derive(Serialize, specta::Type)]
pub(crate) struct ProviderListResponse {
    object: &'static str,
    data: Vec<ProviderEntry>,
}

/// A provider the routes can resolve: a compiled-in driver or a stored custom
/// provider.
enum ProviderTarget {
    Seed(ProviderMetadata),
    Custom(CustomProviderRow),
}

impl ProviderTarget {
    fn id(&self) -> &str {
        match self {
            Self::Seed(metadata) => metadata.id,
            Self::Custom(row) => &row.id,
        }
    }
}

async fn list_providers(
    State(state): State<AppState>,
) -> Result<Json<ProviderListResponse>, APIError> {
    let mut data = Vec::with_capacity(SEED_PROVIDERS.len());
    for metadata in SEED_PROVIDERS {
        data.push(provider_entry(&state, *metadata).await?);
    }
    for row in custom_rows(&state).await? {
        data.push(custom_entry(&state, &row).await?);
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
    for row in custom_rows(&state).await? {
        providers.push(custom_entry(&state, &row).await?);
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

/// Edits one provider in place. A built-in driver takes the enabled flag plus
/// the hidden and favorite state of individual models; a custom provider takes
/// the connection fields (name, prefix, protocol, base URL, API key). Every field
/// is optional, so the catalog page needs exactly one write route.
async fn patch_provider(
    State(state): State<AppState>,
    Path(provider_id): Path<String>,
    body: Bytes,
) -> Result<Json<ProviderEntry>, APIError> {
    let database = require_database(&state)?;

    let Some(target) = resolve_target(&state, &provider_id).await? else {
        return Err(APIError::new(
            400,
            constants::providers::not_found(&provider_id),
        ));
    };

    match target {
        ProviderTarget::Seed(metadata) => {
            let patch = parse_provider_patch(&body)?;
            apply_provider_patch(database, metadata.id, &patch).await?;

            // Read back after the write, so the response reports the stored
            // state rather than what the request asked for.
            Ok(Json(detail_entry(&state, metadata.id).await?))
        }
        ProviderTarget::Custom(row) => {
            let edit = parse_custom_edit(&body)?;
            // The enabled flag still rides the same route for a custom provider,
            // so a body naming only `enabled` is valid here.
            let patch = parse_provider_patch(&body).ok();

            if edit.is_empty() && patch.is_none() {
                return Err(invalid_patch_payload());
            }

            if !edit.is_empty() {
                apply_custom_edit(database, &row, &edit).await?;
                refresh_custom_provider(&state.providers, database, &row.id).await?;
            }
            if let Some(patch) = patch {
                apply_provider_patch(database, &row.id, &patch).await?;
            }

            Ok(Json(detail_entry(&state, &row.id).await?))
        }
    }
}

/// Toggles rotation for one provider. `{enabled: bool}` in, the provider detail
/// out, mirroring Node's `ToggleRoundRobin`: an unknown provider or a malformed
/// body is a `400` rather than a silent no-op.
async fn patch_round_robin(
    State(state): State<AppState>,
    Path(provider_id): Path<String>,
    body: Bytes,
) -> Result<Json<ProviderEntry>, APIError> {
    let enabled = parse_round_robin_toggle(&body)?;
    let database = require_database(&state)?;
    let Some(target) = resolve_target(&state, &provider_id).await? else {
        return Err(APIError::new(
            400,
            constants::providers::not_found(&provider_id),
        ));
    };
    let base_id = target.id().to_owned();

    set_setting(
        database,
        &format!("round_robin_{base_id}"),
        if enabled { "true" } else { "false" },
    )
    .await?;

    Ok(Json(detail_entry(&state, &base_id).await?))
}

/// Reads `{enabled: bool}`. Only a real boolean is accepted, so `"yes"` and `1`
/// cannot flip a provider.
fn parse_round_robin_toggle(body: &[u8]) -> Result<bool, APIError> {
    let value: Value = serde_json::from_slice(body).map_err(|_| invalid_patch_payload())?;

    value
        .get("enabled")
        .and_then(Value::as_bool)
        .ok_or_else(invalid_patch_payload)
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

/// The connection fields an edit of a custom provider may carry.
#[derive(Debug, Default)]
struct CustomEdit {
    name: Option<String>,
    prefix: Option<String>,
    protocol: Option<String>,
    base_url: Option<String>,
    api_key: Option<String>,
    /// Whether the body named `api_key` at all: an explicit empty string clears
    /// the stored key, an absent one keeps it.
    has_api_key: bool,
    custom_headers: Vec<(String, String)>,
    has_custom_headers: bool,
}

impl CustomEdit {
    fn is_empty(&self) -> bool {
        self.name.is_none()
            && self.prefix.is_none()
            && self.protocol.is_none()
            && self.base_url.is_none()
            && !self.has_api_key
            && !self.has_custom_headers
    }
}

/// Reads the custom-provider fields out of a `PATCH` body.
fn parse_custom_edit(body: &[u8]) -> Result<CustomEdit, APIError> {
    let value: Value = serde_json::from_slice(body).map_err(|_| invalid_patch_payload())?;
    let object = value.as_object().ok_or_else(invalid_patch_payload)?;

    let text = |key: &str| {
        object
            .get(key)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_owned)
    };

    let has_api_key = object.contains_key("api_key");
    let has_custom_headers = object.contains_key("custom_headers");
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

    Ok(CustomEdit {
        name: text("name"),
        // An empty prefix clears it, so the raw string is kept here. `alias`
        // is the legacy key the Node contract and the web form still send.
        prefix: object
            .get("prefix")
            .or_else(|| object.get("alias"))
            .and_then(Value::as_str)
            .map(str::to_owned),
        protocol: text("protocol"),
        base_url: text("base_url"),
        api_key: text("api_key"),
        has_api_key,
        custom_headers,
        has_custom_headers,
    })
}

/// Applies a custom-provider edit. The credential blob is replaced whole, so an
/// absent `api_key` keeps the stored one and an explicit empty string clears it.
async fn apply_custom_edit(
    database: &AppDatabase,
    row: &CustomProviderRow,
    edit: &CustomEdit,
) -> Result<(), APIError> {
    let name = edit.name.clone().unwrap_or_else(|| row.name.clone());
    let prefix = match &edit.prefix {
        Some(prefix) if prefix.trim().is_empty() => None,
        Some(prefix) => Some(prefix.clone()),
        None => row.prefix.clone(),
    };
    let protocol = match &edit.protocol {
        Some(protocol) => {
            if !is_provider_protocol(protocol) {
                return Err(APIError::new(400, "Invalid provider protocol"));
            }
            protocol.clone()
        }
        None => row.protocol.clone(),
    };
    let base_url = edit
        .base_url
        .clone()
        .unwrap_or_else(|| row.base_url.clone());

    let stored = load_custom_credentials(database, &row.id).await?;
    let api_key = if edit.has_api_key {
        edit.api_key.clone()
    } else {
        stored
            .as_ref()
            .and_then(|credentials| credentials.api_key.clone())
    };
    let custom_headers = if edit.has_custom_headers {
        edit.custom_headers.clone()
    } else {
        stored
            .map(|credentials| credentials.custom_headers)
            .unwrap_or_default()
    };

    create_custom_provider(
        database,
        &row.id,
        &NewCustomProvider {
            name,
            prefix,
            protocol,
            base_url,
            api_key,
            custom_headers,
        },
    )
    .await
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
/// `<base>_`/`<base>-` namespaced variant of it. A custom provider id is a UUID
/// and passes through untouched.
fn base_id_of(provider_id: &str) -> &str {
    for metadata in SEED_PROVIDERS {
        if matches_base_id(provider_id, metadata.id) {
            return metadata.id;
        }
    }

    provider_id
}

/// Resolves a path param against the compiled-in drivers first, then the stored
/// custom providers. Aliases are not accepted: the catalog holds base ids only.
/// A seed connection id collapses onto its driver, matching the old behavior.
async fn resolve_target(
    state: &AppState,
    provider_id: &str,
) -> Result<Option<ProviderTarget>, APIError> {
    let normalized = provider_id.to_lowercase();
    let base_id = base_id_of(&normalized);

    if let Some(metadata) = SEED_PROVIDERS
        .iter()
        .find(|metadata| metadata.id == base_id)
    {
        return Ok(Some(ProviderTarget::Seed(*metadata)));
    }

    if let Some(database) = state.database.as_ref()
        && let Some(row) = find_custom_provider(database, &normalized).await?
    {
        return Ok(Some(ProviderTarget::Custom(row)));
    }

    // An id that names neither a driver nor a stored custom provider.
    Ok(None)
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
    let models = provider_models(state).await?;

    let Some(target) = resolve_target(state, provider_id).await? else {
        return Err(APIError::new(
            404,
            constants::providers::not_found(provider_id),
        ));
    };

    match target {
        ProviderTarget::Seed(metadata) => {
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
            .with_round_robin(stored_round_robin(state, metadata.id).await)
            .with_details(views, models))
        }
        ProviderTarget::Custom(row) => {
            let connections = provider_connections(state, &row.id).await?;
            let connected_count = connections.iter().filter(|entry| entry.enabled).count();
            let views = connections
                .iter()
                .map(ProviderConnectionView::from)
                .collect();

            Ok(ProviderEntry::from_custom(&row, connected_count)
                .with_round_robin(stored_round_robin(state, &row.id).await)
                .with_details(views, models))
        }
    }
}

/// The stored rotation flag for one provider, read through the same helper the
/// executor uses so the payload and the runtime cannot disagree.
async fn stored_round_robin(state: &AppState, base_id: &str) -> bool {
    match state.database.as_ref() {
        Some(database) => round_robin_enabled(database, base_id).await,
        None => true,
    }
}

/// Every advertised model with its hidden and favorite flags. One flag read
/// serves the whole list, so the route never queries per model. The operator's
/// custom models are merged in first, so the detail view shows them the way
/// `GET /v1/models` and Node's `GetProviderById` do.
async fn provider_models(state: &AppState) -> Result<Vec<ProviderModel>, APIError> {
    let (hidden, favorites) = catalog_flags(state).await?;
    // `merge_custom_models` reports which ids are custom, but the detail view
    // carries no `custom` flag, so the return value is not needed here.
    let mut models = state.providers.list_models();
    merge_custom_models(state, &mut models).await;

    Ok(models
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

/// The stored custom providers, or none when no database backs the process.
async fn custom_rows(state: &AppState) -> Result<Vec<CustomProviderRow>, APIError> {
    match state.database.as_ref() {
        Some(database) => list_custom_providers(database).await,
        None => Ok(Vec::new()),
    }
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
    )
    .with_round_robin(stored_round_robin(state, metadata.id).await))
}

/// Builds one catalog entry for a stored custom provider.
async fn custom_entry(
    state: &AppState,
    row: &CustomProviderRow,
) -> Result<ProviderEntry, APIError> {
    let connections = provider_connections(state, &row.id).await?;
    let connected_count = connections.iter().filter(|entry| entry.enabled).count();

    Ok(ProviderEntry::from_custom(row, connected_count)
        .with_round_robin(stored_round_robin(state, &row.id).await))
}

/// The protocol check shared by the create and edit paths.
/// Only the three protocols the build actually serves are accepted; `parse`
/// falls an unknown value back to `openai`, so the string is checked directly.
fn is_provider_protocol(protocol: &str) -> bool {
    matches!(
        protocol.trim().to_lowercase().as_str(),
        "openai" | "anthropic" | "custom"
    )
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
