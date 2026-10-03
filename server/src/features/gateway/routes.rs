use axum::{
    Router,
    routing::{get, post},
};

use crate::features::gateway::chat::create_completion;
use crate::features::gateway::messages::{count_tokens, create_message};
use crate::features::gateway::models::{get_model, list_models};
use crate::state::AppState;

/// Mounts the chat and messages routes. The composition root layers the rate
/// limiter and the API-key guard over this router. The compatibility alias
/// `/v1/v1/*` is applied by the composition root in `app.rs`.
pub fn create_gateway_router() -> Router<AppState> {
    Router::new()
        .route("/chat/completions", post(create_completion))
        .route("/chat/completion", post(create_completion))
        .route("/chat", post(create_completion))
        .route("/messages", post(create_message))
        .route("/messages/count_tokens", post(count_tokens))
}

/// Mounts the model catalog routes. Node applies only `ApiKeyAuth` here, never
/// the rate limiter (`apps/api/src/routes/v1/models.ts`), and the contract
/// lists `GET /v1/models` as API-key auth, so the composition root layers the
/// API-key guard over this router without the limiter: catalog polling must
/// not consume the chat/messages window.
pub fn create_models_router() -> Router<AppState> {
    Router::new()
        .route("/models", get(list_models))
        .route("/models/{*model}", get(get_model))
}
