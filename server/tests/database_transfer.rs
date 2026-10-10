//! End-to-end tests for `/v1/admin/database/*`.
//!
//! Behavioral oracle: `apps/api/tests/database-route.test.ts` (8 cases). Every
//! test runs against a disposable database under `TestDatabase`, whose `HOME`
//! points at the temp dir, so the transfer temp dirs and backups land there and
//! never in `~/.srouter`.

mod support;

use std::path::Path;

use axum::Router;
use axum::body::{Body, to_bytes};
use axum::http::{Request, StatusCode, header};
use axum::response::Response;
use srouter_server::app::create_router;
use srouter_server::features::admin_auth::hash_session_token;
use srouter_server::features::providers::ProviderRegistry;
use srouter_server::{AppState, infrastructure::database::AppDatabase};
use support::{TestDatabase, sqlx_admin_security_state, with_loopback_client, with_remote_client};
use tower::ServiceExt;

const EXPORT: &str = "/v1/admin/database/export";
const IMPORT: &str = "/v1/admin/database/import";
const REMOTE: &str = "203.0.113.7";

/// A session token seeded into the admin session store for this test.
const SESSION_TOKEN: &str = "database-transfer-test-session";

fn session_cookie() -> String {
    format!("srouter_admin_session={SESSION_TOKEN}")
}

async fn app(database: &TestDatabase) -> (Router, srouter_server::AppDatabase) {
    let app_database = database.connect().await.expect("connect database");
    let security = sqlx_admin_security_state(database).await;
    // Use the test database's own config so `srouter_dir` (and therefore the
    // transfer temp dir and backups) lands inside the disposable directory.
    let state = AppState::with_security(
        database.config().expect("test configuration"),
        ProviderRegistry::new(),
        security,
    )
    .with_database(app_database.clone());

    (create_router(state), app_database)
}

/// Creates an admin session row so the guard accepts `SESSION_TOKEN`.
async fn seed_session(database: &TestDatabase) {
    let app_database = database.connect().await.expect("connect database");
    let pool = app_database.sqlite_pool().expect("SQLite pool");
    sqlx::query("INSERT INTO admin_sessions (token_hash, created_at, expires_at) VALUES (?, ?, ?)")
        .bind(hash_session_token(SESSION_TOKEN))
        .bind(0i64)
        .bind(i64::MAX)
        .execute(&pool)
        .await
        .expect("seed admin session");
}

fn get(uri: &str) -> Request<Body> {
    Request::builder()
        .method("GET")
        .uri(uri)
        .body(Body::empty())
        .unwrap()
}

fn multipart_request(body: &[u8], boundary: &str) -> Request<Body> {
    Request::builder()
        .method("POST")
        .uri(IMPORT)
        .header(
            header::CONTENT_TYPE,
            format!("multipart/form-data; boundary={boundary}"),
        )
        .header(header::COOKIE, session_cookie())
        .body(Body::from(body.to_vec()))
        .unwrap()
}

fn multipart_body(boundary: &str, parts: &[&str]) -> Vec<u8> {
    let mut body = Vec::new();
    for part in parts {
        body.extend_from_slice(format!("--{boundary}\r\n{part}\r\n").as_bytes());
    }
    body.extend_from_slice(format!("--{boundary}--\r\n").as_bytes());
    body
}

/// Builds a single-file multipart body from raw bytes, so a binary SQLite file
/// survives the trip.
fn multipart_file_body(boundary: &str, disposition: &str, contents: &[u8]) -> Vec<u8> {
    let mut body = Vec::new();
    body.extend_from_slice(
        format!("--{boundary}\r\n{disposition}\r\nContent-Type: application/octet-stream\r\n\r\n")
            .as_bytes(),
    );
    body.extend_from_slice(contents);
    body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
    body
}

async fn json_body(response: Response) -> serde_json::Value {
    let bytes = to_bytes(response.into_body(), 1 << 20).await.unwrap();
    serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null)
}

/// Writes a valid v3 SQLite file at `path` with one row in `settings`.
async fn write_valid_candidate(path: &Path) {
    let options = sqlx::sqlite::SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(true);
    let pool = sqlx::sqlite::SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .expect("candidate pool");

    let schema = include_str!("../migrations/0002_v2_schema.sql");
    sqlx::raw_sql(sqlx::AssertSqlSafe(schema.to_owned()))
        .execute(&pool)
        .await
        .expect("candidate schema");
    sqlx::raw_sql(sqlx::AssertSqlSafe(
        include_str!("../migrations/0003_request_logs.sql").to_owned(),
    ))
    .execute(&pool)
    .await
    .expect("candidate v3 schema");
    sqlx::query("PRAGMA user_version = 3")
        .execute(&pool)
        .await
        .expect("record version");
    sqlx::query("INSERT INTO settings (key, value) VALUES ('imported_marker', 'yes')")
        .execute(&pool)
        .await
        .expect("seed marker");
    pool.close().await;
}

async fn write_raw_candidate(path: &Path, contents: &[u8]) {
    std::fs::write(path, contents).expect("candidate file");
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

#[tokio::test]
async fn export_requires_an_admin_session_and_rejects_api_keys_and_loopback() {
    let database = TestDatabase::new().unwrap();
    seed_session(&database).await;
    let (app, _) = app(&database).await;

    let anonymous = app
        .clone()
        .oneshot(with_remote_client(get(EXPORT), REMOTE))
        .await
        .unwrap();
    assert_eq!(anonymous.status(), StatusCode::UNAUTHORIZED);

    let api_key = app
        .clone()
        .oneshot(with_remote_client(
            Request::builder()
                .method("GET")
                .uri(EXPORT)
                .header("x-api-key", "sr-live-test")
                .body(Body::empty())
                .unwrap(),
            REMOTE,
        ))
        .await
        .unwrap();
    assert_eq!(api_key.status(), StatusCode::UNAUTHORIZED);

    let loopback = app
        .clone()
        .oneshot(with_loopback_client(get(EXPORT)))
        .await
        .unwrap();
    assert_eq!(loopback.status(), StatusCode::UNAUTHORIZED);

    let authorized = app
        .oneshot(with_remote_client(
            Request::builder()
                .method("GET")
                .uri(EXPORT)
                .header(header::COOKIE, session_cookie())
                .body(Body::empty())
                .unwrap(),
            REMOTE,
        ))
        .await
        .unwrap();
    assert_eq!(authorized.status(), StatusCode::OK);
    assert_eq!(
        authorized
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok()),
        Some("application/octet-stream")
    );
    let disposition = authorized
        .headers()
        .get(header::CONTENT_DISPOSITION)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_owned();
    assert!(disposition.starts_with("attachment; filename=\"srouter-backup-"));
    assert!(disposition.ends_with(".db\""));
    assert!(authorized.headers().contains_key(header::CONTENT_LENGTH));

    // The body is a readable SQLite file.
    let bytes = to_bytes(authorized.into_body(), 64 << 20).await.unwrap();
    assert!(bytes.starts_with(b"SQLite format 3\0"));
}

// ---------------------------------------------------------------------------
// Import: auth
// ---------------------------------------------------------------------------

#[tokio::test]
async fn import_requires_an_admin_session() {
    let database = TestDatabase::new().unwrap();
    seed_session(&database).await;
    let (app, _) = app(&database).await;

    for request in [
        with_remote_client(
            Request::builder()
                .method("POST")
                .uri(IMPORT)
                .body(Body::empty())
                .unwrap(),
            REMOTE,
        ),
        with_remote_client(
            Request::builder()
                .method("POST")
                .uri(IMPORT)
                .header("x-api-key", "sr-live-test")
                .body(Body::empty())
                .unwrap(),
            REMOTE,
        ),
        with_loopback_client(
            Request::builder()
                .method("POST")
                .uri(IMPORT)
                .body(Body::empty())
                .unwrap(),
        ),
    ] {
        let response = app.clone().oneshot(request).await.unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }
}

// ---------------------------------------------------------------------------
// Import: happy path
// ---------------------------------------------------------------------------

#[tokio::test]
async fn import_replaces_the_database_and_is_visible_through_an_existing_router() {
    let database = TestDatabase::new().unwrap();
    seed_session(&database).await;
    let (app, app_database) = app(&database).await;

    let candidate = database.path().with_extension("candidate.db");
    write_valid_candidate(&candidate).await;
    let contents = std::fs::read(&candidate).unwrap();

    let boundary = "database-upload";
    let body = multipart_file_body(
        boundary,
        "Content-Disposition: form-data; name=\"database\"; filename=\"source.db\"",
        &contents,
    );

    let response = app
        .clone()
        .oneshot(multipart_request(&body, boundary))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = json_body(response).await;
    assert_eq!(body["ok"], true);
    assert_eq!(body["restart_required"], false);
    assert_eq!(body["reauth_required"], true);
    assert!(
        body["backup_path"]
            .as_str()
            .unwrap_or_default()
            .starts_with("~/.srouter/backups/")
    );

    // The router holds an `AppState` clone built before the import; the imported
    // row must still be visible through the swapped pool.
    let pool = app_database.sqlite_pool().expect("SQLite pool");
    let marker: Option<String> =
        sqlx::query_scalar("SELECT value FROM settings WHERE key = 'imported_marker'")
            .fetch_optional(&pool)
            .await
            .unwrap();
    assert_eq!(marker.as_deref(), Some("yes"));

    // The admin cookie was cleared on the success response.
    let cleared =
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM admin_sessions WHERE token_hash = ?")
            .bind(hash_session_token(SESSION_TOKEN))
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(cleared, 0, "the imported database carries its own sessions");
}

// ---------------------------------------------------------------------------
// Import: multipart shape
// ---------------------------------------------------------------------------

#[tokio::test]
async fn import_rejects_duplicate_parts_and_a_missing_filename() {
    let database = TestDatabase::new().unwrap();
    seed_session(&database).await;
    let (app, _) = app(&database).await;
    let boundary = "duplicate";

    // Two file parts.
    let duplicate_files = multipart_body(
        boundary,
        &[
            "Content-Disposition: form-data; name=\"database\"; filename=\"a.db\"\r\n\r\nsqlite",
            "Content-Disposition: form-data; name=\"database\"; filename=\"b.db\"\r\n\r\nsqlite",
        ],
    );
    let response = app
        .clone()
        .oneshot(multipart_request(&duplicate_files, boundary))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        json_body(response).await["error"]["code"],
        "invalid_database_field"
    );

    // A `database` part without a filename.
    let no_filename = multipart_body(
        boundary,
        &["Content-Disposition: form-data; name=\"database\"\r\n\r\nsqlite"],
    );
    let response = app
        .clone()
        .oneshot(multipart_request(&no_filename, boundary))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        json_body(response).await["error"]["code"],
        "invalid_database_field"
    );
}

#[tokio::test]
async fn import_accepts_a_filename_before_the_name() {
    let database = TestDatabase::new().unwrap();
    seed_session(&database).await;
    let (app, _) = app(&database).await;

    let candidate = database.path().with_extension("candidate.db");
    write_valid_candidate(&candidate).await;
    let contents = std::fs::read(&candidate).unwrap();

    let boundary = "filename-first";
    let body = multipart_file_body(
        boundary,
        "Content-Disposition: form-data; filename=\"source.db\"; name=\"database\"",
        &contents,
    );

    let response = app
        .clone()
        .oneshot(multipart_request(&body, boundary))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
}

// ---------------------------------------------------------------------------
// Import: size and body guards
// ---------------------------------------------------------------------------

#[tokio::test]
async fn import_rejects_a_missing_body_and_an_oversized_content_length() {
    let database = TestDatabase::new().unwrap();
    seed_session(&database).await;
    let (app, _) = app(&database).await;

    // No body at all.
    let missing = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(IMPORT)
                .header(header::COOKIE, session_cookie())
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(missing.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        json_body(missing).await["error"]["code"],
        "upload_too_large"
    );

    // Oversized Content-Length through the full app: the global `body_limit`
    // layer runs first and answers 413, exactly like Node's listener
    // (`apps/api/src/index.ts:57`).
    let oversized = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(IMPORT)
                .header(header::COOKIE, session_cookie())
                .header(header::CONTENT_TYPE, "multipart/form-data; boundary=test")
                .header(header::CONTENT_LENGTH, (25 * 1024 * 1024 + 1).to_string())
                .body(Body::from("--test\r\n"))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(oversized.status(), StatusCode::PAYLOAD_TOO_LARGE);
    assert_eq!(
        json_body(oversized).await["error"]["code"],
        "request_too_large"
    );

    // Mounted alone, the router's own guard answers 400 `upload_too_large`,
    // matching the oracle's router-only assertion
    // (`apps/api/tests/database-route.test.ts:185-194`).
    let isolated = srouter_server::features::database_transfer::create_database_router()
        .with_state(
            AppState::with_security(
                database.config().expect("test configuration"),
                ProviderRegistry::new(),
                sqlx_admin_security_state(&database).await,
            )
            .with_database(
                AppDatabase::connect(&database.config().expect("test configuration"))
                    .await
                    .expect("connect database"),
            ),
        );
    let oversized_router = isolated
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(IMPORT)
                .header(header::CONTENT_TYPE, "multipart/form-data; boundary=test")
                .header(header::CONTENT_LENGTH, (25 * 1024 * 1024 + 1).to_string())
                .body(Body::from("--test\r\n"))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(oversized_router.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        json_body(oversized_router).await["error"]["code"],
        "upload_too_large"
    );
}

#[tokio::test]
async fn import_bounds_a_chunked_multipart_body_over_25_mib() {
    let database = TestDatabase::new().unwrap();
    seed_session(&database).await;
    let (app, _) = app(&database).await;

    let boundary = "chunked";
    let mut body = format!(
        "--{boundary}\r\nContent-Disposition: form-data; name=\"database\"; filename=\"source.db\"\r\n\
         Content-Type: application/octet-stream\r\n\r\n"
    )
    .into_bytes();
    body.extend(std::iter::repeat_n(b'x', 25 * 1024 * 1024 + 1024));
    body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());

    // No Content-Length, so the route guard cannot see the size and the stream
    // loop must catch it.
    let request = Request::builder()
        .method("POST")
        .uri(IMPORT)
        .header(
            header::CONTENT_TYPE,
            format!("multipart/form-data; boundary={boundary}"),
        )
        .header(header::COOKIE, session_cookie())
        .body(Body::from(body))
        .unwrap();

    let response = app.oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        json_body(response).await["error"]["code"],
        "upload_too_large"
    );
}

// ---------------------------------------------------------------------------
// Import: validation
// ---------------------------------------------------------------------------

#[tokio::test]
async fn import_rejects_a_non_sqlite_and_a_newer_version_candidate() {
    let database = TestDatabase::new().unwrap();
    seed_session(&database).await;
    let (app, _) = app(&database).await;
    let boundary = "invalid";

    let not_sqlite = database.path().with_extension("not-sqlite.db");
    write_raw_candidate(&not_sqlite, b"not a sqlite database").await;
    let body = multipart_file_body(
        boundary,
        "Content-Disposition: form-data; name=\"database\"; filename=\"source.db\"",
        &std::fs::read(&not_sqlite).unwrap(),
    );
    let response = app
        .clone()
        .oneshot(multipart_request(&body, boundary))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        json_body(response).await["error"]["code"],
        "invalid_database"
    );

    // A candidate with `user_version = 99`.
    let newer = database.path().with_extension("newer.db");
    write_valid_candidate(&newer).await;
    {
        let options = sqlx::sqlite::SqliteConnectOptions::new().filename(&newer);
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options)
            .await
            .unwrap();
        sqlx::query("PRAGMA user_version = 99")
            .execute(&pool)
            .await
            .unwrap();
        pool.close().await;
    }
    let body = multipart_file_body(
        boundary,
        "Content-Disposition: form-data; name=\"database\"; filename=\"source.db\"",
        &std::fs::read(&newer).unwrap(),
    );
    let response = app
        .clone()
        .oneshot(multipart_request(&body, boundary))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        json_body(response).await["error"]["code"],
        "invalid_database"
    );
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

#[tokio::test]
async fn database_transfer_is_not_available_under_the_v1_v1_compat_group() {
    let database = TestDatabase::new().unwrap();
    seed_session(&database).await;
    let (app, _) = app(&database).await;

    for uri in [
        "/v1/v1/admin/database/export",
        "/v1/v1/admin/database/import",
    ] {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri(uri)
                    .header(header::COOKIE, session_cookie())
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND, "{uri}");
    }
}

// ---------------------------------------------------------------------------
// Import: validation rules against Rust's own DDL
// ---------------------------------------------------------------------------

/// Builds a valid v3 candidate and then applies `statements` to break it.
async fn write_broken_candidate(path: &Path, statements: &[&str]) {
    write_valid_candidate(path).await;
    let options = sqlx::sqlite::SqliteConnectOptions::new().filename(path);
    let pool = sqlx::sqlite::SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .unwrap();
    for statement in statements {
        sqlx::raw_sql(sqlx::AssertSqlSafe((*statement).to_owned()))
            .execute(&pool)
            .await
            .unwrap_or_else(|error| panic!("{statement}: {error}"));
    }
    pool.close().await;
}

async fn import_candidate(app: &Router, path: &Path) -> Response {
    let contents = std::fs::read(path).unwrap();
    let boundary = "validation";
    let body = multipart_file_body(
        boundary,
        "Content-Disposition: form-data; name=\"database\"; filename=\"source.db\"",
        &contents,
    );
    app.clone()
        .oneshot(multipart_request(&body, boundary))
        .await
        .unwrap()
}

#[tokio::test]
async fn import_rejects_candidates_missing_a_table_column_or_index() {
    let database = TestDatabase::new().unwrap();
    seed_session(&database).await;
    let (app, _) = app(&database).await;

    let cases: [(&str, &[&str]); 4] = [
        ("missing-table", &["DROP TABLE settings"]),
        (
            "missing-column",
            &["ALTER TABLE providers DROP COLUMN base_url"],
        ),
        ("missing-index", &["DROP INDEX idx_request_logs_model"]),
        // A candidate whose `api_keys.key_hash` is indexed but not UNIQUE: the
        // column shape still matches, so only the uniqueness rule catches it.
        (
            "non-unique-key-index",
            &[
                "DROP TABLE api_keys",
                "CREATE TABLE api_keys (\
                 id TEXT PRIMARY KEY,\
                 key_hash TEXT NOT NULL,\
                 key_prefix TEXT NOT NULL,\
                 name TEXT NOT NULL,\
                 enabled INTEGER NOT NULL DEFAULT 1,\
                 rate_limit INTEGER NOT NULL DEFAULT 0,\
                 quota_limit INTEGER NOT NULL DEFAULT 0,\
                 usage_tokens INTEGER NOT NULL DEFAULT 0,\
                 credit_limit REAL NOT NULL DEFAULT 0,\
                 usage_cost REAL NOT NULL DEFAULT 0,\
                 allowed_models TEXT,\
                 created_at INTEGER NOT NULL)",
                "CREATE INDEX idx_api_keys_key_hash ON api_keys (key_hash)",
            ],
        ),
    ];

    for (name, statements) in cases {
        let candidate = database.path().with_extension(format!("{name}.db"));
        write_broken_candidate(&candidate, statements).await;

        let response = import_candidate(&app, &candidate).await;
        assert_eq!(response.status(), StatusCode::BAD_REQUEST, "{name}");
        assert_eq!(
            json_body(response).await["error"]["code"],
            "invalid_database",
            "{name}"
        );
    }
}

#[tokio::test]
async fn import_accepts_a_v1_candidate_by_migrating_it() {
    let database = TestDatabase::new().unwrap();
    seed_session(&database).await;
    let (app, app_database) = app(&database).await;

    let candidate = database.path().with_extension("legacy-v1.db");
    let options = sqlx::sqlite::SqliteConnectOptions::new()
        .filename(&candidate)
        .create_if_missing(true);
    let pool = sqlx::sqlite::SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .unwrap();
    sqlx::raw_sql(
        r#"
        CREATE TABLE srouter_schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        INSERT INTO srouter_schema_meta (key, value) VALUES ('schema_version', '1');
        CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        INSERT INTO settings (key, value) VALUES ('legacy_marker', 'kept');
        "#,
    )
    .execute(&pool)
    .await
    .unwrap();
    pool.close().await;

    let response = import_candidate(&app, &candidate).await;
    assert_eq!(response.status(), StatusCode::OK);

    // The legacy row survived the migration and the file is now v4.
    let pool = app_database.sqlite_pool().expect("SQLite pool");
    let marker: Option<String> =
        sqlx::query_scalar("SELECT value FROM settings WHERE key = 'legacy_marker'")
            .fetch_optional(&pool)
            .await
            .unwrap();
    assert_eq!(marker.as_deref(), Some("kept"));
    let version: i64 = sqlx::query_scalar("PRAGMA user_version")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(version, 4);
}

// ---------------------------------------------------------------------------
// Import: lifecycle (temp dir, backup, lock)
// ---------------------------------------------------------------------------

#[tokio::test]
async fn import_cleans_its_temp_directory_and_keeps_a_readable_backup() {
    let database = TestDatabase::new().unwrap();
    seed_session(&database).await;
    let (app, _) = app(&database).await;

    let srouter_dir = database.path().parent().unwrap().join(".srouter");
    let candidate = database.path().with_extension("lifecycle.db");
    write_valid_candidate(&candidate).await;

    let response = import_candidate(&app, &candidate).await;
    assert_eq!(response.status(), StatusCode::OK);

    // No `transfer-temp-*` directory survives.
    let leftovers: Vec<_> = std::fs::read_dir(&srouter_dir)
        .map(|entries| {
            entries
                .filter_map(Result::ok)
                .filter(|entry| {
                    entry
                        .file_name()
                        .to_string_lossy()
                        .starts_with("transfer-temp-")
                })
                .collect()
        })
        .unwrap_or_default();
    assert!(leftovers.is_empty(), "temp dirs remain: {leftovers:?}");

    // A backup exists and is a readable SQLite file.
    let backups: Vec<_> = std::fs::read_dir(srouter_dir.join("backups"))
        .unwrap()
        .filter_map(Result::ok)
        .collect();
    assert_eq!(backups.len(), 1, "one backup expected");
    let bytes = std::fs::read(backups[0].path()).unwrap();
    assert!(bytes.starts_with(b"SQLite format 3\0"));
}

#[tokio::test]
async fn import_reports_busy_when_a_live_transfer_lock_exists() {
    let database = TestDatabase::new().unwrap();
    seed_session(&database).await;
    let (app, _) = app(&database).await;

    // Write a lock owned by this process with its real start identity, so the
    // importer sees a live owner rather than a reclaimable stale lock.
    let start = std::fs::read_to_string(format!("/proc/{}/stat", std::process::id()))
        .ok()
        .and_then(|stat| {
            stat[stat.rfind(')')? + 1..]
                .split_whitespace()
                .nth(19)
                .map(str::to_owned)
        })
        .unwrap_or_else(|| "unknown".to_owned());
    let lock = database.path().with_extension("db.transfer.lock");
    std::fs::write(
        &lock,
        format!(
            "{{\"pid\":{},\"start\":\"{start}\",\"token\":\"test-token\"}}",
            std::process::id()
        ),
    )
    .unwrap();

    let candidate = database.path().with_extension("busy.db");
    write_valid_candidate(&candidate).await;
    let response = import_candidate(&app, &candidate).await;
    assert_eq!(response.status(), StatusCode::CONFLICT);
    assert_eq!(
        json_body(response).await["error"]["code"],
        "database_import_busy"
    );
}

// ---------------------------------------------------------------------------
// Export filename
// ---------------------------------------------------------------------------

#[test]
fn export_filename_is_the_fourteen_digit_utc_stamp() {
    // The Node pair from the plan: 2026-10-05T14:52:03.123Z -> 20261005145203.
    let now_ms = 1_791_211_923_123;
    assert_eq!(
        srouter_server::features::database_transfer::export_filename(now_ms),
        "srouter-backup-20261005145203.db"
    );
}

#[tokio::test]
async fn validation_never_writes_to_the_candidate_bytes() {
    let database = TestDatabase::new().unwrap();
    seed_session(&database).await;
    let (app, _) = app(&database).await;

    // A rejected candidate: validation must leave its bytes untouched so the
    // operator still holds what they uploaded.
    let candidate = database.path().with_extension("immutable.db");
    write_valid_candidate(&candidate).await;
    let before = std::fs::read(&candidate).unwrap();

    let broken = database.path().with_extension("immutable-broken.db");
    write_broken_candidate(&broken, &["DROP TABLE settings"]).await;
    let broken_before = std::fs::read(&broken).unwrap();

    let rejected = import_candidate(&app, &broken).await;
    assert_eq!(rejected.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        std::fs::read(&broken).unwrap(),
        broken_before,
        "a rejected candidate must be byte-identical"
    );

    // An accepted candidate is also not rewritten in place: the importer works
    // on a scratch copy.
    let accepted = import_candidate(&app, &candidate).await;
    assert_eq!(accepted.status(), StatusCode::OK);
    assert_eq!(
        std::fs::read(&candidate).unwrap(),
        before,
        "an accepted candidate must be byte-identical"
    );
}

#[tokio::test]
async fn a_legacy_candidate_whose_migration_fails_leaves_no_scratch_copy() {
    let database = TestDatabase::new().unwrap();
    seed_session(&database).await;
    let (app, _) = app(&database).await;

    // A legacy file (user_version below 3) that passes the read-only checks but
    // cannot be migrated: `api_keys` has neither `key` nor `key_hash`, which the
    // migrator refuses. The importer must still remove the scratch copy it made
    // for the migration attempt.
    let candidate = database.path().with_extension("legacy-broken.db");
    let options = sqlx::sqlite::SqliteConnectOptions::new()
        .filename(&candidate)
        .create_if_missing(true);
    let pool = sqlx::sqlite::SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .unwrap();
    sqlx::raw_sql(
        r#"
        CREATE TABLE api_keys (id TEXT PRIMARY KEY, name TEXT NOT NULL);
        PRAGMA user_version = 1;
        "#,
    )
    .execute(&pool)
    .await
    .unwrap();
    pool.close().await;

    let response = import_candidate(&app, &candidate).await;
    assert!(
        response.status().is_server_error(),
        "a failed migration is a transfer failure, got {}",
        response.status()
    );

    // No `<active>.candidate-*` scratch file survives next to the database.
    let directory = database.path().parent().unwrap();
    let leftovers: Vec<_> = std::fs::read_dir(directory)
        .unwrap()
        .filter_map(Result::ok)
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .filter(|name| name.contains(".candidate-"))
        .collect();
    assert!(leftovers.is_empty(), "scratch copies remain: {leftovers:?}");
}
