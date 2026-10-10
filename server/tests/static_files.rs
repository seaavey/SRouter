//! Static dashboard serving: asset cache headers, SPA fallback, and the
//! api-info fallback when no dist exists.

mod support;

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use axum::body::{Body, to_bytes};
use axum::http::{Request, StatusCode, header};
use axum::response::Response;
use srouter_server::app::create_router;
use srouter_server::features::providers::ProviderRegistry;
use srouter_server::{APIConfig, AppState};
use support::{security_state, with_loopback_client};
use tower::ServiceExt;

/// A temporary web-dist directory removed when the value drops.
struct WebDist {
    directory: PathBuf,
}

impl WebDist {
    fn new() -> Self {
        let directory =
            std::env::temp_dir().join(format!("srouter-web-dist-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(directory.join("assets")).expect("dist directories");

        Self { directory }
    }

    fn write(&self, relative: &str, contents: &str) {
        let path = self.directory.join(relative);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).expect("dist parent");
        }
        std::fs::write(path, contents).expect("dist file");
    }

    fn path(&self) -> &Path {
        &self.directory
    }
}

impl Drop for WebDist {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.directory);
    }
}

fn config(web_dist_path: Option<PathBuf>) -> APIConfig {
    let mut environment = HashMap::from([("HOME".to_owned(), "/tmp/srouter-test-home".to_owned())]);
    if let Some(path) = web_dist_path {
        environment.insert("WEB_DIST_PATH".to_owned(), path.display().to_string());
    }

    APIConfig::from_env_map(&environment).expect("test configuration")
}

fn app(web_dist_path: Option<PathBuf>) -> axum::Router {
    let state = AppState::with_security(
        config(web_dist_path),
        ProviderRegistry::new(),
        security_state(false, vec![], vec![]),
    );

    create_router(state)
}

fn get(uri: &str) -> Request<Body> {
    with_loopback_client(
        Request::builder()
            .method("GET")
            .uri(uri)
            .body(Body::empty())
            .expect("request"),
    )
}

fn post(uri: &str) -> Request<Body> {
    with_loopback_client(
        Request::builder()
            .method("POST")
            .uri(uri)
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from("{}"))
            .expect("request"),
    )
}

async fn text(response: Response) -> String {
    let bytes = to_bytes(response.into_body(), 1_000_000).await.unwrap();

    String::from_utf8_lossy(&bytes).into_owned()
}

#[tokio::test]
async fn an_asset_is_served_with_the_immutable_cache_header() {
    let dist = WebDist::new();
    dist.write("index.html", "<!doctype html><title>dashboard</title>");
    dist.write("assets/app.js", "console.log('app')");

    let response = app(Some(dist.path().to_path_buf()))
        .oneshot(get("/assets/app.js"))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response
            .headers()
            .get(header::CACHE_CONTROL)
            .and_then(|value| value.to_str().ok()),
        Some("public, max-age=31536000, immutable")
    );
    assert_eq!(
        response
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok()),
        Some("text/javascript; charset=utf-8")
    );
    assert_eq!(text(response).await, "console.log('app')");
}

#[tokio::test]
async fn an_unmatched_route_falls_back_to_the_spa_shell_without_a_cache_header() {
    let dist = WebDist::new();
    dist.write("index.html", "<!doctype html><title>dashboard</title>");

    let response = app(Some(dist.path().to_path_buf()))
        .oneshot(get("/settings/providers"))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    assert!(
        response.headers().get(header::CACHE_CONTROL).is_none(),
        "the SPA shell must not be cached immutably"
    );
    assert_eq!(
        response
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok()),
        Some("text/html; charset=utf-8")
    );
    assert!(text(response).await.contains("<title>dashboard</title>"));
}

#[tokio::test]
async fn the_root_serves_the_shell_when_a_dist_exists_and_api_info_otherwise() {
    let dist = WebDist::new();
    dist.write("index.html", "<!doctype html><title>dashboard</title>");

    let with_dist = app(Some(dist.path().to_path_buf()))
        .oneshot(get("/"))
        .await
        .unwrap();
    assert_eq!(with_dist.status(), StatusCode::OK);
    assert!(text(with_dist).await.contains("<title>dashboard</title>"));

    let missing = std::env::temp_dir().join("srouter-no-such-dist");
    let without_dist = app(Some(missing)).oneshot(get("/")).await.unwrap();
    assert_eq!(without_dist.status(), StatusCode::OK);
    let body = text(without_dist).await;
    assert!(body.contains("SRouter API"), "{body}");
    assert!(body.contains("\"status\":\"ok\""), "{body}");
}

#[tokio::test]
async fn health_and_v1_are_not_swallowed_by_the_static_fallback() {
    let dist = WebDist::new();
    dist.write("index.html", "<!doctype html><title>dashboard</title>");

    let app = app(Some(dist.path().to_path_buf()));

    let health = app.clone().oneshot(get("/health")).await.unwrap();
    assert_eq!(health.status(), StatusCode::OK);
    assert_eq!(text(health).await, "{\"status\":\"ok\"}");

    let v1 = app.oneshot(get("/v1")).await.unwrap();
    assert_eq!(v1.status(), StatusCode::OK);
    assert!(text(v1).await.contains("SRouter API"));
}

#[tokio::test]
async fn unmatched_v1_paths_answer_json_404_instead_of_the_spa() {
    let dist = WebDist::new();
    dist.write("index.html", "<!doctype html><title>dashboard</title>");

    let app = app(Some(dist.path().to_path_buf()));

    let unmatched = app
        .clone()
        .oneshot(get("/v1/not-migrated-yet"))
        .await
        .unwrap();
    assert_eq!(unmatched.status(), StatusCode::NOT_FOUND);
    assert_eq!(
        unmatched
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok()),
        Some("application/json")
    );
    let body = text(unmatched).await;
    assert!(body.contains("\"error\""), "{body}");
    assert!(
        !body.contains("<title>dashboard</title>"),
        "the SPA shell must not swallow an unmatched API path: {body}"
    );

    // The compat alias root is not a gateway route either, and a non-GET method
    // must not fall through to the GET-only static fallback.
    let compat = app.clone().oneshot(get("/v1/v1")).await.unwrap();
    assert_eq!(compat.status(), StatusCode::NOT_FOUND);

    let posted = app.oneshot(post("/v1/not-migrated-yet")).await.unwrap();
    assert_eq!(posted.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn a_path_traversal_attempt_does_not_escape_the_dist() {
    let dist = WebDist::new();
    dist.write("index.html", "<!doctype html><title>dashboard</title>");
    let secret = dist.path().parent().unwrap().join("srouter-secret.txt");
    std::fs::write(&secret, "top secret").unwrap();

    let response = app(Some(dist.path().to_path_buf()))
        .oneshot(get("/../srouter-secret.txt"))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = text(response).await;
    assert!(!body.contains("top secret"), "{body}");
    assert!(body.contains("<title>dashboard</title>"), "{body}");

    let _ = std::fs::remove_file(secret);
}
