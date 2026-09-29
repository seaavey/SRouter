//! End-to-end tests for the `/v1/providers` management routes. Each test opens
//! its own temporary SQLite database; admin sessions come from a fixture so no
//! admin flow is needed.

mod support;

use axum::body::to_bytes;
use axum::{
    Router,
    body::Body,
    http::{Request, StatusCode},
    response::Response,
};
use srouter_server::app::create_router;
use srouter_server::features::admin_auth::hash_session_token;
use srouter_server::features::providers::ProviderRegistry;
use srouter_server::{AppDatabase, AppState, SecurityState};
use support::{TestDatabase, json_request_with_headers, with_loopback_client};
use tower::ServiceExt;

const SESSION_TOKEN: &str = "test-session-token";

async fn app(database: &TestDatabase) -> Router {
    let security =
        support::sqlx_security_state(database, vec![hash_session_token(SESSION_TOKEN)]).await;
    let state = AppState::with_security(
        support::test_config(),
        ProviderRegistry::with_defaults().expect("default providers"),
        security,
    )
    .with_database(database.connect().await.expect("connect"));

    create_router(state)
}

/// The temporary database's pool, so tests can seed and inspect rows directly.
async fn sqlite(database: &TestDatabase) -> sqlx::SqlitePool {
    database
        .connect()
        .await
        .unwrap()
        .sqlite_pool()
        .unwrap()
        .clone()
}

/// Seeds one `providers` row; `meta` carries the seed marker when the row
/// describes a driver rather than a connection.
async fn insert_provider(
    pool: &sqlx::SqlitePool,
    id: &str,
    provider_id: &str,
    enabled: bool,
    meta: &str,
) {
    sqlx::query(
        "INSERT INTO providers (id, provider_id, name, category, protocol, base_url, enabled, \
         credentials, meta, created_at) \
         VALUES (?, ?, ?, 'free_tier', 'openai', 'https://opencode.ai/zen/v1', ?, '{}', ?, ?)",
    )
    .bind(id)
    .bind(provider_id)
    .bind(format!("Connection {id}"))
    .bind(i64::from(enabled))
    .bind(meta)
    .bind(1_700_000_000_i64)
    .execute(pool)
    .await
    .unwrap();
}

/// A request carrying a valid admin-session cookie.
fn admin_request(method: &str, uri: &str, body: serde_json::Value) -> Request<Body> {
    let cookie = format!("srouter_admin_session={SESSION_TOKEN}");

    json_request_with_headers(method, uri, body, &[("cookie", cookie.as_str())])
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

async fn json_body(response: Response) -> serde_json::Value {
    let bytes = to_bytes(response.into_body(), 65_536).await.unwrap();

    serde_json::from_slice(&bytes).unwrap()
}

/// Reads one model's flag out of a provider detail body.
fn model_flag(body: &serde_json::Value, model_id: &str, flag: &str) -> Option<bool> {
    body["models"]
        .as_array()?
        .iter()
        .find(|entry| entry["id"] == model_id)?[flag]
        .as_bool()
}

fn hidden_flag(body: &serde_json::Value, model_id: &str) -> Option<bool> {
    model_flag(body, model_id, "hidden")
}

fn favorite_flag(body: &serde_json::Value, model_id: &str) -> Option<bool> {
    model_flag(body, model_id, "favorite")
}

async fn override_row_count(pool: &sqlx::SqlitePool, provider_id: &str, model_id: &str) -> i64 {
    sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM provider_model_overrides WHERE provider_id = ? AND model_id = ?",
    )
    .bind(provider_id)
    .bind(model_id)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn favorite_row_count(pool: &sqlx::SqlitePool, model_id: &str) -> i64 {
    sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM favorite_models WHERE model_id = ?")
        .bind(model_id)
        .fetch_one(pool)
        .await
        .unwrap()
}

#[tokio::test]
async fn providers_list_returns_the_seeded_entry() {
    let database = TestDatabase::new().unwrap();
    let body = json_body(
        app(&database)
            .await
            .oneshot(get_request("/v1/providers"))
            .await
            .unwrap(),
    )
    .await;

    assert_eq!(body["object"], "list");
    let entry = &body["data"][0];
    assert_eq!(entry["id"], "opencode_zen");
    assert_eq!(entry["name"], "OpenCode Zen");
    assert_eq!(entry["category"], "free_tier");
    assert_eq!(entry["protocol"], "openai");
    assert_eq!(entry["default_base_url"], "https://opencode.ai/zen/v1");
    assert_eq!(entry["requires_api_key"], serde_json::json!(false));
    assert_eq!(entry["requires_oauth"], serde_json::json!(false));
    assert_eq!(entry["status"]["connected_count"], 0);
    assert_eq!(entry["status"]["state"], "no_connections");
    assert_eq!(entry["status"]["message"], "Free Tier Ready (Unlimited)");
    assert_eq!(entry["enabled"], serde_json::json!(true));
    assert_eq!(entry["models"], serde_json::json!([]));
    assert!(entry.get("round_robin").is_none());
    assert!(entry.get("connections").is_none());
}

#[tokio::test]
async fn providers_list_serves_the_seed_without_a_database() {
    let state = AppState::with_security(
        support::test_config(),
        ProviderRegistry::with_defaults().unwrap(),
        SecurityState::unconfigured(),
    );

    let response = create_router(state)
        .oneshot(get_request("/v1/providers"))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = json_body(response).await;
    assert_eq!(body["data"][0]["enabled"], serde_json::json!(true));
    assert_eq!(body["data"][0]["status"]["connected_count"], 0);
}

#[tokio::test]
async fn catalog_groups_the_seeded_entry_by_category() {
    let database = TestDatabase::new().unwrap();
    let response = app(&database)
        .await
        .oneshot(get_request("/v1/providers/catalog"))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = json_body(response).await;
    assert_eq!(body["total"], 1);
    assert_eq!(body["categories"]["free_tier"][0]["id"], "opencode_zen");
    assert_eq!(
        body["categories"]["free_tier"][0]["enabled"],
        serde_json::json!(true)
    );
    for category in ["oauth", "api_key", "custom_provider"] {
        assert_eq!(
            body["categories"][category],
            serde_json::json!([]),
            "category {category}"
        );
    }
}

#[tokio::test]
async fn catalog_serves_the_seed_without_a_database() {
    let state = AppState::with_security(
        support::test_config(),
        ProviderRegistry::with_defaults().unwrap(),
        SecurityState::unconfigured(),
    );

    let response = create_router(state)
        .oneshot(get_request("/v1/providers/catalog"))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = json_body(response).await;
    assert_eq!(body["total"], 1);
    assert_eq!(
        body["categories"]["free_tier"][0]["enabled"],
        serde_json::json!(true)
    );
}

#[tokio::test]
async fn seed_rows_are_not_counted_as_connections() {
    let database = TestDatabase::new().unwrap();
    let pool = sqlite(&database).await;
    insert_provider(
        &pool,
        "opencode_zen",
        "opencode_zen",
        true,
        r#"{"provider_specific_data":{"__seed__":"true"}}"#,
    )
    .await;

    let response = app(&database)
        .await
        .oneshot(get_request("/v1/providers"))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = json_body(response).await;
    assert_eq!(body["data"][0]["status"]["connected_count"], 0);
    assert_eq!(body["data"][0]["status"]["state"], "no_connections");
    assert!(body["data"][0].get("connections").is_none());
}

#[tokio::test]
async fn a_live_connection_switches_the_state_to_connected() {
    let database = TestDatabase::new().unwrap();
    let pool = sqlite(&database).await;
    insert_provider(&pool, "conn_1", "opencode_zen", true, "{}").await;
    insert_provider(&pool, "conn_2", "opencode_zen_team", true, "{}").await;
    insert_provider(&pool, "conn_3", "opencode_zen-off", false, "{}").await;

    let body = json_body(
        app(&database)
            .await
            .oneshot(get_request("/v1/providers"))
            .await
            .unwrap(),
    )
    .await;

    // The disabled namespace variant is a connection, but it does not count as
    // connected while it stays disabled.
    assert_eq!(body["data"][0]["status"]["connected_count"], 2);
    assert_eq!(body["data"][0]["status"]["state"], "connected");
}

#[tokio::test]
async fn provider_detail_reports_hidden_and_favorite_flags_per_model() {
    let database = TestDatabase::new().unwrap();
    let pool = sqlite(&database).await;

    sqlx::query(
        "INSERT INTO provider_model_overrides (provider_id, model_id, custom, hidden, created_at) \
         VALUES (?, ?, 0, 1, ?)",
    )
    .bind("opencode_zen")
    .bind("zen/big-pickle")
    .bind(1_700_000_000_i64)
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query("INSERT INTO favorite_models (model_id, created_at) VALUES (?, ?)")
        .bind("zen/space-bunny-free")
        .bind(1_700_000_000_i64)
        .execute(&pool)
        .await
        .unwrap();

    let body = json_body(
        app(&database)
            .await
            .oneshot(get_request("/v1/providers/opencode_zen"))
            .await
            .unwrap(),
    )
    .await;

    let model = |id: &str| {
        body["models"]
            .as_array()
            .unwrap()
            .iter()
            .find(|entry| entry["id"] == id)
            .unwrap_or_else(|| panic!("missing model {id}"))
            .clone()
    };

    // A hidden model stays visible here: the admin view is what restores it.
    assert_eq!(model("zen/big-pickle")["hidden"], serde_json::json!(true));
    assert_eq!(
        model("zen/big-pickle")["favorite"],
        serde_json::json!(false)
    );
    assert_eq!(model("zen/big-pickle")["object"], "model");
    assert_eq!(model("zen/big-pickle")["owned_by"], "zen");
    assert_eq!(
        model("zen/space-bunny-free")["hidden"],
        serde_json::json!(false)
    );
    assert_eq!(
        model("zen/space-bunny-free")["favorite"],
        serde_json::json!(true)
    );
    assert_eq!(body["connections"], serde_json::json!([]));
}

#[tokio::test]
async fn provider_detail_never_echoes_stored_credentials() {
    let database = TestDatabase::new().unwrap();
    let pool = sqlite(&database).await;

    sqlx::query(
        "INSERT INTO providers (id, provider_id, name, category, protocol, base_url, enabled, \
         credentials, meta, created_at) \
         VALUES ('conn_1', 'opencode_zen', 'Zen Work', 'free_tier', 'openai', \
         'https://opencode.ai/zen/v1', 1, '{\"api_key\":\"sr-secret-never-echoed\"}', '{}', 1)",
    )
    .execute(&pool)
    .await
    .unwrap();

    let body = json_body(
        app(&database)
            .await
            .oneshot(get_request("/v1/providers/opencode_zen"))
            .await
            .unwrap(),
    )
    .await;

    assert_eq!(body["connections"][0]["id"], "conn_1");
    assert_eq!(body["connections"][0]["name"], "Zen Work");
    assert_eq!(body["connections"][0]["provider_id"], "opencode_zen");
    assert_eq!(body["status"]["connected_count"], 1);
    assert_eq!(body["status"]["state"], "connected");
    assert!(!body.to_string().contains("sr-secret-never-echoed"));
    assert!(!body.to_string().contains("credentials"));
}

#[tokio::test]
async fn provider_detail_is_case_insensitive_and_rejects_unknown_ids() {
    let database = TestDatabase::new().unwrap();
    let app = app(&database).await;

    let found = app
        .clone()
        .oneshot(get_request("/v1/providers/OpenCode_Zen"))
        .await
        .unwrap();
    assert_eq!(found.status(), StatusCode::OK);
    assert_eq!(json_body(found).await["id"], "opencode_zen");

    // Aliases are not served here: the catalog holds base ids only.
    let alias = app
        .clone()
        .oneshot(get_request("/v1/providers/zen"))
        .await
        .unwrap();
    assert_eq!(alias.status(), StatusCode::NOT_FOUND);
    assert_eq!(
        json_body(alias).await["error"]["message"],
        "Provider 'zen' not found"
    );

    let missing = app
        .oneshot(get_request("/v1/providers/does-not-exist"))
        .await
        .unwrap();
    assert_eq!(missing.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn provider_detail_serves_the_seed_without_a_database() {
    let state = AppState::with_security(
        support::test_config(),
        ProviderRegistry::with_defaults().unwrap(),
        SecurityState::unconfigured(),
    );

    let response = create_router(state)
        .oneshot(get_request("/v1/providers/opencode_zen"))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = json_body(response).await;
    assert_eq!(body["status"]["connected_count"], 0);
    assert_eq!(body["connections"], serde_json::json!([]));
    assert!(
        body["models"]
            .as_array()
            .unwrap()
            .iter()
            .all(|entry| entry["hidden"] == serde_json::json!(false))
    );
}

#[tokio::test]
async fn the_hidden_model_routes_are_gone() {
    let database = TestDatabase::new().unwrap();
    let app = app(&database).await;

    // The flags ride along on the detail response, so no route of their own
    // exists: a PATCH on the provider is what changes them.
    for (method, uri) in [
        ("GET", "/v1/providers/opencode_zen/hidden-models"),
        ("POST", "/v1/providers/opencode_zen/hidden-models"),
        (
            "DELETE",
            "/v1/providers/opencode_zen/hidden-models/zen%2Fbig-pickle",
        ),
    ] {
        let response = app
            .clone()
            .oneshot(admin_request(method, uri, serde_json::json!(null)))
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::NOT_FOUND, "{method} {uri}");
    }
}

#[tokio::test]
async fn patching_hides_a_model_and_restores_it() {
    let database = TestDatabase::new().unwrap();
    let app = app(&database).await;

    let hidden = json_body(
        app.clone()
            .oneshot(admin_request(
                "PATCH",
                "/v1/providers/opencode_zen",
                serde_json::json!({ "hide": ["zen/big-pickle"] }),
            ))
            .await
            .unwrap(),
    )
    .await;
    assert_eq!(hidden_flag(&hidden, "zen/big-pickle"), Some(true));

    let pool = sqlite(&database).await;
    assert_eq!(
        override_row_count(&pool, "opencode_zen", "zen/big-pickle").await,
        1
    );

    // Hiding the same model again keeps one row.
    let again = app
        .clone()
        .oneshot(admin_request(
            "PATCH",
            "/v1/providers/opencode_zen",
            serde_json::json!({ "hide": ["zen/big-pickle"] }),
        ))
        .await
        .unwrap();
    assert_eq!(again.status(), StatusCode::OK);
    assert_eq!(
        override_row_count(&pool, "opencode_zen", "zen/big-pickle").await,
        1
    );

    let restored = json_body(
        app.oneshot(admin_request(
            "PATCH",
            "/v1/providers/opencode_zen",
            serde_json::json!({ "restore": ["zen/big-pickle"] }),
        ))
        .await
        .unwrap(),
    )
    .await;
    assert_eq!(hidden_flag(&restored, "zen/big-pickle"), Some(false));
    // A row that carried nothing but the hidden flag is dropped again.
    assert_eq!(
        override_row_count(&pool, "opencode_zen", "zen/big-pickle").await,
        0
    );
}

#[tokio::test]
async fn hiding_a_model_that_is_also_custom_flags_the_existing_row() {
    let database = TestDatabase::new().unwrap();
    let pool = sqlite(&database).await;
    sqlx::query(
        "INSERT INTO provider_model_overrides (provider_id, model_id, custom, hidden, created_at) \
         VALUES ('opencode_zen', 'zen/big-pickle', 1, 0, 1)",
    )
    .execute(&pool)
    .await
    .unwrap();

    let body = json_body(
        app(&database)
            .await
            .oneshot(admin_request(
                "PATCH",
                "/v1/providers/opencode_zen",
                serde_json::json!({ "hide": ["zen/big-pickle"] }),
            ))
            .await
            .unwrap(),
    )
    .await;

    assert_eq!(hidden_flag(&body, "zen/big-pickle"), Some(true));
    assert_eq!(
        override_row_count(&pool, "opencode_zen", "zen/big-pickle").await,
        1
    );
    let custom: i64 = sqlx::query_scalar(
        "SELECT custom FROM provider_model_overrides WHERE provider_id = ? AND model_id = ?",
    )
    .bind("opencode_zen")
    .bind("zen/big-pickle")
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(custom, 1);
}

#[tokio::test]
async fn restoring_a_model_that_is_not_hidden_is_a_no_op() {
    let database = TestDatabase::new().unwrap();
    let pool = sqlite(&database).await;

    let response = app(&database)
        .await
        .oneshot(admin_request(
            "PATCH",
            "/v1/providers/opencode_zen",
            serde_json::json!({ "restore": ["zen/big-pickle"] }),
        ))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        override_row_count(&pool, "opencode_zen", "zen/big-pickle").await,
        0
    );
}

#[tokio::test]
async fn a_patch_applies_the_last_list_that_names_a_model() {
    let database = TestDatabase::new().unwrap();

    let body = json_body(
        app(&database)
            .await
            .oneshot(admin_request(
                "PATCH",
                "/v1/providers/opencode_zen",
                serde_json::json!({
                    "hide": ["zen/big-pickle"],
                    "restore": ["zen/big-pickle"]
                }),
            ))
            .await
            .unwrap(),
    )
    .await;

    // `restore` runs after `hide`, so the model ends up visible.
    assert_eq!(hidden_flag(&body, "zen/big-pickle"), Some(false));
}

#[tokio::test]
async fn patching_favorites_round_trips_through_the_global_table() {
    let database = TestDatabase::new().unwrap();
    let app = app(&database).await;

    let favorited = json_body(
        app.clone()
            .oneshot(admin_request(
                "PATCH",
                "/v1/providers/opencode_zen",
                serde_json::json!({ "favorite": ["Zen/Space-Bunny-Free"] }),
            ))
            .await
            .unwrap(),
    )
    .await;
    assert_eq!(
        favorite_flag(&favorited, "zen/space-bunny-free"),
        Some(true)
    );

    let pool = sqlite(&database).await;
    // The table is global and stores lowercased ids, so one respelled request
    // still lands on a single row.
    assert_eq!(favorite_row_count(&pool, "zen/space-bunny-free").await, 1);

    let again = app
        .clone()
        .oneshot(admin_request(
            "PATCH",
            "/v1/providers/opencode_zen",
            serde_json::json!({ "favorite": ["zen/space-bunny-free"] }),
        ))
        .await
        .unwrap();
    assert_eq!(again.status(), StatusCode::OK);
    assert_eq!(favorite_row_count(&pool, "zen/space-bunny-free").await, 1);

    let unfavorited = json_body(
        app.oneshot(admin_request(
            "PATCH",
            "/v1/providers/opencode_zen",
            serde_json::json!({ "unfavorite": ["ZEN/SPACE-BUNNY-FREE"] }),
        ))
        .await
        .unwrap(),
    )
    .await;
    assert_eq!(
        favorite_flag(&unfavorited, "zen/space-bunny-free"),
        Some(false)
    );
    assert_eq!(favorite_row_count(&pool, "zen/space-bunny-free").await, 0);
}

#[tokio::test]
async fn one_patch_carries_every_edit_at_once() {
    let database = TestDatabase::new().unwrap();

    let body = json_body(
        app(&database)
            .await
            .oneshot(admin_request(
                "PATCH",
                "/v1/providers/opencode_zen",
                serde_json::json!({
                    "enabled": false,
                    "hide": ["zen/big-pickle"],
                    "favorite": ["zen/space-bunny-free"]
                }),
            ))
            .await
            .unwrap(),
    )
    .await;

    assert_eq!(body["enabled"], serde_json::json!(false));
    assert_eq!(hidden_flag(&body, "zen/big-pickle"), Some(true));
    assert_eq!(favorite_flag(&body, "zen/space-bunny-free"), Some(true));
    assert_eq!(
        stored_setting(&sqlite(&database).await, "provider_enabled_opencode_zen").await,
        Some(String::from("false"))
    );
}

#[tokio::test]
async fn a_patch_rejects_an_empty_or_malformed_body() {
    let database = TestDatabase::new().unwrap();
    let app = app(&database).await;

    for body in [
        serde_json::json!({}),
        serde_json::json!({ "nope": true }),
        serde_json::json!({ "hide": [] }),
        serde_json::json!({ "enabled": "yes" }),
        serde_json::json!({ "enabled": 1 }),
        serde_json::json!({ "hide": "zen/big-pickle" }),
        serde_json::json!({ "hide": [7] }),
        serde_json::json!({ "hide": [""] }),
        serde_json::json!({ "hide": ["   "] }),
        serde_json::json!([1, 2]),
        serde_json::json!(null),
    ] {
        let response = app
            .clone()
            .oneshot(admin_request(
                "PATCH",
                "/v1/providers/opencode_zen",
                body.clone(),
            ))
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::BAD_REQUEST, "body: {body}");
        assert_eq!(
            json_body(response).await["error"]["message"],
            "Invalid payload"
        );
    }
}

#[tokio::test]
async fn a_patch_requires_an_admin_session() {
    let database = TestDatabase::new().unwrap();
    let pool = sqlite(&database).await;

    let response = app(&database)
        .await
        .oneshot(support::json_request(
            "PATCH",
            "/v1/providers/opencode_zen",
            serde_json::json!({ "hide": ["zen/big-pickle"] }),
        ))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(
        override_row_count(&pool, "opencode_zen", "zen/big-pickle").await,
        0
    );
}

#[tokio::test]
async fn a_patch_fails_loudly_without_a_database() {
    let state = AppState::with_security(
        support::test_config(),
        ProviderRegistry::with_defaults().unwrap(),
        support::security_state(true, vec![], vec![hash_session_token(SESSION_TOKEN)]),
    );

    let response = create_router(state)
        .oneshot(admin_request(
            "PATCH",
            "/v1/providers/opencode_zen",
            serde_json::json!({ "enabled": false }),
        ))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
}

async fn stored_setting(pool: &sqlx::SqlitePool, key: &str) -> Option<String> {
    sqlx::query_scalar::<_, String>("SELECT value FROM settings WHERE key = ?")
        .bind(key)
        .fetch_optional(pool)
        .await
        .unwrap()
}

#[tokio::test]
async fn disabling_a_provider_persists_a_settings_row_and_echoes_the_flag() {
    let database = TestDatabase::new().unwrap();
    let response = app(&database)
        .await
        .oneshot(admin_request(
            "PATCH",
            "/v1/providers/opencode_zen",
            serde_json::json!({ "enabled": false }),
        ))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = json_body(response).await;
    assert_eq!(body["id"], "opencode_zen");
    assert_eq!(body["enabled"], serde_json::json!(false));
    // The toggle answers with the detail entry, models and all.
    assert_eq!(body["connections"], serde_json::json!([]));
    assert!(!body["models"].as_array().unwrap().is_empty());

    let pool = sqlite(&database).await;
    assert_eq!(
        stored_setting(&pool, "provider_enabled_opencode_zen").await,
        Some(String::from("false"))
    );

    let list = json_body(
        app(&database)
            .await
            .oneshot(get_request("/v1/providers"))
            .await
            .unwrap(),
    )
    .await;
    assert_eq!(list["data"][0]["enabled"], serde_json::json!(false));
}

#[tokio::test]
async fn enabling_a_provider_overwrites_the_stored_flag() {
    let database = TestDatabase::new().unwrap();
    let app = app(&database).await;

    for enabled in [false, true] {
        let response = app
            .clone()
            .oneshot(admin_request(
                "PATCH",
                "/v1/providers/opencode_zen",
                serde_json::json!({ "enabled": enabled }),
            ))
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            json_body(response).await["enabled"],
            serde_json::json!(enabled)
        );
    }

    let pool = sqlite(&database).await;
    assert_eq!(
        stored_setting(&pool, "provider_enabled_opencode_zen").await,
        Some(String::from("true"))
    );
    let rows: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM settings")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(rows, 1);
}

#[tokio::test]
async fn a_namespaced_connection_id_normalizes_to_the_base_provider_flag() {
    let database = TestDatabase::new().unwrap();
    let pool = sqlite(&database).await;
    insert_provider(&pool, "conn_1", "opencode_zen_work", true, "{}").await;

    let response = app(&database)
        .await
        .oneshot(admin_request(
            "PATCH",
            "/v1/providers/opencode_zen_work",
            serde_json::json!({ "enabled": false }),
        ))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    // Written and read through the same key, so the toggle survives a restart.
    assert_eq!(
        stored_setting(&pool, "provider_enabled_opencode_zen").await,
        Some(String::from("false"))
    );
    assert_eq!(
        stored_setting(&pool, "provider_enabled_opencode_zen_work").await,
        None
    );
}

#[tokio::test]
async fn toggling_a_provider_matches_the_path_case_insensitively() {
    let database = TestDatabase::new().unwrap();
    let response = app(&database)
        .await
        .oneshot(admin_request(
            "PATCH",
            "/v1/providers/OpenCode_Zen",
            serde_json::json!({ "enabled": false }),
        ))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(json_body(response).await["id"], "opencode_zen");
    assert_eq!(
        stored_setting(&sqlite(&database).await, "provider_enabled_opencode_zen").await,
        Some(String::from("false"))
    );
}

#[tokio::test]
async fn a_postgres_backend_reads_empty_and_refuses_provider_writes() {
    // Lazily connected: no server is ever contacted, but `sqlite_pool()` is
    // `None`, which is exactly the Postgres code path.
    let pool = sqlx::postgres::PgPoolOptions::new()
        .connect_lazy("postgres://srouter@127.0.0.1:1/srouter")
        .unwrap();
    let state = AppState::with_security(
        support::test_config(),
        ProviderRegistry::with_defaults().unwrap(),
        // Anonymous reads stay allowed, as on the SQLite fixtures.
        support::security_state(false, vec![], vec![hash_session_token(SESSION_TOKEN)]),
    )
    .with_database(AppDatabase::Postgres(pool));
    let app = create_router(state);

    let listed = app
        .clone()
        .oneshot(get_request("/v1/providers"))
        .await
        .unwrap();
    assert_eq!(listed.status(), StatusCode::OK);
    let body = json_body(listed).await;
    assert_eq!(body["data"][0]["status"]["connected_count"], 0);
    assert_eq!(body["data"][0]["enabled"], serde_json::json!(true));

    let write = app
        .oneshot(admin_request(
            "PATCH",
            "/v1/providers/opencode_zen",
            serde_json::json!({ "enabled": false }),
        ))
        .await
        .unwrap();
    assert_eq!(write.status(), StatusCode::INTERNAL_SERVER_ERROR);
    let body = json_body(write).await;
    assert!(
        body["error"]["message"]
            .as_str()
            .unwrap()
            .contains("PostgreSQL"),
        "unexpected message: {body}"
    );
}

#[tokio::test]
async fn the_compat_alias_does_not_serve_providers() {
    let database = TestDatabase::new().unwrap();
    let app = app(&database).await;

    // Like `/v1/keys`, the `/v1/v1` alias carries the gateway routes only.
    let response = app.oneshot(get_request("/v1/v1/providers")).await.unwrap();

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn patching_an_unknown_provider_is_rejected() {
    let database = TestDatabase::new().unwrap();
    let response = app(&database)
        .await
        .oneshot(admin_request(
            "PATCH",
            "/v1/providers/does-not-exist",
            serde_json::json!({ "enabled": true }),
        ))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        json_body(response).await["error"]["message"],
        "Provider 'does-not-exist' not found"
    );
    assert_eq!(
        stored_setting(&sqlite(&database).await, "provider_enabled_does-not-exist").await,
        None
    );
}

#[tokio::test]
async fn enabled_requires_a_boolean_and_an_admin_session() {
    let database = TestDatabase::new().unwrap();
    let app = app(&database).await;

    for body in [
        serde_json::json!({ "enabled": "yes" }),
        serde_json::json!({ "enabled": 1 }),
        serde_json::json!({}),
    ] {
        let response = app
            .clone()
            .oneshot(admin_request(
                "PATCH",
                "/v1/providers/opencode_zen",
                body.clone(),
            ))
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::BAD_REQUEST, "body: {body}");
    }

    let denied = app
        .oneshot(support::json_request(
            "PATCH",
            "/v1/providers/opencode_zen",
            serde_json::json!({ "enabled": false }),
        ))
        .await
        .unwrap();
    assert_eq!(denied.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(
        stored_setting(&sqlite(&database).await, "provider_enabled_opencode_zen").await,
        None
    );
}

#[tokio::test]
async fn a_connection_with_unreadable_meta_is_still_counted() {
    let database = TestDatabase::new().unwrap();
    let pool = sqlite(&database).await;
    insert_provider(&pool, "conn_1", "opencode_zen", true, "{not json").await;

    let response = app(&database)
        .await
        .oneshot(get_request("/v1/providers"))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = json_body(response).await;
    assert_eq!(body["data"][0]["status"]["connected_count"], 1);
}
