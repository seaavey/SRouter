use axum::middleware::{from_fn, from_fn_with_state};
use axum::{Json, Router, routing::get};
use serde::Serialize;

use crate::features::admin_auth::create_admin_router;
use crate::features::api_keys::create_api_keys_router;
use crate::features::gateway::routes::create_gateway_router;
use crate::features::logs::create_logs_router;
use crate::features::provider_auth::{
    create_cline_login_router, create_grok_web_login_router, create_qoder_callback_router,
    create_qoder_login_router,
};
use crate::features::providers::management::{
    create_providers_management_router, create_providers_read_router,
};
use crate::features::settings::{create_settings_management_router, create_settings_read_router};
use crate::http::middleware::admin_session::require_admin_session;
use crate::http::middleware::api_key_auth::api_key_auth;
use crate::http::middleware::body_limit::body_limit;
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
    // The provider catalog is a read surface, so it carries the gateway's
    // API-key guard instead of the admin-session one.
    let providers_read_routes =
        create_providers_read_router().layer(from_fn_with_state(state.clone(), api_key_auth));
    // Hiding and restoring a model is an operator action, so it carries the
    // admin-session guard instead of the API-key one.
    let providers_mgmt_routes = create_providers_management_router()
        .layer(from_fn_with_state(state.clone(), require_admin_session));
    // The device flow needs the admin session, while the callback stays public
    // because a browser lands on it without a session cookie.
    let qoder_login_routes =
        create_qoder_login_router().layer(from_fn_with_state(state.clone(), require_admin_session));
    let cline_login_routes =
        create_cline_login_router().layer(from_fn_with_state(state.clone(), require_admin_session));
    let grok_web_login_routes = create_grok_web_login_router()
        .layer(from_fn_with_state(state.clone(), require_admin_session));
    let qoder_callback_routes = create_qoder_callback_router();
    let logs_routes = create_logs_router().layer(from_fn_with_state(state.clone(), api_key_auth));
    let settings_read_routes =
        create_settings_read_router().layer(from_fn_with_state(state.clone(), api_key_auth));
    let settings_mgmt_routes = create_settings_management_router()
        .layer(from_fn_with_state(state.clone(), require_admin_session));
    // Admin auth routes enforce their own session requirement per handler, so
    // they are mounted without a shared guard.
    // CSRF origin defense rejects cross-origin mutations using admin cookies before
    // authentication or handler execution runs.
    let v1_routes = gateway_routes
        .clone()
        .merge(keys_routes)
        .merge(create_admin_router())
        .merge(qoder_login_routes)
        .merge(cline_login_routes)
        .merge(grok_web_login_routes)
        .merge(qoder_callback_routes)
        .merge(providers_read_routes)
        .merge(providers_mgmt_routes)
        .merge(logs_routes)
        .merge(settings_read_routes)
        .merge(settings_mgmt_routes)
        .layer(from_fn_with_state(state.clone(), csrf_origin_guard))
        .layer(from_fn(body_limit));
    let v1_compat_routes = gateway_routes
        .layer(from_fn_with_state(state.clone(), csrf_origin_guard))
        .layer(from_fn(body_limit));

    Router::new()
        .route("/", get(api_info))
        // `GET /v1` is a plain api-info route in Node (`apps/api/src/index.ts:121`),
        // declared before the `/v1` nest so the literal wins over the sub-routes.
        .route("/v1", get(api_info))
        .route("/health", get(health))
        // Production mounts chat routes under `/v1` and the `/v1/v1` compat alias
        // only; root-level mounts exist in the Node test harness, not here.
        .nest("/v1", v1_routes)
        .nest("/v1/v1", v1_compat_routes)
        .layer(from_fn_with_state(state.clone(), cors))
        .layer(from_fn(security_headers))
        .with_state(state)
}
