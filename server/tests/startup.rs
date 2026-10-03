//! Startup composition: the admin bootstrap driven by `SROUTER_ADMIN_PASSWORD`
//! (`bootstrapAdminAccountFromEnv` in Node). Each case boots with a temporary
//! database, runs the same bootstrap the binary runs, and then talks to the
//! assembled router.

mod support;

use std::collections::HashMap;
use std::sync::Arc;

use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode, header},
    response::Response,
};
use srouter_server::app::create_router;
use srouter_server::features::admin_auth::bootstrap_admin_account_from_env;
use srouter_server::infrastructure::database::admin_auth::SQLxAdminAuthStore;
use srouter_server::infrastructure::database::api_keys::SQLxAPIKeyStore;
use srouter_server::{APIConfig, AppState, ProviderRegistry, SecurityState, clock};
use support::{TestDatabase, json_request, with_loopback_client};
use tower::ServiceExt;

/// Configuration from an environment map carrying the optional bootstrap
/// password, the same way `main` reads the process environment.
fn config_with_password(password: Option<&str>) -> APIConfig {
    let mut environment =
        HashMap::from([("HOME".to_owned(), "/tmp/srouter-startup-home".to_owned())]);
    if let Some(password) = password {
        environment.insert("SROUTER_ADMIN_PASSWORD".to_owned(), password.to_owned());
    }

    APIConfig::from_env_map(&environment).expect("startup configuration")
}

/// Boots the admin composition: database, bootstrap, then the router `main`
/// serves. The bootstrap call is the exact one `main.rs` makes.
async fn boot(database: &TestDatabase, password: Option<&str>) -> Router {
    let config = config_with_password(password);
    let app_database = database.connect().await.expect("temporary database");
    let admin_store = Arc::new(SQLxAdminAuthStore::new(app_database.clone()));
    bootstrap_admin_account_from_env(admin_store.as_ref(), &config, clock::now_ms())
        .await
        .expect("admin bootstrap");
    let api_key_store = Arc::new(SQLxAPIKeyStore::new(app_database));
    let security =
        SecurityState::with_repository(api_key_store.clone(), admin_store.clone(), api_key_store)
            .with_admin_auth(admin_store);

    create_router(AppState::with_security(
        config,
        ProviderRegistry::new(),
        security,
    ))
}

fn loopback(request: Request<Body>) -> Request<Body> {
    with_loopback_client(request)
}

async fn login(app: &Router, password: &str) -> Response {
    app.clone()
        .oneshot(loopback(json_request(
            "POST",
            "/v1/admin/login",
            serde_json::json!({ "password": password }),
        )))
        .await
        .unwrap()
}

async fn status(app: &Router) -> serde_json::Value {
    let response = app
        .clone()
        .oneshot(loopback(json_request(
            "GET",
            "/v1/admin/status",
            serde_json::json!(null),
        )))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    let bytes = to_bytes(response.into_body(), 65_536).await.unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

#[tokio::test]
async fn the_env_password_creates_the_account_and_logs_in() {
    let database = TestDatabase::new().unwrap();
    let app = boot(&database, Some("bootstrap secret")).await;

    let status = status(&app).await;
    assert_eq!(status["setup_required"], false);
    assert_eq!(status["authenticated"], false);

    let response = login(&app, "bootstrap secret").await;
    assert_eq!(response.status(), StatusCode::OK);
    assert!(
        response
            .headers()
            .get(header::SET_COOKIE)
            .and_then(|value| value.to_str().ok())
            .is_some_and(|value| value.starts_with("srouter_admin_session=")),
        "a successful env-password login sets the session cookie"
    );

    let bytes = to_bytes(response.into_body(), 65_536).await.unwrap();
    let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(body["authenticated"], true);

    assert_eq!(
        login(&app, "wrong secret").await.status(),
        StatusCode::UNAUTHORIZED
    );
}

#[tokio::test]
async fn a_later_boot_resets_the_password() {
    let database = TestDatabase::new().unwrap();
    let first = boot(&database, Some("first secret")).await;
    assert_eq!(login(&first, "first secret").await.status(), StatusCode::OK);

    // Same database, new environment value: the recovery path resets the hash.
    let second = boot(&database, Some("second secret")).await;
    assert_eq!(
        login(&second, "first secret").await.status(),
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        login(&second, "second secret").await.status(),
        StatusCode::OK
    );
}

#[tokio::test]
async fn without_the_env_password_the_install_stays_fresh() {
    let database = TestDatabase::new().unwrap();
    let app = boot(&database, None).await;

    let status = status(&app).await;
    assert_eq!(status["setup_required"], true);
    assert_eq!(status["authenticated"], false);

    // No account was auto-created, so login cannot succeed before setup.
    assert_eq!(
        login(&app, "anything").await.status(),
        StatusCode::UNAUTHORIZED
    );
}
