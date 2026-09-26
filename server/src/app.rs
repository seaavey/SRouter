use axum::middleware::{from_fn, from_fn_with_state};
use axum::{Json, Router, routing::get};
use serde::Serialize;

use crate::features::gateway::routes::create_gateway_router;
use crate::http::middleware::api_key_auth::api_key_auth;
use crate::http::middleware::rate_limit::rate_limit;
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
    // The last layer added is outermost, so the order mirrors the Node chain:
    // auth runs first and attaches the principal, then the limiter reads it.
    let gateway_routes = create_gateway_router()
        .layer(from_fn_with_state(state.clone(), rate_limit))
        .layer(from_fn_with_state(state.clone(), api_key_auth));

    Router::new()
        .route("/", get(api_info))
        .route("/health", get(health))
        // Production mounts chat routes under `/v1` and the `/v1/v1` compat alias
        // only; root-level mounts exist in the Node test harness, not here.
        .nest("/v1", gateway_routes.clone())
        .nest("/v1/v1", gateway_routes)
        .layer(from_fn(security_headers))
        .with_state(state)
}
