use axum::{
    Router,
    routing::{get, post},
};

use crate::features::gateway::chat::create_completion;
use crate::features::gateway::messages::{count_tokens, create_message};
use crate::features::gateway::models::{get_model, list_models};
use crate::state::AppState;

/// Mounts the OpenAI-compatible chat completion and Anthropic-compatible messages routes.
/// The compatibility alias `/v1/v1/*` is applied by the composition root in `app.rs`.
pub fn create_gateway_router() -> Router<AppState> {
    Router::new()
        .route("/chat/completions", post(create_completion))
        .route("/chat/completion", post(create_completion))
        .route("/messages", post(create_message))
        .route("/messages/count_tokens", post(count_tokens))
        .route("/models", get(list_models))
        .route("/models/{*model}", get(get_model))
}
