use axum::Extension;
use axum::middleware::{from_fn, from_fn_with_state};
use axum::{Json, Router, routing::get};
use serde::Serialize;

use crate::features::admin_auth::create_admin_router;
use crate::features::api_keys::create_api_keys_router;
use crate::features::catalog::create_quota_router;
use crate::features::gateway::routes::{create_gateway_router, create_models_router};
use crate::features::logs::create_logs_router;
use crate::features::provider_auth::{
    create_cline_login_router, create_grok_web_login_router, create_openai_callback_pages_router,
    create_openai_callback_router, create_openai_login_router, create_qoder_callback_pages_router,
    create_qoder_callback_router, create_qoder_login_router,
};
use crate::features::providers::management::{
    create_providers_management_router, create_providers_read_router,
};
use crate::features::settings::{create_settings_management_router, create_settings_read_router};
use crate::http::middleware::access_log::log_access;
use crate::http::middleware::admin_session::require_admin_session;
use crate::http::middleware::api_key_auth::api_key_auth;
use crate::http::middleware::body_limit::body_limit;
use crate::http::middleware::cors::cors;
use crate::http::middleware::csrf::csrf_origin_guard;
use crate::http::middleware::failure_log::log_failed_requests;
use crate::http::middleware::rate_limit::rate_limit;
use crate::http::middleware::security_headers::security_headers;
use crate::http::static_files;
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
    // The model catalog skips the limiter: Node runs only `ApiKeyAuth` there
    // (`apps/api/src/routes/v1/models.ts`) and the contract row for
    // `GET /v1/models` lists API-key auth, so polling must not consume the
    // chat/messages window.
    let models_routes =
        create_models_router().layer(from_fn_with_state(state.clone(), api_key_auth));
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
    let openai_login_routes = create_openai_login_router()
        .layer(from_fn_with_state(state.clone(), require_admin_session));
    let qoder_callback_routes = create_qoder_callback_router();
    let openai_callback_routes = create_openai_callback_router();
    // The browser callback lives at the application root, outside `/v1`, because
    // the vendor only accepts `http://127.0.0.1:{1455,1457}/auth/callback`. It
    // carries the body limit but neither the API-key nor the admin guard.
    let openai_callback_pages = create_openai_callback_pages_router().layer(from_fn(body_limit));
    let qoder_callback_pages = create_qoder_callback_pages_router().layer(from_fn(body_limit));
    let logs_routes = create_logs_router().layer(from_fn_with_state(state.clone(), api_key_auth));
    let quota_routes = create_quota_router().layer(from_fn_with_state(state.clone(), api_key_auth));
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
        .merge(models_routes.clone())
        .merge(keys_routes)
        .merge(create_admin_router())
        .merge(qoder_login_routes)
        .merge(cline_login_routes)
        .merge(grok_web_login_routes)
        .merge(openai_login_routes)
        .merge(qoder_callback_routes)
        .merge(openai_callback_routes)
        .merge(providers_read_routes)
        .merge(providers_mgmt_routes)
        .merge(logs_routes)
        .merge(quota_routes)
        .merge(settings_read_routes)
        .merge(settings_mgmt_routes)
        .layer(from_fn_with_state(state.clone(), csrf_origin_guard))
        .layer(from_fn(body_limit));
    let v1_compat_routes = gateway_routes
        .merge(models_routes)
        .layer(from_fn_with_state(state.clone(), csrf_origin_guard))
        .layer(from_fn(body_limit));

    // `GET /v1` is a plain api-info route in Node (`apps/api/src/index.ts:121`),
    // declared before the `/v1` nest so the literal wins over the sub-routes.
    let mut router = Router::new()
        .route("/v1", get(api_info))
        .route("/health", get(health))
        // The provider browser callbacks are the deliberate root-level mounts:
        // the Codex vendor allow-list pins its path outside `/v1`.
        .merge(openai_callback_pages)
        .merge(qoder_callback_pages)
        // Production mounts chat routes under `/v1` and the `/v1/v1` compat alias
        // only; root-level mounts exist in the Node test harness, not here.
        .nest("/v1", v1_routes)
        .nest("/v1/v1", v1_compat_routes);

    // With a built dashboard, `/` and every unmatched GET serve the SPA (Node's
    // `serveStatic` + `GET *` mount); without one, `/` keeps the API info object.
    // The root route and fallback must be registered before the layers below,
    // because `Router::layer` only wraps routes that already exist.
    router = match static_files::resolve_web_dist(&state.config) {
        Some(dist) => router
            .fallback(get(static_files::serve_static))
            .layer(Extension(dist)),
        None => router.route("/", get(api_info)),
    };

    router
        .layer(from_fn_with_state(state.clone(), cors))
        .layer(from_fn(security_headers))
        // Outermost on purpose: every final status, including auth, CORS, and body-limit
        // rejections, passes through here before the response leaves the process.
        .layer(from_fn(log_failed_requests))
        // The access log sits outside even the failure log so it sees the final status and the
        // full request duration; credentials are redacted before anything is written, and the
        // whole layer is a no-op in production unless `SROUTER_ACCESS_LOG` re-enables it.
        .layer(from_fn_with_state(state.clone(), log_access))
        .with_state(state)
}
