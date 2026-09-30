mod support;

use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode, header},
};
use srouter_server::SecurityState;
use srouter_server::app::create_router;
use srouter_server::features::providers::{OPENCODE_ZEN_MODELS, ProviderRegistry};
use srouter_server::infrastructure::database::catalog_flags::favorite_model_ids;
use support::{
    FAKE_QODER_ADVERTISED, FakeQoderUpstream, api_key_record, connect_qoder, qoder_catalog_body,
    qoder_registry, security_state, with_loopback_client, with_remote_client,
};
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

/// App whose `qoder` adapter reads its catalog through the fake upstream, so the
/// provider has live models that can be shown and hidden.
fn app_with_live_qoder(database: srouter_server::AppDatabase, fake: &FakeQoderUpstream) -> Router {
    let state = srouter_server::AppState::with_security(
        support::test_config(),
        qoder_registry(Some(database.clone()), fake),
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

/// The ids `/v1/models` serves for this app, read through a fresh clone.
async fn catalog_ids(app: &Router) -> Vec<String> {
    let response = app
        .clone()
        .oneshot(get_request("/v1/models"))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    json_body(response).await["data"]
        .as_array()
        .expect("model list")
        .iter()
        .map(|entry| entry["id"].as_str().unwrap().to_owned())
        .collect()
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
        OPENCODE_ZEN_MODELS.len() - 1,
        "the advertised opencode list minus the hidden one, and no qoder model \
         because upstream never answered: {ids:?}"
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
    let ids: Vec<&str> = json["data"]
        .as_array()
        .unwrap()
        .iter()
        .map(|entry| entry["id"].as_str().unwrap())
        .collect();

    assert_eq!(
        ids.len(),
        OPENCODE_ZEN_MODELS.len() - 1,
        "a row spelled in another case still hides exactly one model: {ids:?}"
    );
    assert!(ids.iter().all(|id| *id != "zen/big-pickle"), "{ids:?}");
}

#[tokio::test]
async fn disabling_a_provider_hides_its_alias_prefixed_models() {
    let test_database = support::TestDatabase::new().unwrap();
    let database = test_database.connect().await.unwrap();
    let pool = database.sqlite_pool().unwrap().clone();
    let fake = FakeQoderUpstream::start().await;
    fake.with(|state| state.model_catalog = qoder_catalog_body());
    connect_qoder(&test_database).await;

    sqlx::query(
        "INSERT INTO settings (key, value) VALUES ('provider_enabled_opencode_zen', 'false')",
    )
    .execute(&pool)
    .await
    .unwrap();

    let app = app_with_live_qoder(database.clone(), &fake);
    let ids = catalog_ids(&app).await;
    assert_eq!(
        ids.len(),
        FAKE_QODER_ADVERTISED.len(),
        "only the disabled provider's models disappear: {ids:?}"
    );
    assert!(
        ids.iter().all(|id| id.starts_with("qd/")),
        "remaining models belong to the other provider: {ids:?}"
    );

    // The single route drops it too, rather than serving a disabled model.
    let single = app
        .clone()
        .oneshot(get_request("/v1/models/zen%2Fbig-pickle"))
        .await
        .unwrap();
    assert_eq!(single.status(), StatusCode::NOT_FOUND);

    sqlx::query("UPDATE settings SET value = 'true' WHERE key = 'provider_enabled_opencode_zen'")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO settings (key, value) VALUES ('provider_enabled_qoder', 'false')")
        .execute(&pool)
        .await
        .unwrap();

    let flipped = catalog_ids(&app).await;
    assert_eq!(
        flipped.len(),
        OPENCODE_ZEN_MODELS.len(),
        "the other provider is hidden the same way: {flipped:?}"
    );
    assert!(
        flipped.iter().all(|id| id.starts_with("zen/")),
        "{flipped:?}"
    );
    assert_eq!(
        fake.model_list_requests(),
        1,
        "hiding a provider does not make the next request refetch its catalog"
    );

    sqlx::query("UPDATE settings SET value = 'true' WHERE key = 'provider_enabled_qoder'")
        .execute(&pool)
        .await
        .unwrap();

    let ids = catalog_ids(&app).await;
    assert_eq!(
        ids.len(),
        OPENCODE_ZEN_MODELS.len() + FAKE_QODER_ADVERTISED.len(),
        "re-enabling both providers brings both lists back: {ids:?}"
    );
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

/// An app whose qoder adapter fills its catalog from the fake upstream, with one
/// request already served so the snapshot is in place.
async fn live_qoder_app(test_database: &support::TestDatabase, fake: &FakeQoderUpstream) -> Router {
    let app = app_with_live_qoder(
        test_database.connect().await.expect("temporary database"),
        fake,
    );
    let ids = catalog_ids(&app).await;

    assert_eq!(
        ids.len(),
        OPENCODE_ZEN_MODELS.len() + FAKE_QODER_ADVERTISED.len(),
        "the catalog filled and advertised every name it may: {ids:?}"
    );

    app
}

#[tokio::test]
async fn the_single_model_route_answers_for_a_qoder_friendly_id() {
    let database = support::TestDatabase::new().unwrap();
    connect_qoder(&database).await;
    let fake = FakeQoderUpstream::start().await;
    fake.with(|state| state.model_catalog = qoder_catalog_body());
    let app = live_qoder_app(&database, &fake).await;

    for id in FAKE_QODER_ADVERTISED {
        let prefixed = format!("qd/{id}");
        let response = app
            .clone()
            .oneshot(get_request(&format!("/v1/models/qd%2F{id}")))
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK, "{prefixed}");
        let json = json_body(response).await;
        assert_eq!(json["id"], prefixed);
        assert_eq!(json["owned_by"], "qd");
    }

    // A name the upstream row never produced is not advertised, so neither route
    // serves it: the static alias table names models, not the catalog.
    for refused in ["qd%2Fqwen3.7-plus", "qd%2Fhidden-model", "qd%2Fturned-off"] {
        let response = app
            .clone()
            .oneshot(get_request(&format!("/v1/models/{refused}")))
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::NOT_FOUND, "{refused}");
        assert_eq!(
            json_body(response).await["error"]["code"],
            "model_not_found"
        );
    }
}

#[tokio::test]
async fn hiding_one_qoder_name_hides_the_model_under_both() {
    let database = support::TestDatabase::new().unwrap();
    let app_database = database.connect().await.unwrap();
    connect_qoder(&database).await;
    let fake = FakeQoderUpstream::start().await;
    fake.with(|state| state.model_catalog = qoder_catalog_body());

    sqlx::query(
        "INSERT INTO provider_model_overrides (provider_id, model_id, custom, hidden, created_at) \
         VALUES (?, ?, 0, 1, ?)",
    )
    .bind("qoder")
    .bind("qd/qmodel")
    .bind(1_700_000_000_i64)
    .execute(app_database.sqlite_pool().unwrap())
    .await
    .unwrap();

    let app = app_with_live_qoder(app_database.clone(), &fake);
    let ids = catalog_ids(&app).await;

    assert!(
        !ids.contains(&String::from("qd/qmodel")) && !ids.contains(&String::from("qd/qwen-plus")),
        "the sibling name disappears with it: {ids:?}"
    );
    assert_eq!(
        ids.len(),
        OPENCODE_ZEN_MODELS.len() + FAKE_QODER_ADVERTISED.len() - 2,
        "{ids:?}"
    );
    for route in ["qd%2Fqmodel", "qd%2Fqwen-plus"] {
        assert_eq!(
            app.clone()
                .oneshot(get_request(&format!("/v1/models/{route}")))
                .await
                .unwrap()
                .status(),
            StatusCode::NOT_FOUND,
            "{route}"
        );
    }
    assert!(
        ids.contains(&String::from("qd/qmodel_latest")),
        "the next model keeps both of its names: {ids:?}"
    );

    sqlx::query("DELETE FROM provider_model_overrides WHERE model_id = 'qd/qmodel'")
        .execute(app_database.sqlite_pool().unwrap())
        .await
        .unwrap();

    let restored = catalog_ids(&app).await;
    assert_eq!(
        restored.len(),
        OPENCODE_ZEN_MODELS.len() + FAKE_QODER_ADVERTISED.len(),
        "unhiding restores both names: {restored:?}"
    );
}

#[tokio::test]
async fn a_qoder_favorite_shows_on_every_name_of_the_model() {
    let database = support::TestDatabase::new().unwrap();
    let app_database = database.connect().await.unwrap();
    connect_qoder(&database).await;
    let fake = FakeQoderUpstream::start().await;
    fake.with(|state| state.model_catalog = qoder_catalog_body());

    sqlx::query("INSERT INTO favorite_models (model_id, created_at) VALUES (?, ?)")
        .bind("qd/qwen3.7-max")
        .bind(1_700_000_000_i64)
        .execute(app_database.sqlite_pool().unwrap())
        .await
        .unwrap();

    let app = app_with_live_qoder(app_database, &fake);
    let response = app
        .clone()
        .oneshot(get_request("/v1/models"))
        .await
        .unwrap();
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

    assert_eq!(entry("qd/qwen3.7-max")["favorite"], serde_json::json!(true));
    assert_eq!(
        entry("qd/qmodel_latest")["favorite"],
        serde_json::json!(true),
        "favoriting one name favorites the model"
    );
    assert_eq!(entry("qd/auto")["favorite"], serde_json::json!(false));

    let single = app
        .oneshot(get_request("/v1/models/qd%2Fqmodel_latest"))
        .await
        .unwrap();
    assert_eq!(json_body(single).await["favorite"], serde_json::json!(true));
}
