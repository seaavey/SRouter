//! OpenAI-compatible model catalog: `GET /v1/models` and
//! `GET /v1/models/{*model}`. The registry is static, so the Node `refresh`
//! and `force` query params plus `Cache-Control: no-cache` revalidation are
//! accepted but intentionally no-ops.

use std::collections::HashSet;

use axum::{
    Json,
    extract::{Extension, Path, Query, State},
    http::HeaderMap,
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};

use crate::error::APIError;
use crate::features::api_keys::{APIPrincipal, ensure_model_allowed, is_model_allowed};
use crate::features::providers::ModelObject;
use crate::infrastructure::database::catalog_flags::favorite_model_ids;
use crate::state::AppState;

const MODEL_CACHE_CONTROL: &str = "public, max-age=60, stale-while-revalidate=300";

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
async fn favorites(state: &AppState) -> Result<HashSet<String>, APIError> {
    match state.database.as_ref() {
        Some(database) => favorite_model_ids(database).await,
        None => Ok(HashSet::new()),
    }
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
    let _ = (
        is_refresh_requested(&query),
        revalidation_requested(&headers),
    );

    let allowed = principal
        .as_ref()
        .and_then(|ext| ext.0.api_key.as_ref())
        .and_then(|record| record.allowed_models.as_deref());
    let favorites = favorites(&state).await?;
    let data: Vec<CatalogModel> = state
        .providers
        .list_models()
        .into_iter()
        .filter(|model| allowed.is_none_or(|list| is_model_allowed(Some(list), &model.id)))
        .map(|model| CatalogModel::from_model(&model, &favorites))
        .collect();

    Ok((
        [(axum::http::header::CACHE_CONTROL, MODEL_CACHE_CONTROL)],
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
    let _ = is_refresh_requested(&query);

    if model.trim().is_empty() {
        return Err(APIError::new(400, "Model ID parameter is required"));
    }

    ensure_model_allowed(
        principal.as_ref().and_then(|ext| ext.0.api_key.as_ref()),
        &model,
    )?;

    let models = state.providers.list_models();
    let found = find_model(&models, &model);
    match found {
        Some(entry) => {
            let entry = CatalogModel::from_model(entry, &favorites(&state).await?);
            Ok((
                [(axum::http::header::CACHE_CONTROL, MODEL_CACHE_CONTROL)],
                Json(entry),
            )
                .into_response())
        }
        None => {
            Err(APIError::new(404, format!("Model '{model}' not found"))
                .with_code("model_not_found"))
        }
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
