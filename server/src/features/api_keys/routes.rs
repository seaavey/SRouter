//! `/v1/keys` management routes. Every route requires an admin session (the
//! layer is applied by the composition root). Responses mirror the Node
//! controller; the full secret is returned only on creation because schema v2
//! stores just its hash and a display prefix.

use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, patch, post};
use axum::{Json, Router};
use serde::Serialize;
use serde_json::Value;

use crate::error::APIError;
use crate::features::api_keys::model::{
    APIKey, CreateAPIKeyInput, CreatedAPIKey, UpdateAPIKeyInput,
};
use crate::state::AppState;

const INVALID_KEY_PAYLOAD: &str = "Invalid API key payload";
const INVALID_CREDIT_PAYLOAD: &str = "Invalid credit payload";
const DELETE_MESSAGE: &str = "API Key revoked and deleted successfully";

/// Mounts the key-management routes. The compatibility alias `/v1/v1` does not
/// include them (only chat, messages, and models).
pub fn create_api_keys_router() -> Router<AppState> {
    Router::new()
        .route("/keys", get(list_keys).post(create_key))
        .route("/keys/{id}", patch(update_key).delete(delete_key))
        .route("/keys/{id}/credit", post(add_credit))
}

async fn list_keys(State(state): State<AppState>) -> Result<Json<KeyListResponse>, APIError> {
    let keys = state.security.key_repository.list().await?;

    Ok(Json(KeyListResponse {
        object: "list",
        data: keys.iter().map(APIKeyResponse::from).collect(),
    }))
}

async fn create_key(State(state): State<AppState>, body: Bytes) -> Result<Response, APIError> {
    let input = parse_create_input(&body)?;
    let created = state.security.key_repository.create(input).await?;

    Ok((
        StatusCode::CREATED,
        Json(CreatedAPIKeyResponse::from(&created)),
    )
        .into_response())
}

async fn update_key(
    State(state): State<AppState>,
    Path(id): Path<String>,
    body: Bytes,
) -> Result<Response, APIError> {
    let patch = parse_update_input(&body)?;

    match state.security.key_repository.update(&id, patch).await? {
        Some(key) => Ok(Json(APIKeyResponse::from(&key)).into_response()),
        None => Err(not_found(&id)),
    }
}

async fn add_credit(
    State(state): State<AppState>,
    Path(id): Path<String>,
    body: Bytes,
) -> Result<Response, APIError> {
    let amount = parse_credit_amount(&body)?;

    match state
        .security
        .key_repository
        .add_credit(&id, amount)
        .await?
    {
        Some(key) => Ok(Json(APIKeyResponse::from(&key)).into_response()),
        None => Err(not_found(&id)),
    }
}

async fn delete_key(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Response, APIError> {
    if state.security.key_repository.delete(&id).await? {
        Ok(Json(serde_json::json!({ "message": DELETE_MESSAGE })).into_response())
    } else {
        Err(not_found(&id))
    }
}

fn not_found(id: &str) -> APIError {
    APIError::new(404, format!("Key '{id}' not found"))
}

#[derive(Serialize)]
struct KeyListResponse {
    object: &'static str,
    data: Vec<APIKeyResponse>,
}

/// Management representation. `key_prefix` is the non-secret display prefix;
/// the full secret is never stored, so it never appears here.
#[derive(Serialize)]
struct APIKeyResponse {
    id: String,
    key_prefix: String,
    name: String,
    enabled: bool,
    rate_limit: u32,
    quota_limit: u32,
    usage_tokens: u64,
    credit_limit: f64,
    usage_cost: f64,
    allowed_models: Option<Vec<String>>,
    created_at: i64,
}

impl From<&APIKey> for APIKeyResponse {
    fn from(key: &APIKey) -> Self {
        Self {
            id: key.id.clone(),
            key_prefix: key.key_prefix.clone(),
            name: key.name.clone(),
            enabled: key.enabled,
            rate_limit: key.rate_limit,
            quota_limit: key.quota_limit,
            usage_tokens: key.usage_tokens,
            credit_limit: key.credit_limit,
            usage_cost: key.usage_cost,
            allowed_models: key.allowed_models.clone(),
            created_at: key.created_at,
        }
    }
}

/// Creation response: the management fields plus the one-time full secret.
#[derive(Serialize)]
struct CreatedAPIKeyResponse {
    #[serde(flatten)]
    api_key: APIKeyResponse,
    key: String,
}

impl From<&CreatedAPIKey> for CreatedAPIKeyResponse {
    fn from(created: &CreatedAPIKey) -> Self {
        Self {
            api_key: APIKeyResponse::from(&created.key),
            key: created.secret.clone(),
        }
    }
}

fn parse_create_input(body: &[u8]) -> Result<CreateAPIKeyInput, APIError> {
    let value: Value = parse_json(body, INVALID_KEY_PAYLOAD)?;
    let object = value
        .as_object()
        .ok_or_else(|| APIError::new(400, INVALID_KEY_PAYLOAD))?;

    let name = match object.get("name") {
        Some(Value::String(raw)) if !raw.is_empty() => raw.trim().to_owned(),
        Some(Value::String(_)) => {
            return Err(APIError::new(400, "Field 'name' cannot be empty"));
        }
        Some(_) => return Err(APIError::new(400, INVALID_KEY_PAYLOAD)),
        None => return Err(APIError::new(400, "Field 'name' is required")),
    };

    Ok(CreateAPIKeyInput {
        name,
        enabled: optional_bool(object, "enabled")?.unwrap_or(true),
        rate_limit: optional_count(object, "rate_limit")?.unwrap_or(0),
        quota_limit: optional_count(object, "quota_limit")?.unwrap_or(0),
        credit_limit: optional_credit(object, "credit_limit")?.unwrap_or(0.0),
        allowed_models: parse_allowlist(object.get("allowed_models"))?.flatten(),
    })
}

fn parse_update_input(body: &[u8]) -> Result<UpdateAPIKeyInput, APIError> {
    let value: Value = parse_json(body, INVALID_KEY_PAYLOAD)?;
    let object = value
        .as_object()
        .ok_or_else(|| APIError::new(400, INVALID_KEY_PAYLOAD))?;

    let name = match object.get("name") {
        None => None,
        Some(Value::String(name)) => {
            if name.is_empty() {
                return Err(APIError::new(400, "Field 'name' cannot be empty"));
            }

            Some(name.trim().to_owned())
        }
        Some(_) => return Err(APIError::new(400, INVALID_KEY_PAYLOAD)),
    };

    Ok(UpdateAPIKeyInput {
        name,
        enabled: optional_bool(object, "enabled")?,
        rate_limit: optional_count(object, "rate_limit")?,
        quota_limit: optional_count(object, "quota_limit")?,
        credit_limit: optional_credit(object, "credit_limit")?,
        allowed_models: parse_allowlist(object.get("allowed_models"))?,
    })
}

fn parse_credit_amount(body: &[u8]) -> Result<f64, APIError> {
    let value: Value = parse_json(body, INVALID_CREDIT_PAYLOAD)?;
    let amount = value
        .get("amount")
        .and_then(Value::as_f64)
        .ok_or_else(|| APIError::new(400, "Field 'amount' is required"))?;

    if amount <= 0.0 {
        return Err(APIError::new(400, "Amount must be greater than 0"));
    }

    Ok(amount)
}

fn parse_json(body: &[u8], message: &str) -> Result<Value, APIError> {
    serde_json::from_slice(body).map_err(|_| APIError::new(400, message))
}

fn optional_bool(
    object: &serde_json::Map<String, Value>,
    field: &str,
) -> Result<Option<bool>, APIError> {
    match object.get(field) {
        None => Ok(None),
        Some(Value::Bool(value)) => Ok(Some(*value)),
        Some(_) => Err(APIError::new(400, INVALID_KEY_PAYLOAD)),
    }
}

/// A non-negative integer count (`rate_limit`, `quota_limit`). Fractional or
/// out-of-range values are rejected like the Node schema's `.int().nonnegative()`.
fn optional_count(
    object: &serde_json::Map<String, Value>,
    field: &str,
) -> Result<Option<u32>, APIError> {
    let Some(raw) = object.get(field) else {
        return Ok(None);
    };
    let number = raw
        .as_f64()
        .filter(|number| number.is_finite() && *number >= 0.0 && number.fract() == 0.0)
        .ok_or_else(|| APIError::new(400, INVALID_KEY_PAYLOAD))?;

    u32::try_from(number as i64)
        .map(Some)
        .map_err(|_| APIError::new(400, INVALID_KEY_PAYLOAD))
}

fn optional_credit(
    object: &serde_json::Map<String, Value>,
    field: &str,
) -> Result<Option<f64>, APIError> {
    match object.get(field) {
        None => Ok(None),
        Some(raw) => raw
            .as_f64()
            .filter(|number| number.is_finite() && *number >= 0.0)
            .map(Some)
            .ok_or_else(|| APIError::new(400, INVALID_KEY_PAYLOAD)),
    }
}

/// `None` = field absent, `Some(None)` = explicit null (unrestricted),
/// `Some(Some(list))` = a populated allowlist.
fn parse_allowlist(raw: Option<&Value>) -> Result<Option<Option<Vec<String>>>, APIError> {
    let Some(raw) = raw else {
        return Ok(None);
    };

    match raw {
        Value::Null => Ok(Some(None)),
        Value::Array(items) => {
            let models = items
                .iter()
                .map(|item| match item {
                    Value::String(model) if !model.is_empty() => Ok(model.clone()),
                    _ => Err(APIError::new(400, INVALID_KEY_PAYLOAD)),
                })
                .collect::<Result<Vec<String>, APIError>>()?;

            Ok(Some(Some(models)))
        }
        _ => Err(APIError::new(400, INVALID_KEY_PAYLOAD)),
    }
}

#[cfg(test)]
mod tests {
    use super::{parse_create_input, parse_credit_amount, parse_update_input};

    #[test]
    fn create_applies_defaults_and_ignores_unknown_fields() {
        let body = br#"{"name":"  Client Key  ","extra":true}"#;
        let input = parse_create_input(body).unwrap();

        assert_eq!(input.name, "Client Key");
        assert!(input.enabled);
        assert_eq!(input.rate_limit, 0);
        assert_eq!(input.quota_limit, 0);
        assert_eq!(input.credit_limit, 0.0);
        assert_eq!(input.allowed_models, None);
    }

    #[test]
    fn create_rejects_a_missing_or_empty_name() {
        assert_eq!(parse_create_input(br#"{}"#).unwrap_err().status(), 400);
        assert_eq!(
            parse_create_input(br#"{"name":""}"#).unwrap_err().status(),
            400
        );
    }

    #[test]
    fn create_rejects_negative_and_fractional_counts() {
        assert!(parse_create_input(br#"{"name":"k","rate_limit":-1}"#).is_err());
        assert!(parse_create_input(br#"{"name":"k","quota_limit":1.5}"#).is_err());
        assert!(parse_create_input(br#"{"name":"k","enabled":"yes"}"#).is_err());
    }

    #[test]
    fn create_accepts_a_null_or_populated_allowlist() {
        let unrestricted = parse_create_input(br#"{"name":"k","allowed_models":null}"#).unwrap();
        let restricted =
            parse_create_input(br#"{"name":"k","allowed_models":["gpt-4o"]}"#).unwrap();

        assert_eq!(unrestricted.allowed_models, None);
        assert_eq!(restricted.allowed_models, Some(vec!["gpt-4o".to_owned()]));
        assert!(parse_create_input(br#"{"name":"k","allowed_models":[""]}"#).is_err());
    }

    #[test]
    fn update_distinguishes_absent_from_explicit_null() {
        let empty = parse_update_input(br#"{}"#).unwrap();
        assert_eq!(empty.allowed_models, None);

        let cleared = parse_update_input(br#"{"allowed_models":null}"#).unwrap();
        assert_eq!(cleared.allowed_models, Some(None));

        let listed = parse_update_input(br#"{"allowed_models":["gpt-4o"]}"#).unwrap();
        assert_eq!(listed.allowed_models, Some(Some(vec!["gpt-4o".to_owned()])));
    }

    #[test]
    fn credit_requires_a_positive_amount() {
        assert_eq!(parse_credit_amount(br#"{"amount":15}"#).unwrap(), 15.0);
        assert!(parse_credit_amount(br#"{"amount":0}"#).is_err());
        assert!(parse_credit_amount(br#"{"amount":-5}"#).is_err());
        assert!(parse_credit_amount(br#"{}"#).is_err());
    }
}
