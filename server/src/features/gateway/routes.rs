use axum::{
    Router,
    routing::{get, post, put},
};

use crate::features::gateway::chat::create_completion;
use crate::features::gateway::images::create_image;
use crate::features::gateway::messages::{count_tokens, create_message};
use crate::features::gateway::models::{
    create_model, delete_model, get_model, list_models, patch_model, put_model,
};
use crate::state::AppState;

/// Mounts the chat, messages, and images routes. The composition root layers the rate
/// limiter and the API-key guard over this router. The compatibility alias
/// `/v1/v1/*` is applied by the composition root in `app.rs`.
pub fn create_gateway_router() -> Router<AppState> {
    Router::new()
        .route("/chat/completions", post(create_completion))
        .route("/chat/completion", post(create_completion))
        .route("/chat", post(create_completion))
        .route("/messages", post(create_message))
        .route("/messages/count_tokens", post(count_tokens))
        .route("/images/generations", post(create_image))
}

/// The model reads: the catalog list and one model. Node applies only
/// `ApiKeyAuth` here, never the rate limiter, so catalog polling must not
/// consume the chat/messages window.
pub fn create_models_read_router() -> Router<AppState> {
    Router::new()
        .route("/models", get(list_models))
        .route("/models/{*model}", get(get_model))
}

/// The model writes: create, upsert, update state, and delete a model. Every
/// model-level operation lives under `/v1/models`, so a model is managed here
/// and nowhere else. The composition root layers the admin-session guard.
pub fn create_models_write_router() -> Router<AppState> {
    Router::new().route("/models", post(create_model)).route(
        "/models/{*model}",
        put(put_model).patch(patch_model).delete(delete_model),
    )
}
