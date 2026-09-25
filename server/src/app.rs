use axum::{Json, Router, middleware::from_fn, routing::get};
use serde::Serialize;

use crate::http::middleware::security_headers::security_headers;
use crate::state::AppState;

#[derive(Serialize)]
struct ApiInfo {
    name: &'static str,
    status: &'static str,
    version: &'static str,
    documentation: &'static str,
}

#[derive(Serialize)]
struct HealthResponse {
    status: &'static str,
}

async fn api_info() -> Json<ApiInfo> {
    Json(ApiInfo {
        name: "SRouter API",
        status: "ok",
        version: env!("CARGO_PKG_VERSION"),
        documentation: "Multi-Provider OpenAI & Anthropic Compatible LLM Gateway",
    })
}

async fn health() -> Json<HealthResponse> {
    Json(HealthResponse { status: "ok" })
}

/// Mounts feature routers here as their migration tasks land.
pub fn create_router(state: AppState) -> Router {
    Router::new()
        .route("/", get(api_info))
        .route("/health", get(health))
        .layer(from_fn(security_headers))
        .with_state(state)
}
