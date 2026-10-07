//! OpenAI-compatible model catalog: `GET /v1/models` and
//! `GET /v1/models/{*model}`. The `refresh` and `force` query params plus a
//! `Cache-Control: no-cache` revalidation all ask for a catalog fetch; a route
//! whose list is read from upstream waits for that fetch only while it still has
//! no models to serve.

use std::collections::HashSet;

use axum::{
    Json,
    body::Bytes,
    extract::{Extension, Path, Query, State},
    http::HeaderMap,
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::constants;
use crate::error::APIError;
use crate::features::api_keys::{APIPrincipal, ensure_model_allowed_any, is_model_allowed};
use crate::features::providers::ModelObject;
use crate::infrastructure::database::AppDatabase;
use crate::infrastructure::database::catalog_flags::{
    disabled_provider_ids, favorite_model_ids, hidden_model_ids,
};
use crate::infrastructure::database::providers::{
    add_custom_model, add_favorite_model, clear_model_hidden, custom_model_ids_for_provider,
    list_custom_models, remove_custom_model, remove_favorite_model, set_model_hidden,
};
use crate::state::AppState;

#[derive(Debug, Default, Deserialize)]
pub struct ModelsQuery {
    refresh: Option<String>,
    force: Option<String>,
}

#[derive(Debug, Serialize, schemars::JsonSchema)]
pub(crate) struct ModelListResponse {
    object: String,
    data: Vec<CatalogModel>,
}

/// A catalog entry: the OpenAI model fields plus the operator's favorite flag
/// and the custom-model marker Node adds in `MergeCustomModels`.
#[derive(Debug, Serialize, schemars::JsonSchema)]
pub(crate) struct CatalogModel {
    id: String,
    object: String,
    owned_by: String,
    favorite: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    custom: Option<bool>,
}

impl CatalogModel {
    fn from_model(model: &ModelObject, favorites: &HashSet<String>, custom: bool) -> Self {
        Self {
            id: model.id.clone(),
            object: model.object.clone(),
            owned_by: model.owned_by.clone(),
            favorite: favorites.contains(&model.id.to_lowercase()),
            custom: custom.then_some(true),
        }
    }
}

/// Reads the favorite list, or an empty set when no database backs this process.
/// An entry names a model, not one of its ids, so it is expanded to every name
/// the catalog advertises for it.
async fn favorites(state: &AppState) -> Result<HashSet<String>, APIError> {
    match state.database.as_ref() {
        Some(database) => Ok(state
            .providers
            .names_of(&favorite_model_ids(database).await?)),
        None => Ok(HashSet::new()),
    }
}

/// The models this catalog must not serve: hidden ones, and every model of a
/// disabled provider. Both reads happen once per request, never per entry.
#[derive(Default)]
struct CatalogExclusions {
    hidden: HashSet<String>,
    disabled: HashSet<String>,
}

/// Appends the operator's custom models to a catalog list, under their provider
/// alias, and returns the lowercased ids it flagged. Mirrors Node's
/// `MergeCustomModels`: a custom row also marks an already-listed model, so the
/// returned set is built independently of the append.
async fn merge_custom_models(state: &AppState, models: &mut Vec<ModelObject>) -> HashSet<String> {
    let mut custom = HashSet::new();
    let Some(database) = state.database.as_ref() else {
        return custom;
    };
    let Ok(rows) = list_custom_models(database).await else {
        return custom;
    };

    let mut seen: HashSet<String> = models.iter().map(|model| model.id.to_lowercase()).collect();
    for (provider_id, model_id) in rows {
        let Some(alias) = state.providers.alias_of(&provider_id) else {
            continue;
        };
        let id = format!("{alias}/{model_id}");
        let key = id.to_lowercase();
        custom.insert(key.clone());
        if seen.insert(key) {
            models.push(ModelObject::new(id, alias.to_owned()));
        }
    }

    custom
}

impl CatalogExclusions {
    /// A model is dropped when it is hidden by id, or when its provider—via the
    /// id prefix or `owned_by`—is disabled.
    fn excludes(&self, model: &ModelObject) -> bool {
        if self.hidden.contains(&model.id.to_lowercase()) {
            return true;
        }

        let prefix = model.id.split('/').next().unwrap_or(&model.id);

        self.disabled.contains(&prefix.to_lowercase())
            || self.disabled.contains(&model.owned_by.to_lowercase())
    }
}

/// Reads the exclusions, or empty sets when no database backs this process.
async fn catalog_exclusions(state: &AppState) -> Result<CatalogExclusions, APIError> {
    let Some(database) = state.database.as_ref() else {
        return Ok(CatalogExclusions::default());
    };

    Ok(CatalogExclusions {
        // Like a favorite, a hidden entry governs the model under every name it
        // is advertised by, so hiding one id hides them all.
        hidden: state.providers.names_of(&hidden_model_ids(database).await?),
        disabled: state
            .providers
            .disabled_keys(&disabled_provider_ids(database).await?),
    })
}

fn is_refresh_requested(query: &ModelsQuery) -> bool {
    [query.refresh.as_deref(), query.force.as_deref()]
        .into_iter()
        .flatten()
        .any(|value| value == "true" || value == "1")
}

/// Lists every advertised model, filtered by the caller's API-key allowlist.
pub async fn list_models(
    State(state): State<AppState>,
    principal: Option<Extension<APIPrincipal>>,
    Query(query): Query<ModelsQuery>,
    headers: HeaderMap,
) -> Result<Response, APIError> {
    // `refresh`/`force` and a cache revalidation both mean "answer from a
    // freshly fetched catalog", so they break the TTL gate. A route with nothing
    // to serve still waits for the fetch this starts.
    state
        .providers
        .maybe_refresh_catalogs(is_refresh_requested(&query) || revalidation_requested(&headers))
        .await;

    let allowed = principal
        .as_ref()
        .and_then(|ext| ext.0.api_key.as_ref())
        .and_then(|record| record.allowed_models.as_deref());
    let favorites = favorites(&state).await?;
    let exclusions = catalog_exclusions(&state).await?;
    let mut listed = state.providers.list_models();
    let custom = merge_custom_models(&state, &mut listed).await;
    let data: Vec<CatalogModel> = listed
        .into_iter()
        // Drop hidden and disabled models before the allowlist runs, so the
        // allowlist never sees a model this deployment refuses to serve.
        .filter(|model| !exclusions.excludes(model))
        .filter(|model| {
            allowed.is_none_or(|list| {
                state
                    .providers
                    .model_id_variants(&model.id)
                    .iter()
                    .any(|name| is_model_allowed(Some(list), name))
            })
        })
        .map(|model| {
            let is_custom = custom.contains(&model.id.to_lowercase());
            CatalogModel::from_model(&model, &favorites, is_custom)
        })
        .collect();

    Ok((
        [(
            axum::http::header::CACHE_CONTROL,
            constants::headers::value::MODEL_CACHE_CONTROL,
        )],
        Json(ModelListResponse {
            object: String::from("list"),
            data,
        }),
    )
        .into_response())
}

/// Returns a single model by id, or `404` when it is not advertised.
pub async fn get_model(
    State(state): State<AppState>,
    principal: Option<Extension<APIPrincipal>>,
    Path(model): Path<String>,
    Query(query): Query<ModelsQuery>,
) -> Result<Response, APIError> {
    state
        .providers
        .maybe_refresh_catalogs(is_refresh_requested(&query))
        .await;

    if model.trim().is_empty() {
        return Err(APIError::new(400, constants::gateway::MODEL_ID_REQUIRED));
    }

    // A hidden or disabled model is not in the catalog at all, so the single
    // route answers 404 exactly like the list route's omission.
    let exclusions = catalog_exclusions(&state).await?;
    let mut models = state.providers.list_models();
    let custom = merge_custom_models(&state, &mut models).await;
    let found = find_model(&models, &model).filter(|entry| !exclusions.excludes(entry));

    if found.is_none() {
        return Err(
            APIError::new(404, constants::gateway::model_not_found(&model))
                .with_code(constants::code::MODEL_NOT_FOUND),
        );
    }

    ensure_model_allowed_any(
        principal.as_ref().and_then(|ext| ext.0.api_key.as_ref()),
        &state.providers.model_id_variants(&model),
    )?;

    match found {
        Some(entry) => {
            let is_custom = custom.contains(&entry.id.to_lowercase());
            let entry = CatalogModel::from_model(entry, &favorites(&state).await?, is_custom);
            Ok((
                [(
                    axum::http::header::CACHE_CONTROL,
                    constants::headers::value::MODEL_CACHE_CONTROL,
                )],
                Json(entry),
            )
                .into_response())
        }
        None => Err(
            APIError::new(404, constants::gateway::model_not_found(&model))
                .with_code(constants::code::MODEL_NOT_FOUND),
        ),
    }
}

fn revalidation_requested(headers: &HeaderMap) -> bool {
    headers
        .get(axum::http::header::CACHE_CONTROL)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.contains("no-cache") || value.contains("no-store"))
}

/// The provider a model id names, inferred from its `<prefix>/<bare>` shape.
/// `None` when the prefix is not a registered provider or alias.
fn provider_of(state: &AppState, model_id: &str) -> Option<&'static str> {
    let prefix = model_id.trim().split('/').next()?;
    if prefix.is_empty() || !model_id.contains('/') {
        return None;
    }

    state.providers.base_id_of_prefix(prefix)
}

/// The `model_id` (and optional `favorite`/`hidden`) a write body carries.
struct ModelWrite {
    model_id: String,
    favorite: Option<bool>,
    hidden: Option<bool>,
}

fn invalid_model_payload() -> APIError {
    APIError::new(400, constants::providers::favorites::INVALID_PAYLOAD)
}

/// The flags a write body carries. An empty body means "no flags", which is how
/// `PUT` upserts a registration and `PATCH` answers a no-op.
fn parse_model_flags(body: &[u8]) -> Result<(Option<bool>, Option<bool>), APIError> {
    if body.iter().all(u8::is_ascii_whitespace) {
        return Ok((None, None));
    }

    let value: Value = serde_json::from_slice(body).map_err(|_| invalid_model_payload())?;
    let object = value.as_object().ok_or_else(invalid_model_payload)?;

    Ok((
        object.get("favorite").and_then(Value::as_bool),
        object.get("hidden").and_then(Value::as_bool),
    ))
}

/// The write `POST /v1/models` carries: a required `model_id` plus the flags.
fn parse_model_write(body: &[u8]) -> Result<ModelWrite, APIError> {
    let value: Value = serde_json::from_slice(body).map_err(|_| invalid_model_payload())?;
    let object = value.as_object().ok_or_else(invalid_model_payload)?;

    let model_id = object
        .get("model_id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|id| !id.is_empty())
        .map(str::to_owned)
        .ok_or_else(invalid_model_payload)?;
    let (favorite, hidden) = parse_model_flags(body)?;

    Ok(ModelWrite {
        model_id,
        favorite,
        hidden,
    })
}

/// The provider a write targets: the id's own prefix. A bare id is a `400`.
fn target_provider(state: &AppState, write: &ModelWrite) -> Result<&'static str, APIError> {
    provider_of(state, &write.model_id).ok_or_else(invalid_model_payload)
}

/// A model id with its provider prefix removed. Node stores the bare name in the
/// custom-models table (`AddCustomModel`), then re-prefixes it when merging, so a
/// stored id must never keep the prefix it arrived with.
fn bare_id(model_id: &str) -> String {
    match model_id.split_once('/') {
        Some((_, bare)) if !bare.is_empty() => bare.to_owned(),
        _ => model_id.to_owned(),
    }
}

/// `POST /v1/models` — registers a custom model. Provider inferred from the id
/// prefix. `201` on create, `200` when the model was already registered.
pub async fn create_model(
    State(state): State<AppState>,
    body: Bytes,
) -> Result<Response, APIError> {
    let write = parse_model_write(&body)?;
    let base_id = target_provider(&state, &write)?;
    let database = require_models_database(&state)?;

    let existed = is_registered(database, base_id, &write.model_id).await?;
    add_custom_model(database, base_id, &bare_id(&write.model_id)).await?;
    apply_model_flags(&state, &write).await?;

    Ok((
        if existed {
            axum::http::StatusCode::OK
        } else {
            axum::http::StatusCode::CREATED
        },
        Json(model_view(&state, &write.model_id).await?),
    )
        .into_response())
}

/// `PUT /v1/models/{id}` — upserts a custom model. Idempotent.
pub async fn put_model(
    State(state): State<AppState>,
    Path(model_id): Path<String>,
    body: Bytes,
) -> Result<Response, APIError> {
    let (favorite, hidden) = parse_model_flags(&body)?;
    let write = ModelWrite {
        model_id,
        favorite,
        hidden,
    };
    let base_id = target_provider(&state, &write)?;
    let database = require_models_database(&state)?;

    add_custom_model(database, base_id, &bare_id(&write.model_id)).await?;
    apply_model_flags(&state, &write).await?;

    Ok(Json(model_view(&state, &write.model_id).await?).into_response())
}

/// `PATCH /v1/models/{id}` — updates the model's operator state (favorite and
/// hidden) without touching its custom registration.
pub async fn patch_model(
    State(state): State<AppState>,
    Path(model_id): Path<String>,
    body: Bytes,
) -> Result<Response, APIError> {
    let (favorite, hidden) = parse_model_flags(&body)?;
    let write = ModelWrite {
        model_id,
        favorite,
        hidden,
    };
    target_provider(&state, &write)?;
    require_models_database(&state)?;

    apply_model_flags(&state, &write).await?;

    Ok(Json(model_view(&state, &write.model_id).await?).into_response())
}

/// `DELETE /v1/models/{id}` — removes a custom model. `404` when it was not one.
pub async fn delete_model(
    State(state): State<AppState>,
    Path(model_id): Path<String>,
) -> Result<Response, APIError> {
    let base_id = provider_of(&state, &model_id).ok_or_else(invalid_model_payload)?;
    let database = require_models_database(&state)?;

    if !remove_custom_model(database, base_id, &bare_id(&model_id)).await? {
        return Err(
            APIError::new(404, constants::gateway::model_not_found(&model_id))
                .with_code(constants::code::MODEL_NOT_FOUND),
        );
    }

    Ok(Json(serde_json::json!({ "deleted": true })).into_response())
}

fn require_models_database(state: &AppState) -> Result<&AppDatabase, APIError> {
    state
        .database
        .as_ref()
        .ok_or_else(|| APIError::new(500, constants::providers::DATABASE_REQUIRED))
}

/// Whether a custom-model row already exists for this id. Rows hold the bare
/// name, so the prefix is dropped before the comparison.
async fn is_registered(
    database: &AppDatabase,
    base_id: &str,
    model_id: &str,
) -> Result<bool, APIError> {
    let bare = bare_id(model_id);

    Ok(custom_model_ids_for_provider(database, base_id)
        .await?
        .iter()
        .any(|id| id.eq_ignore_ascii_case(&bare)))
}

/// Applies the optional `favorite`/`hidden` flags of a write.
async fn apply_model_flags(state: &AppState, write: &ModelWrite) -> Result<(), APIError> {
    let database = require_models_database(state)?;
    let base_id = target_provider(state, write)?;

    match write.favorite {
        Some(true) => add_favorite_model(database, &write.model_id).await?,
        Some(false) => {
            remove_favorite_model(database, &write.model_id).await?;
        }
        None => {}
    }
    match write.hidden {
        Some(true) => set_model_hidden(database, base_id, &write.model_id).await?,
        Some(false) => {
            clear_model_hidden(database, base_id, &write.model_id).await?;
        }
        None => {}
    }

    Ok(())
}

/// The single-model view a write returns: the catalog entry, or a `404`. Unlike
/// the read routes, a model the write just hid is still described here, so the
/// caller sees the state it asked for.
async fn model_view(state: &AppState, model_id: &str) -> Result<CatalogModel, APIError> {
    let mut listed = state.providers.list_models();
    let custom = merge_custom_models(state, &mut listed).await;
    let favorites = favorites(state).await?;

    listed
        .iter()
        .find(|entry| find_model(std::slice::from_ref(entry), model_id).is_some())
        .map(|entry| {
            let is_custom = custom.contains(&entry.id.to_lowercase());
            CatalogModel::from_model(entry, &favorites, is_custom)
        })
        .ok_or_else(|| {
            APIError::new(404, constants::gateway::model_not_found(model_id))
                .with_code(constants::code::MODEL_NOT_FOUND)
        })
}

/// Matches Node's `GetModelById`: exact match after stripping the `srouter/`
/// prefix, or a match with or without the provider prefix.
fn find_model<'a>(models: &'a [ModelObject], requested: &str) -> Option<&'a ModelObject> {
    let clean = requested.strip_prefix("srouter/").unwrap_or(requested);

    models.iter().find(|entry| {
        let id_clean = entry.id.strip_prefix("srouter/").unwrap_or(&entry.id);

        id_clean == clean
            || entry.id.ends_with(&format!("/{clean}"))
            || clean.ends_with(&format!("/{}", entry.id))
    })
}

#[cfg(test)]
mod tests {
    use super::find_model;
    use crate::features::providers::ModelObject;

    fn models() -> Vec<ModelObject> {
        vec![
            ModelObject::new(String::from("zen/space-bunny-free"), String::from("zen")),
            ModelObject::new(String::from("zen/big-pickle"), String::from("zen")),
        ]
    }

    #[test]
    fn find_model_matches_prefixed_and_bare_ids() {
        let models = models();

        assert_eq!(
            find_model(&models, "zen/space-bunny-free").unwrap().id,
            "zen/space-bunny-free"
        );
        assert_eq!(
            find_model(&models, "space-bunny-free").unwrap().id,
            "zen/space-bunny-free"
        );
        assert_eq!(
            find_model(&models, "srouter/space-bunny-free").unwrap().id,
            "zen/space-bunny-free"
        );
        assert!(find_model(&models, "does-not-exist").is_none());
    }
}
