//! Unit tests for the Antigravity pure and delegated pieces: header selection,
//! the retry parser, the refresh window, the fallback project id, and the
//! catalog snapshot flip. The fake-upstream integration tests are added in
//! Task 6 (`tests/antigravity_provider.rs`), not here.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

use crate::config::APIConfig;
use crate::infrastructure::database::AppDatabase;
use crate::infrastructure::database::providers::{
    AntigravityConnectionWrite, AntigravityCredentials, upsert_antigravity_connection,
};
use crate::infrastructure::upstream::UpstreamClient;

use super::auth::{generate_fallback_project_id, token_refresh_is_due};
use super::executor::AntigravityExecutor;
use super::request::{
    IMAGE_MAX_BYTES, image_cap_exceeded, parse_retry_from_error_message, provider_error,
    resolve_image_target,
};
use super::types::{ANTIGRAVITY_MODEL_IDS, AntigravityEndpoints};

const MINUTE_MS: i64 = 60 * 1000;

fn executor(database: Option<AppDatabase>) -> AntigravityExecutor {
    AntigravityExecutor::new(
        AntigravityEndpoints::default(),
        database,
        UpstreamClient::new().expect("upstream client"),
    )
}

fn credentials(access_token: &str, expires_at: Option<i64>) -> AntigravityCredentials {
    AntigravityCredentials {
        id: "antigravity_1".to_owned(),
        access_token: access_token.to_owned(),
        refresh_token: Some("1//refresh".to_owned()),
        expires_at,
        project_id: None,
    }
}

#[test]
fn headers_select_the_auth_header_by_token_prefix() {
    let executor = executor(None);

    let ya29 = executor.request_headers("ya29.access");
    assert_eq!(
        ya29.get("Authorization").map(String::as_str),
        Some("Bearer ya29.access")
    );
    assert_eq!(
        ya29.get("x-goog-api-client").map(String::as_str),
        Some("gl-node/18.0.0 gd/1.0.0")
    );
    assert!(!ya29.contains_key("x-goog-api-key"));
    assert_eq!(
        ya29.get("User-Agent").map(String::as_str),
        Some("antigravity/ide/2.1.1 darwin/arm64")
    );
    assert_eq!(
        ya29.get("Content-Type").map(String::as_str),
        Some("application/json")
    );

    let api_key = executor.request_headers("AIzaSyExampleKey");
    assert_eq!(
        api_key.get("x-goog-api-key").map(String::as_str),
        Some("AIzaSyExampleKey")
    );
    assert!(!api_key.contains_key("Authorization"));
    assert!(!api_key.contains_key("x-goog-api-client"));

    let opaque = executor.request_headers("opaque-token");
    assert_eq!(
        opaque.get("Authorization").map(String::as_str),
        Some("Bearer opaque-token")
    );
    assert!(!opaque.contains_key("x-goog-api-client"));
}

#[test]
fn retry_windows_parse_from_quota_messages() {
    assert_eq!(
        parse_retry_from_error_message("quota will reset after 2h30m10s"),
        Some(2 * 3_600_000 + 30 * 60_000 + 10_000)
    );
    assert_eq!(
        parse_retry_from_error_message("RESOURCE_EXHAUSTED: Resets in 5m"),
        Some(5 * 60_000)
    );
    assert_eq!(
        parse_retry_from_error_message("reset after 10s"),
        Some(10_000)
    );
    assert_eq!(
        parse_retry_from_error_message("reset after soon"),
        Some(2000)
    );
    assert_eq!(parse_retry_from_error_message("no window here"), None);

    let error = provider_error(429, "RESOURCE_EXHAUSTED: resets after 30s");
    assert_eq!(error.status(), 500);
    assert!(error.message().contains("(429)"));
    assert!(error.message().contains("[Retry-After: ~30s]"));

    let plain = provider_error(400, "bad request");
    assert_eq!(
        plain.message(),
        "Antigravity Provider Error (400): bad request"
    );
}

#[test]
fn refresh_is_due_inside_the_lead_window() {
    let now = 1_000_000_000_000;

    assert!(!token_refresh_is_due(
        &credentials("ya29.access", Some(now + 10 * MINUTE_MS)),
        now
    ));
    assert!(token_refresh_is_due(
        &credentials("ya29.access", Some(now + 4 * MINUTE_MS)),
        now
    ));
    assert!(token_refresh_is_due(
        &credentials("ya29.access", Some(now - 1)),
        now
    ));
    assert!(
        token_refresh_is_due(&credentials("ya29.access", None), now),
        "an imported token with no expiry refreshes once"
    );
}

#[test]
fn the_fallback_project_id_has_the_oracle_shape() {
    const ADJECTIVES: &[&str] = &["useful", "bright", "swift", "calm", "bold"];
    const NOUNS: &[&str] = &["fuze", "wave", "spark", "flow", "core"];

    for _ in 0..16 {
        let project_id = generate_fallback_project_id();
        let parts: Vec<&str> = project_id.split('-').collect();

        assert_eq!(parts.len(), 3, "{project_id}");
        assert!(ADJECTIVES.contains(&parts[0]), "{project_id}");
        assert!(NOUNS.contains(&parts[1]), "{project_id}");
        assert_eq!(parts[2].len(), 5, "{project_id}");
        assert!(
            parts[2]
                .chars()
                .all(|character| character.is_ascii_hexdigit()),
            "{project_id}"
        );
    }
}

#[test]
fn cascade_candidates_map_to_the_node_wire_sequence() {
    use super::translate::{model_fallbacks, parse_model_name};

    // The executor re-parses every candidate, mirroring `buildRequest`. The pro
    // chain's raw id therefore maps back to `gemini-pro-agent`, so attempt 2
    // sends the same wire model as attempt 1 (the Node double-send quirk).
    let wire: Vec<String> = model_fallbacks("gemini-3.1-pro-high")
        .iter()
        .map(|candidate| parse_model_name(candidate))
        .collect();
    assert_eq!(
        wire,
        vec![
            "gemini-pro-agent".to_owned(),
            "gemini-pro-agent".to_owned(),
            "gemini-3-pro".to_owned(),
        ]
    );

    // A flash candidate is already the wire name; re-parsing is idempotent.
    let flash: Vec<String> = model_fallbacks("gemini-3.7-flash-high")
        .iter()
        .map(|candidate| parse_model_name(candidate))
        .collect();
    assert_eq!(flash, vec!["gemini-3.7-flash-tiered".to_owned()]);
}

#[test]
fn an_oversized_image_body_is_dropped_by_the_cap() {
    // A body exactly at the cap passes; one byte over is dropped.
    assert!(!image_cap_exceeded(IMAGE_MAX_BYTES - 1, 1));
    assert!(image_cap_exceeded(IMAGE_MAX_BYTES, 1));
    // A declared `Content-Length` over the cap is rejected before any read.
    assert!(image_cap_exceeded(IMAGE_MAX_BYTES + 1, 0));
    // A hostile length cannot wrap the comparison into a pass.
    assert!(image_cap_exceeded(u64::MAX, 1));
}

#[test]
fn the_image_target_resolution_fails_closed_and_pins_the_address() {
    use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
    use url::Host;

    // A literal public address is allowed and needs no DNS pin.
    let (domain, addresses) =
        resolve_image_target(Host::Ipv4(Ipv4Addr::new(1, 1, 1, 1)), 443).expect("public host");
    assert!(domain.is_none(), "a literal IP is not pinned");
    assert_eq!(
        addresses,
        vec![SocketAddr::new(IpAddr::V4(Ipv4Addr::new(1, 1, 1, 1)), 443)]
    );

    // Literal loopback addresses are blocked.
    assert!(resolve_image_target(Host::Ipv4(Ipv4Addr::LOCALHOST), 80).is_none());
    assert!(resolve_image_target(Host::Ipv6(Ipv6Addr::LOCALHOST), 80).is_none());

    // A domain resolving to loopback is blocked even though the URL host is not
    // an address literal.
    assert!(resolve_image_target(Host::Domain("localhost"), 80).is_none());

    // An unresolvable host fails closed instead of fetching an unvalidated
    // address.
    assert!(resolve_image_target(Host::Domain("no-such-host.invalid"), 80).is_none());
}

/// A unique temporary SQLite database removed when the value is dropped.
struct TempDatabase {
    directory: PathBuf,
    database: AppDatabase,
}

impl TempDatabase {
    async fn new() -> Self {
        static SEQUENCE: AtomicU64 = AtomicU64::new(0);

        let directory = std::env::temp_dir().join(format!(
            "srouter-antigravity-test-{}-{}",
            std::process::id(),
            SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&directory).expect("temp directory");

        let environment = HashMap::from([
            ("HOME".to_owned(), directory.display().to_string()),
            (
                "DATABASE_PATH".to_owned(),
                directory.join("srouter.db").display().to_string(),
            ),
        ]);
        let config = APIConfig::from_env_map(&environment).expect("temporary config");
        let database = AppDatabase::connect(&config).await.expect("database");

        Self {
            directory,
            database,
        }
    }
}

impl Drop for TempDatabase {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.directory);
    }
}

#[tokio::test]
async fn the_snapshot_flips_with_the_connection() {
    let temp = TempDatabase::new().await;
    let executor = executor(Some(temp.database.clone()));

    // No connection: nothing is advertised.
    executor.maybe_refresh(true).await;
    assert!(executor.models().is_empty());

    // A connection flips the static 17-id catalog on. The `AIzaSy` token keeps
    // `maybe_refresh` off the network, so the flip is observable in isolation.
    upsert_antigravity_connection(
        &temp.database,
        &AntigravityConnectionWrite {
            id: "antigravity_1".to_owned(),
            name: "Test Account".to_owned(),
            access_token: "AIzaSyExampleKey".to_owned(),
            refresh_token: None,
            expires_at: None,
            project_id: Some("project-1".to_owned()),
        },
    )
    .await
    .expect("connection stored");

    executor.maybe_refresh(true).await;
    let models = executor.models();
    assert_eq!(models.len(), ANTIGRAVITY_MODEL_IDS.len());
    assert!(models.iter().any(|id| id == "gemini-3.7-flash-high"));

    // Removing the connection flips it back off.
    let pool = temp.database.sqlite_pool().expect("sqlite pool");
    sqlx::query("DELETE FROM providers WHERE id = ?")
        .bind("antigravity_1")
        .execute(pool)
        .await
        .expect("connection deleted");

    executor.maybe_refresh(true).await;
    assert!(executor.models().is_empty());
}
