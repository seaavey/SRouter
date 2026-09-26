mod support;

use std::collections::HashSet;

use sha2::{Digest, Sha256};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::{Row, SqlitePool};
use support::TestDatabase;

const V2_TABLES: [&str; 10] = [
    "admin_accounts",
    "admin_sessions",
    "api_keys",
    "favorite_models",
    "fallback_rules",
    "oauth_sessions",
    "provider_model_overrides",
    "providers",
    "request_logs",
    "settings",
];

const V2_INDEXES: [&str; 5] = [
    "idx_api_keys_key_hash",
    "idx_request_logs_created",
    "idx_request_logs_provider",
    "idx_request_logs_model",
    "idx_fallback_priority",
];

#[tokio::test]
async fn fresh_database_gets_the_complete_v2_schema() {
    let test_database = TestDatabase::new().expect("temporary database");
    let database = test_database.connect().await.expect("connect to SQLite");
    let pool = database.sqlite_pool().expect("SQLite pool").clone();

    assert_eq!(user_version(&pool).await, 2, "user_version must be 2");

    let tables = table_names(&pool).await;
    for expected in V2_TABLES {
        assert!(tables.contains(expected), "missing table {expected}");
    }
    assert_eq!(
        tables.len(),
        V2_TABLES.len(),
        "unexpected extra tables: {tables:?}"
    );

    let indexes = index_names(&pool).await;
    for expected in V2_INDEXES {
        assert!(
            indexes.contains(expected),
            "missing index {expected}; found {indexes:?}"
        );
    }

    // Reconnecting must be a no-op: the version gate skips the schema run.
    pool.close().await;
    drop(database);
    let reopened = test_database.connect().await.expect("reconnect");
    let reopened_pool = reopened.sqlite_pool().expect("SQLite pool").clone();
    assert_eq!(table_names(&reopened_pool).await.len(), V2_TABLES.len());
}

#[tokio::test]
async fn legacy_v1_database_is_transformed_to_v2() {
    let test_database = TestDatabase::new().expect("temporary database");
    seed_legacy_database(test_database.path()).await;

    let database = test_database.connect().await.expect("migrate legacy file");
    let pool = database.sqlite_pool().expect("SQLite pool").clone();

    assert_eq!(user_version(&pool).await, 2);

    // Renamed and merged tables.
    let tables = table_names(&pool).await;
    for legacy in [
        "admin_account",
        "custom_models",
        "hidden_models",
        "system_settings",
        "srouter_schema_meta",
    ] {
        assert!(!tables.contains(legacy), "legacy table {legacy} remains");
    }
    for expected in V2_TABLES {
        assert!(tables.contains(expected), "missing table {expected}");
    }
    let indexes = index_names(&pool).await;
    for expected in V2_INDEXES {
        assert!(indexes.contains(expected), "missing index {expected}");
    }

    // Singleton admin account survives the rename untouched.
    let password: String =
        sqlx::query_scalar("SELECT password_hash FROM admin_accounts WHERE id = 1")
            .fetch_one(&pool)
            .await
            .expect("admin row");
    assert_eq!(password, "scrypt$16384$8$1$c2FsdA$aGFzaA");

    // settings keeps the require_api_key row after the rename.
    let required: String =
        sqlx::query_scalar("SELECT value FROM settings WHERE key = 'require_api_key'")
            .fetch_one(&pool)
            .await
            .expect("setting row");
    assert_eq!(required, "true");

    // api_keys: plaintext key becomes hash + prefix, NULL numerics default.
    let columns = table_columns(&pool, "api_keys").await;
    assert!(
        !columns.contains("key"),
        "plaintext key column must be gone"
    );
    assert!(columns.contains("key_hash"));

    let row = sqlx::query(
        "SELECT key_hash, key_prefix, name, enabled, rate_limit, quota_limit, \
         credit_limit, usage_cost, allowed_models FROM api_keys WHERE id = 'key_1'",
    )
    .fetch_one(&pool)
    .await
    .expect("key_1 row");
    assert_eq!(
        row.try_get::<String, _>("key_hash").unwrap(),
        sha256_hex("sr-live-aaaaaaaaaaaaaaaa")
    );
    assert_eq!(row.try_get::<String, _>("key_prefix").unwrap(), "sr-live-");
    assert_eq!(row.try_get::<String, _>("name").unwrap(), "Alpha");
    assert_eq!(row.try_get::<i64, _>("enabled").unwrap(), 1);
    assert_eq!(row.try_get::<i64, _>("rate_limit").unwrap(), 0);
    assert_eq!(row.try_get::<i64, _>("quota_limit").unwrap(), 0);
    assert_eq!(row.try_get::<f64, _>("credit_limit").unwrap(), 0.0);
    assert_eq!(row.try_get::<f64, _>("usage_cost").unwrap(), 0.0);
    assert_eq!(
        row.try_get::<String, _>("allowed_models").unwrap(),
        r#"["gpt-x"]"#
    );

    let second = sqlx::query(
        "SELECT key_hash, credit_limit, usage_cost, enabled FROM api_keys WHERE id = 'key_2'",
    )
    .fetch_one(&pool)
    .await
    .expect("key_2 row");
    assert_eq!(
        second.try_get::<String, _>("key_hash").unwrap(),
        sha256_hex("sr-live-bbbbbbbbbbbbbbbb")
    );
    assert_eq!(second.try_get::<f64, _>("credit_limit").unwrap(), 25.5);
    assert_eq!(second.try_get::<f64, _>("usage_cost").unwrap(), 1.25);
    assert_eq!(second.try_get::<i64, _>("enabled").unwrap(), 0);

    // providers: credential columns collapse into JSON, meta keeps headers.
    let provider = sqlx::query(
        "SELECT credentials, meta, alias, base_url, enabled, created_at \
         FROM providers WHERE id = 'prov_1'",
    )
    .fetch_one(&pool)
    .await
    .expect("provider row");
    let credentials: serde_json::Value =
        serde_json::from_str(&provider.try_get::<String, _>("credentials").unwrap()).unwrap();
    assert_eq!(credentials["api_key"], "sk-upstream");
    assert_eq!(credentials["access_token"], "tok");
    assert_eq!(credentials["refresh_token"], "ref");
    assert_eq!(credentials["account_id"], "acct");
    assert_eq!(credentials["organization_id"], "org");
    assert_eq!(credentials["token_expires_at"], 1_700_000_000_000i64);
    assert_eq!(credentials["last_refreshed_at"], 1_700_000_100_000i64);

    let meta: serde_json::Value =
        serde_json::from_str(&provider.try_get::<String, _>("meta").unwrap()).unwrap();
    assert_eq!(meta["custom_headers"]["x-test"], "1");
    assert_eq!(meta["provider_specific_data"]["seed"], "true");

    assert!(
        provider
            .try_get::<Option<String>, _>("alias")
            .unwrap()
            .is_none()
    );
    assert_eq!(
        provider.try_get::<String, _>("base_url").unwrap(),
        "https://api.openai.com/v1"
    );
    assert_eq!(provider.try_get::<i64, _>("enabled").unwrap(), 1);
    assert_eq!(provider.try_get::<i64, _>("created_at").unwrap(), 500);

    // custom + hidden merge into one table with two flags.
    let overrides = sqlx::query(
        "SELECT model_id, custom, hidden FROM provider_model_overrides \
         WHERE provider_id = 'prov_1' ORDER BY model_id",
    )
    .fetch_all(&pool)
    .await
    .expect("override rows");
    let rendered: Vec<(String, i64, i64)> = overrides
        .iter()
        .map(|row| {
            (
                row.try_get::<String, _>("model_id").unwrap(),
                row.try_get::<i64, _>("custom").unwrap(),
                row.try_get::<i64, _>("hidden").unwrap(),
            )
        })
        .collect();
    assert_eq!(
        rendered,
        vec![
            ("both-model".to_owned(), 1, 1),
            ("gone-model".to_owned(), 0, 1),
            ("my-model".to_owned(), 1, 0),
        ]
    );

    // fallback_rules: NULL max_retries becomes 1, other fields untouched.
    let fallback = sqlx::query(
        "SELECT priority, enabled, trigger_on_status, max_retries FROM fallback_rules \
         WHERE id = 'fb_1'",
    )
    .fetch_one(&pool)
    .await
    .expect("fallback row");
    assert_eq!(fallback.try_get::<i64, _>("priority").unwrap(), 2);
    assert_eq!(fallback.try_get::<i64, _>("enabled").unwrap(), 1);
    assert_eq!(
        fallback.try_get::<String, _>("trigger_on_status").unwrap(),
        "[429,500]"
    );
    assert_eq!(fallback.try_get::<i64, _>("max_retries").unwrap(), 1);

    // Untouched tables keep their rows verbatim.
    let sessions: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM admin_sessions")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(sessions, 1);
    let favorites: String = sqlx::query_scalar("SELECT model_id FROM favorite_models")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(favorites, "fav-model");
    let oauth: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM oauth_sessions")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(oauth, 1);
    let logs: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM request_logs")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(logs, 1);
    let log = sqlx::query(
        "SELECT prompt_tokens, cached_tokens, estimated_cost, fallback_occurred \
         FROM request_logs WHERE id = 'log_1'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(log.try_get::<i64, _>("prompt_tokens").unwrap(), 10);
    assert_eq!(log.try_get::<i64, _>("cached_tokens").unwrap(), 1);
    assert_eq!(log.try_get::<f64, _>("estimated_cost").unwrap(), 0.5);
    assert_eq!(log.try_get::<i64, _>("fallback_occurred").unwrap(), 0);

    // A second connect is a no-op on the migrated file.
    pool.close().await;
    drop(database);
    let reopened = test_database.connect().await.expect("reconnect");
    let reopened_pool = reopened.sqlite_pool().expect("SQLite pool").clone();
    let logs_after: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM request_logs")
        .fetch_one(&reopened_pool)
        .await
        .unwrap();
    assert_eq!(logs_after, 1);
}

#[tokio::test]
async fn legacy_database_with_missing_optional_columns_still_migrates() {
    let test_database = TestDatabase::new().expect("temporary database");
    let options = SqliteConnectOptions::new()
        .filename(test_database.path())
        .create_if_missing(true);
    let pool = SqlitePoolOptions::new()
        .connect_with(options)
        .await
        .expect("seed pool");

    // An old install: providers lacks every late-added column, request_logs
    // lacks its analytics columns, oauth_sessions lacks claim tracking.
    sqlx::raw_sql(
        r#"
        CREATE TABLE providers (
            id TEXT PRIMARY KEY,
            provider_id TEXT NOT NULL,
            name TEXT NOT NULL,
            category TEXT NOT NULL,
            protocol TEXT NOT NULL,
            base_url TEXT,
            api_key TEXT,
            enabled INTEGER NOT NULL DEFAULT 1,
            created_at INTEGER NOT NULL
        );
        CREATE TABLE request_logs (
            id TEXT PRIMARY KEY,
            provider_id TEXT NOT NULL,
            model TEXT NOT NULL,
            prompt_tokens INTEGER NOT NULL DEFAULT 0,
            completion_tokens INTEGER NOT NULL DEFAULT 0,
            total_tokens INTEGER NOT NULL DEFAULT 0,
            status_code INTEGER NOT NULL,
            latency_ms INTEGER NOT NULL,
            created_at INTEGER NOT NULL
        );
        CREATE TABLE oauth_sessions (
            state TEXT PRIMARY KEY,
            code_verifier TEXT NOT NULL,
            client_id TEXT NOT NULL,
            redirect_uri TEXT NOT NULL,
            created_at INTEGER NOT NULL
        );
        CREATE TABLE srouter_schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        INSERT INTO srouter_schema_meta (key, value) VALUES ('schema_version', '1');
        INSERT INTO providers (id, provider_id, name, category, protocol, base_url, api_key, enabled, created_at)
            VALUES ('prov_old', 'openai', 'Old', 'api_key', 'openai', 'https://api.openai.com/v1', 'sk-old', 1, 42);
        INSERT INTO request_logs (id, provider_id, model, prompt_tokens, completion_tokens, total_tokens, status_code, latency_ms, created_at)
            VALUES ('log_old', 'prov_old', 'gpt-x', 1, 2, 3, 200, 10, 43);
        "#,
    )
    .execute(&pool)
    .await
    .expect("seed legacy drift schema");
    pool.close().await;

    let database = test_database.connect().await.expect("migrate drift file");
    let migrated = database.sqlite_pool().expect("SQLite pool").clone();

    assert_eq!(user_version(&migrated).await, 2);

    // request_logs gained the columns Node's ALTERs used to add.
    let columns = table_columns(&migrated, "request_logs").await;
    for expected in [
        "ip_address",
        "cached_tokens",
        "estimated_cost",
        "resolved_model",
    ] {
        assert!(
            columns.contains(expected),
            "request_logs missing {expected}"
        );
    }
    let oauth_columns = table_columns(&migrated, "oauth_sessions").await;
    assert!(oauth_columns.contains("claimed_at"));
    assert!(oauth_columns.contains("device_code"));

    // providers was rebuilt into the full v2 shape with JSON credentials.
    let provider_columns = table_columns(&migrated, "providers").await;
    for expected in ["credentials", "meta", "alias", "base_url"] {
        assert!(
            provider_columns.contains(expected),
            "providers missing {expected}"
        );
    }
    let credentials: String =
        sqlx::query_scalar("SELECT credentials FROM providers WHERE id = 'prov_old'")
            .fetch_one(&migrated)
            .await
            .unwrap();
    assert!(credentials.contains("sk-old"));

    // The untouched log row survived with its late-added columns defaulted.
    let tokens: i64 =
        sqlx::query_scalar("SELECT cached_tokens FROM request_logs WHERE id = 'log_old'")
            .fetch_one(&migrated)
            .await
            .unwrap();
    assert_eq!(tokens, 0);
}

#[tokio::test]
async fn newer_schema_version_is_refused() {
    let test_database = TestDatabase::new().expect("temporary database");
    let options = SqliteConnectOptions::new()
        .filename(test_database.path())
        .create_if_missing(true);
    let pool = SqlitePoolOptions::new()
        .connect_with(options)
        .await
        .expect("seed pool");
    sqlx::query("PRAGMA user_version = 99")
        .execute(&pool)
        .await
        .expect("set future version");
    pool.close().await;

    let error = match test_database.connect().await {
        Ok(_) => panic!("a newer schema must be refused"),
        Err(error) => error,
    };

    assert!(
        error.to_string().contains("newer"),
        "unexpected error: {error}"
    );
    assert!(
        error.to_string().contains("99"),
        "error must name the found version: {error}"
    );
}

/// The exact v1 layout observed from a Node-created database (probe dump).
const LEGACY_V1_SCHEMA: &str = r#"
    CREATE TABLE admin_account (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        password_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
    );
    CREATE TABLE admin_sessions (
        token_hash TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
    );
    CREATE TABLE api_keys (
        id TEXT PRIMARY KEY,
        key TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        rate_limit INTEGER DEFAULT 0,
        quota_limit INTEGER DEFAULT 0,
        usage_tokens INTEGER DEFAULT 0,
        credit_limit REAL DEFAULT 0,
        usage_cost REAL DEFAULT 0,
        allowed_models TEXT,
        created_at INTEGER NOT NULL
    );
    CREATE TABLE providers (
        id TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL,
        name TEXT NOT NULL,
        alias TEXT,
        category TEXT NOT NULL,
        protocol TEXT NOT NULL,
        base_url TEXT,
        api_key TEXT,
        access_token TEXT,
        refresh_token TEXT,
        account_id TEXT,
        organization_id TEXT,
        provider_specific_data TEXT,
        custom_headers TEXT,
        token_expires_at INTEGER,
        last_refreshed_at INTEGER,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL
    );
    CREATE TABLE custom_models (
        provider_id TEXT NOT NULL,
        model_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (provider_id, model_id)
    );
    CREATE TABLE hidden_models (
        provider_id TEXT NOT NULL,
        model_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (provider_id, model_id)
    );
    CREATE TABLE favorite_models (
        model_id TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL
    );
    CREATE TABLE fallback_rules (
        id TEXT PRIMARY KEY,
        source_model TEXT NOT NULL,
        target_model TEXT NOT NULL,
        priority INTEGER NOT NULL DEFAULT 1,
        enabled INTEGER NOT NULL DEFAULT 1,
        trigger_on_status TEXT,
        max_retries INTEGER DEFAULT 1,
        created_at INTEGER NOT NULL
    );
    CREATE TABLE oauth_sessions (
        state TEXT PRIMARY KEY,
        code_verifier TEXT NOT NULL,
        device_code TEXT,
        client_id TEXT NOT NULL,
        redirect_uri TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        claimed_at INTEGER
    );
    CREATE TABLE request_logs (
        id TEXT PRIMARY KEY,
        api_key_id TEXT,
        ip_address TEXT,
        user_agent TEXT,
        provider_id TEXT NOT NULL,
        model TEXT NOT NULL,
        prompt_tokens INTEGER NOT NULL DEFAULT 0,
        completion_tokens INTEGER NOT NULL DEFAULT 0,
        total_tokens INTEGER NOT NULL DEFAULT 0,
        status_code INTEGER NOT NULL,
        latency_ms INTEGER NOT NULL,
        cached_tokens INTEGER NOT NULL DEFAULT 0,
        cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
        reasoning_tokens INTEGER NOT NULL DEFAULT 0,
        estimated_cost REAL NOT NULL DEFAULT 0,
        fallback_occurred INTEGER NOT NULL DEFAULT 0,
        fallback_path TEXT,
        fallback_reason TEXT,
        resolved_model TEXT,
        created_at INTEGER NOT NULL
    );
    CREATE TABLE system_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE srouter_schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE INDEX idx_request_logs_created_at ON request_logs (created_at DESC);
    CREATE INDEX idx_custom_models_provider ON custom_models (provider_id, created_at ASC);

    INSERT INTO srouter_schema_meta (key, value) VALUES ('schema_version', '1');
    INSERT INTO admin_account (id, password_hash, created_at, updated_at)
        VALUES (1, 'scrypt$16384$8$1$c2FsdA$aGFzaA', 100, 200);
    INSERT INTO admin_sessions (token_hash, created_at, expires_at)
        VALUES ('sessionhash', 100, 900);
    INSERT INTO api_keys (id, key, name, enabled, rate_limit, quota_limit, usage_tokens, credit_limit, usage_cost, allowed_models, created_at)
        VALUES ('key_1', 'sr-live-aaaaaaaaaaaaaaaa', 'Alpha', 1, NULL, NULL, 0, NULL, 0, '["gpt-x"]', 1000);
    INSERT INTO api_keys (id, key, name, enabled, rate_limit, quota_limit, usage_tokens, credit_limit, usage_cost, allowed_models, created_at)
        VALUES ('key_2', 'sr-live-bbbbbbbbbbbbbbbb', 'Beta', 0, 60, 1000, 5, 25.5, 1.25, NULL, 1001);
    INSERT INTO providers (id, provider_id, name, alias, category, protocol, base_url, api_key, access_token, refresh_token, account_id, organization_id, provider_specific_data, custom_headers, token_expires_at, last_refreshed_at, enabled, created_at)
        VALUES ('prov_1', 'openai', 'OpenAI One', NULL, 'api_key', 'openai', 'https://api.openai.com/v1', 'sk-upstream', 'tok', 'ref', 'acct', 'org', '{"seed":"true"}', '{"x-test":"1"}', 1700000000000, 1700000100000, 1, 500);
    INSERT INTO custom_models (provider_id, model_id, created_at) VALUES ('prov_1', 'my-model', 600);
    INSERT INTO custom_models (provider_id, model_id, created_at) VALUES ('prov_1', 'both-model', 610);
    INSERT INTO hidden_models (provider_id, model_id, created_at) VALUES ('prov_1', 'both-model', 620);
    INSERT INTO hidden_models (provider_id, model_id, created_at) VALUES ('prov_1', 'gone-model', 630);
    INSERT INTO favorite_models (model_id, created_at) VALUES ('fav-model', 700);
    INSERT INTO fallback_rules (id, source_model, target_model, priority, enabled, trigger_on_status, max_retries, created_at)
        VALUES ('fb_1', 'a', 'b', 2, 1, '[429,500]', NULL, 800);
    INSERT INTO oauth_sessions (state, code_verifier, device_code, client_id, redirect_uri, created_at, claimed_at)
        VALUES ('state1', 'verifier', 'device1', 'client', 'http://localhost:1455/cb', 900, NULL);
    INSERT INTO request_logs (id, api_key_id, ip_address, user_agent, provider_id, model, prompt_tokens, completion_tokens, total_tokens, status_code, latency_ms, cached_tokens, cache_creation_tokens, reasoning_tokens, estimated_cost, fallback_occurred, fallback_path, fallback_reason, resolved_model, created_at)
        VALUES ('log_1', 'key_1', '127.0.0.1', 'agent', 'prov_1', 'gpt-x', 10, 20, 30, 200, 123, 1, 2, 3, 0.5, 0, NULL, NULL, NULL, 1000);
    INSERT INTO system_settings (key, value) VALUES ('require_api_key', 'true');
"#;

async fn seed_legacy_database(path: &std::path::Path) {
    let options = SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(true);
    let pool = SqlitePoolOptions::new()
        .connect_with(options)
        .await
        .expect("seed pool");

    sqlx::raw_sql(LEGACY_V1_SCHEMA)
        .execute(&pool)
        .await
        .expect("seed v1");
    pool.close().await;
}

fn sha256_hex(input: &str) -> String {
    hex::encode(Sha256::digest(input.as_bytes()))
}

async fn user_version(pool: &SqlitePool) -> i64 {
    sqlx::query_scalar("PRAGMA user_version")
        .fetch_one(pool)
        .await
        .expect("read user_version")
}

async fn table_names(pool: &SqlitePool) -> HashSet<String> {
    let rows = sqlx::query("SELECT name FROM sqlite_master WHERE type = 'table'")
        .fetch_all(pool)
        .await
        .expect("list tables");

    rows.iter()
        .filter_map(|row| row.try_get::<String, _>("name").ok())
        .filter(|name| !name.starts_with("sqlite_"))
        .collect()
}

async fn index_names(pool: &SqlitePool) -> HashSet<String> {
    let rows =
        sqlx::query("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%'")
            .fetch_all(pool)
            .await
            .expect("list indexes");

    rows.iter()
        .filter_map(|row| row.try_get::<String, _>("name").ok())
        .collect()
}

async fn table_columns(pool: &SqlitePool, table: &str) -> HashSet<String> {
    // `table` is always a literal from this test file, never user input.
    let statement = format!("SELECT name FROM pragma_table_info('{table}')");
    let rows = sqlx::raw_sql(sqlx::AssertSqlSafe(statement))
        .fetch_all(pool)
        .await
        .expect("list columns");

    rows.iter()
        .filter_map(|row| row.try_get::<String, _>("name").ok())
        .collect()
}
