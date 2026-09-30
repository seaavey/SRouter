mod support;

use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode, header},
};
use srouter_server::SecurityState;
use srouter_server::app::create_router;
use srouter_server::features::providers::ProviderRegistry;
use srouter_server::infrastructure::database::catalog_flags::favorite_model_ids;
use support::{api_key_record, security_state, with_loopback_client, with_remote_client};
use tower::ServiceExt;

fn test_app(security: SecurityState) -> Router {
    let providers = ProviderRegistry::with_defaults().expect("default providers");
    let state =
        srouter_server::AppState::with_security(support::test_config(), providers, security);

    create_router(state)
}

fn app_with_database(database: srouter_server::AppDatabase) -> Router {
    let providers = ProviderRegistry::with_defaults().expect("default providers");
    let state = srouter_server::AppState::with_security(
        support::test_config(),
        providers,
        SecurityState::unconfigured(),
    )
    .with_database(database);

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

#[tokio::test]
async fn favorite_model_ids_returns_lowercased_stored_ids() {
    let test_database = support::TestDatabase::new().unwrap();
    let database = test_database.connect().await.unwrap();

    sqlx::query("INSERT INTO favorite_models (model_id, created_at) VALUES (?, ?)")
        .bind("Zen/Space-Bunny-Free")
        .bind(1_700_000_000_i64)
        .execute(database.sqlite_pool().unwrap())
        .await
        .unwrap();

    let ids = favorite_model_ids(&database).await.unwrap();

    assert!(ids.contains("zen/space-bunny-free"));
    assert_eq!(ids.len(), 1);
}

#[tokio::test]
async fn models_list_marks_favorited_entries() {
    let test_database = support::TestDatabase::new().unwrap();
    let database = test_database.connect().await.unwrap();

    sqlx::query("INSERT INTO favorite_models (model_id, created_at) VALUES (?, ?)")
        .bind("zen/big-pickle")
        .bind(1_700_000_000_i64)
        .execute(database.sqlite_pool().unwrap())
        .await
        .unwrap();

    let app = app_with_database(database);
    let response = app.oneshot(get_request("/v1/models")).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let json = json_body(response).await;

    let entry = |id: &str| {
        json["data"]
            .as_array()
            .unwrap()
            .iter()
            .find(|entry| entry["id"] == id)
            .unwrap_or_else(|| panic!("missing catalog entry {id}"))
            .clone()
    };
    assert_eq!(entry("zen/big-pickle")["favorite"], serde_json::json!(true));
    assert_eq!(
        entry("zen/space-bunny-free")["favorite"],
        serde_json::json!(false)
    );
}

#[tokio::test]
async fn hidden_models_are_absent_from_the_catalog() {
    let test_database = support::TestDatabase::new().unwrap();
    let database = test_database.connect().await.unwrap();

    sqlx::query(
        "INSERT INTO provider_model_overrides (provider_id, model_id, custom, hidden, created_at) \
         VALUES (?, ?, 0, 1, ?)",
    )
    .bind("opencode_zen")
    .bind("zen/big-pickle")
    .bind(1_700_000_000_i64)
    .execute(database.sqlite_pool().unwrap())
    .await
    .unwrap();

    let app = app_with_database(database);
    let response = app
        .clone()
        .oneshot(get_request("/v1/models"))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let json = json_body(response).await;
    let ids: Vec<&str> = json["data"]
        .as_array()
        .unwrap()
        .iter()
        .map(|entry| entry["id"].as_str().unwrap())
        .collect();
    assert!(!ids.contains(&"zen/big-pickle"), "ids: {ids:?}");
    assert_eq!(
        ids.len(),
        18,
        "seven opencode models minus the hidden one, plus twelve qoder models"
    );

    let single = app
        .oneshot(get_request("/v1/models/zen%2Fbig-pickle"))
        .await
        .unwrap();
    assert_eq!(single.status(), StatusCode::NOT_FOUND);
    let error = json_body(single).await;
    assert_eq!(error["error"]["code"], "model_not_found");
}

#[tokio::test]
async fn hidden_flags_match_however_the_row_was_spelled() {
    let test_database = support::TestDatabase::new().unwrap();
    let database = test_database.connect().await.unwrap();

    sqlx::query(
        "INSERT INTO provider_model_overrides (provider_id, model_id, custom, hidden, created_at) \
         VALUES (?, ?, 0, 1, ?)",
    )
    .bind("OpenCode_Zen")
    .bind("Zen/Big-Pickle")
    .bind(1_700_000_000_i64)
    .execute(database.sqlite_pool().unwrap())
    .await
    .unwrap();

    let response = app_with_database(database)
        .oneshot(get_request("/v1/models"))
        .await
        .unwrap();
    let json = json_body(response).await;

    assert!(
        json["data"]
            .as_array()
            .unwrap()
            .iter()
            .all(|entry| entry["id"] != "zen/big-pickle")
    );
}

#[tokio::test]
async fn disabling_a_provider_hides_its_alias_prefixed_models() {
    let test_database = support::TestDatabase::new().unwrap();
    let database = test_database.connect().await.unwrap();
    let pool = database.sqlite_pool().unwrap().clone();

    sqlx::query(
        "INSERT INTO settings (key, value) VALUES ('provider_enabled_opencode_zen', 'false')",
    )
    .execute(&pool)
    .await
    .unwrap();

    let app = app_with_database(database.clone());
    let response = app
        .clone()
        .oneshot(get_request("/v1/models"))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let data = json_body(response).await;
    let ids: Vec<&str> = data["data"]
        .as_array()
        .expect("model list")
        .iter()
        .filter_map(|entry| entry["id"].as_str())
        .collect();
    assert_eq!(
        ids.len(),
        12,
        "only the disabled provider's models disappear: {ids:?}"
    );
    assert!(
        ids.iter().all(|id| id.starts_with("qd/")),
        "remaining models belong to the other provider: {ids:?}"
    );

    // The single route drops it too, rather than serving a disabled model.
    let single = app
        .oneshot(get_request("/v1/models/zen%2Fbig-pickle"))
        .await
        .unwrap();
    assert_eq!(single.status(), StatusCode::NOT_FOUND);

    sqlx::query("UPDATE settings SET value = 'true' WHERE key = 'provider_enabled_opencode_zen'")
        .execute(&pool)
        .await
        .unwrap();

    let reenabled = app_with_database(database)
        .oneshot(get_request("/v1/models"))
        .await
        .unwrap();
    let body = json_body(reenabled).await;
    assert_eq!(body["data"].as_array().unwrap().len(), 19);
}

#[tokio::test]
async fn get_single_model_reports_favorite() {
    let test_database = support::TestDatabase::new().unwrap();
    let database = test_database.connect().await.unwrap();

    sqlx::query("INSERT INTO favorite_models (model_id, created_at) VALUES (?, ?)")
        .bind("zen/space-bunny-free")
        .bind(1_700_000_000_i64)
        .execute(database.sqlite_pool().unwrap())
        .await
        .unwrap();

    let app = app_with_database(database);

    let favorited = app
        .clone()
        .oneshot(get_request("/v1/models/zen%2Fspace-bunny-free"))
        .await
        .unwrap();
    assert_eq!(favorited.status(), StatusCode::OK);
    let json = json_body(favorited).await;
    assert_eq!(json["id"], "zen/space-bunny-free");
    assert_eq!(json["favorite"], serde_json::json!(true));

    let plain = app
        .oneshot(get_request("/v1/models/big-pickle"))
        .await
        .unwrap();
    assert_eq!(plain.status(), StatusCode::OK);
    let json = json_body(plain).await;
    assert_eq!(json["id"], "zen/big-pickle");
    assert_eq!(json["favorite"], serde_json::json!(false));
}
