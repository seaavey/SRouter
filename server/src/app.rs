use axum::middleware::{from_fn, from_fn_with_state};
use axum::{Json, Router, routing::get};
use serde::Serialize;

use crate::features::admin_auth::create_admin_router;
use crate::features::api_keys::create_api_keys_router;
use crate::features::gateway::routes::create_gateway_router;
use crate::http::middleware::admin_session::require_admin_session;
use crate::http::middleware::api_key_auth::api_key_auth;
use crate::http::middleware::cors::cors;
use crate::http::middleware::csrf::csrf_origin_guard;
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
    // Key management is admin-session only, so it carries its own guard instead
    // of the gateway's API-key/auth-session chain.
    let keys_routes =
        create_api_keys_router().layer(from_fn_with_state(state.clone(), require_admin_session));
    // Admin auth routes enforce their own session requirement per handler, so
    // they are mounted without a shared guard.
    // CSRF origin defense rejects cross-origin mutations using admin cookies before
    // authentication or handler execution runs.
    let v1_routes = gateway_routes
        .clone()
        .merge(keys_routes)
        .merge(create_admin_router())
        .layer(from_fn_with_state(state.clone(), csrf_origin_guard));
    let v1_compat_routes =
        gateway_routes.layer(from_fn_with_state(state.clone(), csrf_origin_guard));

    Router::new()
        .route("/", get(api_info))
        .route("/health", get(health))
        // Production mounts chat routes under `/v1` and the `/v1/v1` compat alias
        // only; root-level mounts exist in the Node test harness, not here.
        .nest("/v1", v1_routes)
        .nest("/v1/v1", v1_compat_routes)
        .layer(from_fn_with_state(state.clone(), cors))
        .layer(from_fn(security_headers))
        .with_state(state)
}
