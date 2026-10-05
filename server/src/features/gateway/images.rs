//! Image generation gateway: `POST /v1/images/generations`.
//!
//! Handles OpenAI-compatible image generation requests:
//! validates payload against frozen constraints, checks image capability,
//! verifies API key model allowlist, resolves provider, executes generation,
//! logs the request, and tracks API key usage.

use axum::{
    Json,
    extract::{Extension, Request, State},
    response::{IntoResponse, Response},
};
use serde_json::Value;

use crate::constants;
use crate::error::APIError;
use crate::features::api_keys::{APIPrincipal, ensure_model_allowed_any};
use crate::features::gateway::RequestLogContext;
use crate::features::gateway::interception::{
    body_error_to_api_error, log_request, read_json_body,
};
use crate::protocol::image::ImageGenerationRequest;
use crate::protocol::usage::UsageBreakdown;
use crate::state::AppState;

const TEXT_ONLY_PATTERNS: &[&str] = &[
    "chat", "gpt-4o", "gpt-4-", "gpt-3.5", "claude", "deepseek", "qwen", "llama", "mistral",
    "gemini", "o1", "o3",
];

const IMAGE_PATTERNS: &[&str] = &[
    "image",
    "dall-e",
    "dalle",
    "flux",
    "midjourney",
    "stable-diffusion",
    "sdxl",
    "imagen",
    "recraft",
    "ideogram",
];

const IMAGE_EDIT_PATTERNS: &[&str] = &["dall-e-2", "edit", "inpaint"];

/// Parses and validates the raw JSON body for image generation.
pub fn parse_image_request(body: Value) -> Result<ImageGenerationRequest, APIError> {
    if !body.is_object() {
        return Err(APIError::new(400, "Invalid input: expected object")
            .with_code(constants::code::INVALID_PAYLOAD));
    }

    let request: ImageGenerationRequest = serde_json::from_value(body).map_err(|error| {
        APIError::new(400, format!("Invalid request body: {error}"))
            .with_code(constants::code::INVALID_PAYLOAD)
    })?;

    if request.prompt.trim().is_empty() {
        return Err(APIError::new(400, constants::gateway::PROMPT_REQUIRED)
            .with_code(constants::code::INVALID_PAYLOAD));
    }

    if request.n.is_some_and(|n| n == 0 || n > 10) {
        return Err(APIError::new(400, "Parameter 'n' must be between 1 and 10")
            .with_code(constants::code::INVALID_PAYLOAD));
    }

    Ok(request)
}

/// Returns whether the specified model supports image generation or editing.
pub fn is_image_generation_supported(model: &str, has_input_image: bool) -> bool {
    let lower = model.to_ascii_lowercase();
    let bare = lower.rsplit('/').next().unwrap_or(&lower);

    if has_input_image {
        IMAGE_EDIT_PATTERNS.iter().any(|&p| bare.contains(p))
    } else if TEXT_ONLY_PATTERNS.iter().any(|&p| bare.contains(p)) && !bare.contains("image") {
        false
    } else {
        IMAGE_PATTERNS.iter().any(|&p| bare.contains(p))
    }
}

/// Handles `POST /v1/images/generations`.
pub async fn create_image(
    State(state): State<AppState>,
    principal: Option<Extension<APIPrincipal>>,
    request: Request,
) -> Result<Response, APIError> {
    let log_context = RequestLogContext::from_request(&request, principal.as_ref())?;

    let body = read_json_body(request)
        .await
        .map_err(body_error_to_api_error)?;
    let image_request = parse_image_request(body)?;

    let requested_model = image_request
        .model
        .as_deref()
        .unwrap_or("dall-e-3")
        .to_owned();

    let has_input_image = image_request.image.is_some() || image_request.images.is_some();

    // Check if the model supports image generation
    if !is_image_generation_supported(&requested_model, has_input_image) {
        let reason = if has_input_image {
            constants::gateway::model_not_supported_image_edit(&requested_model)
        } else {
            constants::gateway::model_not_supported_image(&requested_model)
        };

        return Err(APIError::new(400, reason)
            .with_code(constants::code::MODEL_NOT_SUPPORTED)
            .with_param("model"));
    }

    // Verify model is allowed for this API key
    ensure_model_allowed_any(
        principal.as_ref().and_then(|ext| ext.0.api_key.as_ref()),
        &state.providers.model_id_variants(&requested_model),
    )?;

    // Resolve provider
    let resolved = match state.providers.resolve(&requested_model) {
        Some(resolved) => resolved,
        None => {
            state.providers.maybe_refresh_catalogs(false).await;
            state.providers.resolve(&requested_model).ok_or_else(|| {
                APIError::new(
                    404,
                    format!("Model '{requested_model}' not found or no provider configured"),
                )
                .with_code(constants::code::MODEL_NOT_FOUND)
            })?
        }
    };

    let result = resolved
        .adapter
        .generate_image(&resolved.model, &image_request)
        .await;

    let status_code = match &result {
        Ok(_) => 200,
        Err(err) => err.status(),
    };

    // Log request
    log_request(
        &state,
        &log_context,
        resolved.adapter.id(),
        &requested_model,
        Some(&resolved.model),
        status_code,
        &UsageBreakdown::default(),
        result.as_ref().err().map(|e| e.message()),
    )
    .await;

    match result {
        Ok(response) => {
            if let Some(api_key_id) = log_context.api_key_id.as_deref() {
                let _ = state
                    .security
                    .key_repository
                    .increment_usage(api_key_id, 0, 0.0)
                    .await;
            }
            Ok(Json(response).into_response())
        }
        Err(err) => Err(err),
    }
}
