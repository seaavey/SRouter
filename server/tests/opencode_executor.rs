mod support;

use srouter_server::features::providers::opencode;
use srouter_server::features::providers::opencode::executor::OpenCodeExecutor;
use srouter_server::infrastructure::database::providers::{
    OpenCodeConnectionWrite, upsert_opencode_connection,
};
use support::TestDatabase;

#[tokio::test]
async fn opencode_executor_unauthenticated_emits_bearer_public() {
    let adapter = opencode::adapter(None).expect("adapter should build");
    let executor = adapter
        .downcast_ref::<OpenCodeExecutor>()
        .expect("should be OpenCodeExecutor");

    let (auth, org_id) = executor.auth_headers().await.expect("auth_headers");
    assert_eq!(auth, "Bearer public");
    assert_eq!(org_id, None);
}

#[tokio::test]
async fn opencode_executor_authenticated_emits_stored_credentials() {
    let test_db = TestDatabase::new().unwrap();
    let database = test_db.connect().await.unwrap();

    let write = OpenCodeConnectionWrite {
        id: "test-conn-1".to_string(),
        name: "Test Account".to_string(),
        access_token: "st_custom_token_123".to_string(),
        refresh_token: Some("rt_custom_refresh_456".to_string()),
        token_expires_at: Some(srouter_server::clock::now_ms() + 1000000),
        org_id: Some("org_custom_789".to_string()),
        org_name: Some("Personal".to_string()),
        email: Some("test@example.com".to_string()),
    };
    upsert_opencode_connection(&database, &write).await.unwrap();

    let adapter = opencode::adapter(Some(database)).expect("adapter should build");
    let executor = adapter
        .downcast_ref::<OpenCodeExecutor>()
        .expect("should be OpenCodeExecutor");

    let (auth, org_id) = executor.auth_headers().await.expect("auth_headers");
    assert_eq!(auth, "Bearer st_custom_token_123");
    assert_eq!(org_id, Some("org_custom_789".to_string()));
}
