use axum::{Router, routing::post};

use crate::features::gateway::chat::create_completion;
use crate::state::AppState;

/// Mounts the OpenAI-compatible chat completion routes. The compatibility alias
/// `/v1/v1/*` is applied by the composition root in `app.rs`.
pub fn create_gateway_router() -> Router<AppState> {
    Router::new()
        .route("/chat/completions", post(create_completion))
        .route("/chat/completion", post(create_completion))
}
