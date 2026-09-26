mod support;

use support::TestDatabase;

#[tokio::test]
async fn sqlite_database_opens_and_keeps_committed_data_across_reconnects() {
    let test_database = TestDatabase::new().expect("temporary database");

    let database = test_database.connect().await.expect("connect to SQLite");
    let pool = database.sqlite_pool().expect("SQLite pool").clone();

    sqlx::query("CREATE TABLE plumbing_probe (id INTEGER PRIMARY KEY, label TEXT NOT NULL)")
        .execute(&pool)
        .await
        .expect("create probe table");
    sqlx::query("INSERT INTO plumbing_probe (id, label) VALUES (1, 'committed')")
        .execute(&pool)
        .await
        .expect("insert probe row");

    pool.close().await;
    drop(database);

    let reopened = test_database.connect().await.expect("reconnect to SQLite");
    let reopened_pool = reopened.sqlite_pool().expect("SQLite pool").clone();

    let row: (i64, String) = sqlx::query_as("SELECT id, label FROM plumbing_probe")
        .fetch_one(&reopened_pool)
        .await
        .expect("read committed row");

    assert_eq!(row, (1, "committed".to_owned()));
}

#[tokio::test]
async fn configured_database_url_selects_the_postgres_backend() {
    let test_database = TestDatabase::new().expect("temporary database");
    let mut environment = std::collections::HashMap::from([
        (
            "HOME".to_owned(),
            test_database.path().parent().unwrap().display().to_string(),
        ),
        (
            "DATABASE_PATH".to_owned(),
            test_database.path().display().to_string(),
        ),
    ]);

    // A malformed URL fails immediately and still proves backend selection: an
    // error means the PostgreSQL branch ran instead of opening SQLite.
    environment.insert("DATABASE_URL".to_owned(), "not-a-postgres-url".to_owned());
    let config = srouter_server::APIConfig::from_env_map(&environment).expect("configuration");

    let result = srouter_server::AppDatabase::connect(&config).await;

    assert!(result.is_err(), "the PostgreSQL branch must be selected");
}

#[test]
fn test_databases_use_unique_temporary_paths() {
    let first = TestDatabase::new().expect("first temporary database");
    let second = TestDatabase::new().expect("second temporary database");

    assert!(first.path().starts_with(std::env::temp_dir()));
    assert!(!first.path().to_string_lossy().contains(".srouter"));
    assert_ne!(first.path(), second.path());
}
