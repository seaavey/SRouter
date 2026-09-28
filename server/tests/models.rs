mod support;

use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode, header},
};
use srouter_server::SecurityState;
use srouter_server::app::create_router;
use srouter_server::features::providers::ProviderRegistry;
use support::{api_key_record, security_state, with_loopback_client, with_remote_client};
use tower::ServiceExt;

fn test_app(security: SecurityState) -> Router {
    let providers = ProviderRegistry::with_defaults().expect("default providers");
    let state =
        srouter_server::AppState::with_security(support::test_config(), providers, security);

    create_router(state)
}

fn get_request(uri: &str) -> Request<Body> {
    with_loopback_client(
        Request::builder()
            .method("GET")
            .uri(uri)
            .body(Body::empty())
            .unwrap(),
    )
}

async fn json_body(response: axum::response::Response) -> serde_json::Value {
    let bytes = to_bytes(response.into_body(), 65_536).await.unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

#[tokio::test]
async fn get_v1_models_returns_the_catalog_with_cache_control() {
    let app = test_app(SecurityState::unconfigured());

    let response = app.oneshot(get_request("/v1/models")).await.unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response.headers()[header::CACHE_CONTROL],
        "public, max-age=60, stale-while-revalidate=300"
    );
    let json = json_body(response).await;
    assert_eq!(json["object"], "list");
    let ids: Vec<&str> = json["data"]
        .as_array()
        .unwrap()
        .iter()
        .map(|entry| entry["id"].as_str().unwrap())
        .collect();
    assert!(ids.contains(&"zen/space-bunny-free"));
    assert!(ids.contains(&"zen/big-pickle"));
    assert_eq!(json["data"][0]["object"], "model");
}

#[tokio::test]
async fn get_v1_v1_compat_models_returns_the_catalog() {
    let app = test_app(SecurityState::unconfigured());

    let response = app.oneshot(get_request("/v1/v1/models")).await.unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let json = json_body(response).await;
    assert_eq!(json["object"], "list");
    assert!(!json["data"].as_array().unwrap().is_empty());
}

#[tokio::test]
async fn get_v1_models_accepts_refresh_query_params() {
    let app = test_app(SecurityState::unconfigured());

    for uri in ["/v1/models?refresh=true", "/v1/models?force=1"] {
        let response = app.clone().oneshot(get_request(uri)).await.unwrap();

        assert_eq!(response.status(), StatusCode::OK, "uri: {uri}");
        let json = json_body(response).await;
        assert_eq!(json["object"], "list");
    }
}

#[tokio::test]
async fn get_single_model_returns_the_entry_or_404() {
    let app = test_app(SecurityState::unconfigured());

    let found = app
        .clone()
        .oneshot(get_request("/v1/models/zen%2Fspace-bunny-free"))
        .await
        .unwrap();
    assert_eq!(found.status(), StatusCode::OK);
    let json = json_body(found).await;
    assert_eq!(json["id"], "zen/space-bunny-free");
    assert_eq!(json["object"], "model");

    let bare = app
        .clone()
        .oneshot(get_request("/v1/models/space-bunny-free"))
        .await
        .unwrap();
    assert_eq!(bare.status(), StatusCode::OK);

    let missing = app
        .oneshot(get_request("/v1/models/does-not-exist"))
        .await
        .unwrap();
    assert_eq!(missing.status(), StatusCode::NOT_FOUND);
    let json = json_body(missing).await;
    assert_eq!(json["error"]["code"], "model_not_found");
}

#[tokio::test]
async fn allowlisted_keys_see_only_their_models() {
    const KEY: &str = "sr-live-test";
    let mut record = api_key_record("key_1");
    record.allowed_models = Some(vec![String::from("zen/space-bunny-free")]);
    let security = security_state(false, vec![(KEY.to_owned(), record)], vec![]);
    let app = test_app(security);

    let list = app
        .clone()
        .oneshot(with_remote_client(
            Request::builder()
                .method("GET")
                .uri("/v1/models")
                .header("x-api-key", KEY)
                .body(Body::empty())
                .unwrap(),
            "203.0.113.7",
        ))
        .await
        .unwrap();
    assert_eq!(list.status(), StatusCode::OK);
    let json = json_body(list).await;
    assert_eq!(json["data"].as_array().unwrap().len(), 1);
    assert_eq!(json["data"][0]["id"], "zen/space-bunny-free");

    let denied = app
        .oneshot(with_remote_client(
            Request::builder()
                .method("GET")
                .uri("/v1/models/zen%2Fbig-pickle")
                .header("x-api-key", KEY)
                .body(Body::empty())
                .unwrap(),
            "203.0.113.7",
        ))
        .await
        .unwrap();
    assert_eq!(denied.status(), StatusCode::FORBIDDEN);
    let json = json_body(denied).await;
    assert_eq!(json["error"]["code"], "model_not_allowed");
}
