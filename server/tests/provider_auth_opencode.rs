use axum::{
    Router,
    body::Body,
    http::{Request, StatusCode},
};
use tower::ServiceExt;

use srouter_server::AppState;
use srouter_server::app::create_router;
use srouter_server::features::admin_auth::hash_session_token;
use srouter_server::features::providers::ProviderRegistry;

mod support;
use support::{
    TestDatabase, sqlx_security_state, test_config, with_loopback_client,
};

const SESSION_TOKEN: &str = "test-session-token";

async fn test_app(database: &TestDatabase, with_session: bool) -> Router {
    let sessions = if with_session {
        vec![hash_session_token(SESSION_TOKEN)]
    } else {
        Vec::new()
    };
    let security = sqlx_security_state(database, sessions).await;
    let app_database = database.connect().await.expect("temporary database");
    let state = AppState::with_security(
        test_config(),
        ProviderRegistry::new(),
        security,
    )
    .with_database(app_database);

    create_router(state)
}

fn admin_get(uri: &str) -> Request<Body> {
    let cookie = format!("srouter_admin_session={SESSION_TOKEN}");
    with_loopback_client(
        Request::builder()
            .method("GET")
            .uri(uri)
            .header("cookie", cookie)
            .body(Body::empty())
            .unwrap(),
    )
}

fn anon_get(uri: &str) -> Request<Body> {
    with_loopback_client(
        Request::builder()
            .method("GET")
            .uri(uri)
            .body(Body::empty())
            .unwrap(),
    )
}

#[tokio::test]
async fn opencode_device_auth_and_poll_flow_unauthenticated_guard() {
    let database = TestDatabase::new().unwrap();
    let app = test_app(&database, false).await;

    // Direct access to /v1/auth/opencode/device without admin session returns 401
    let response = app
        .oneshot(anon_get("/v1/auth/opencode/device"))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn opencode_device_auth_endpoint_is_mounted() {
    let database = TestDatabase::new().unwrap();
    let app = test_app(&database, true).await;

    // With admin session, requesting /v1/auth/opencode/device reaches handler
    let device_res = app
        .oneshot(admin_get("/v1/auth/opencode/device"))
        .await
        .unwrap();

    // The route exists and is mounted (doesn't return 401 or 404)
    assert_ne!(device_res.status(), StatusCode::NOT_FOUND);
    assert_ne!(device_res.status(), StatusCode::UNAUTHORIZED);
}
