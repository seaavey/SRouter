use axum::{Router, routing::post};

use crate::features::gateway::chat::create_completion;
use crate::features::gateway::images::create_image;
use crate::features::gateway::messages::{count_tokens, create_message};
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
