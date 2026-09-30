//! OpenAI-compatible model catalog: `GET /v1/models` and
//! `GET /v1/models/{*model}`. The `refresh` and `force` query params plus a
//! `Cache-Control: no-cache` revalidation all ask for a catalog fetch; a route
//! whose list is read from upstream waits for that fetch only while it still has
//! no models to serve.

use std::collections::HashSet;

use axum::{
    Json,
    extract::{Extension, Path, Query, State},
    http::HeaderMap,
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};

use crate::constants;
use crate::error::APIError;
use crate::features::api_keys::{APIPrincipal, ensure_model_allowed_any, is_model_allowed};
use crate::features::providers::ModelObject;
use crate::infrastructure::database::catalog_flags::{
    disabled_provider_ids, favorite_model_ids, hidden_model_ids,
};
use crate::state::AppState;

#[derive(Debug, Default, Deserialize)]
pub struct ModelsQuery {
    refresh: Option<String>,
    force: Option<String>,
}

#[derive(Debug, Serialize)]
struct ModelListResponse {
    object: String,
    data: Vec<CatalogModel>,
}

/// A catalog entry: the OpenAI model fields plus the operator's favorite flag.
#[derive(Debug, Serialize)]
struct CatalogModel {
    id: String,
    object: String,
    owned_by: String,
    favorite: bool,
}

impl CatalogModel {
    fn from_model(model: &ModelObject, favorites: &HashSet<String>) -> Self {
        Self {
            id: model.id.clone(),
            object: model.object.clone(),
            owned_by: model.owned_by.clone(),
            favorite: favorites.contains(&model.id.to_lowercase()),
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
    let data: Vec<CatalogModel> = state
        .providers
        .list_models()
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
        .map(|model| CatalogModel::from_model(&model, &favorites))
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
    let models = state.providers.list_models();
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
            let entry = CatalogModel::from_model(entry, &favorites(&state).await?);
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
