use std::collections::HashMap;
use std::path::PathBuf;

use srouter_server::config::{ApiConfig, ConfigError};

fn config_from(entries: &[(&str, &str)]) -> Result<ApiConfig, ConfigError> {
    let environment = entries
        .iter()
        .map(|(key, value)| ((*key).to_owned(), (*value).to_owned()))
        .collect::<HashMap<_, _>>();

    ApiConfig::from_env_map(&environment)
}

#[test]
fn defaults_use_frozen_listener_and_sqlite_values() {
    let config = config_from(&[("HOME", "/tmp/srouter-home")]).unwrap();

    assert_eq!(config.port, 3000);
    assert_eq!(config.oauth_port, 1455);
    assert_eq!(config.oauth_host, "0.0.0.0");
    assert_eq!(
        config.database_path,
        PathBuf::from("/tmp/srouter-home/.srouter/srouter.db")
    );
    assert!(config.public_url.is_none());
    assert!(config.cors_origins.is_empty());
    assert!(config.admin_password.is_none());
    assert!(!config.secure_cookies);
    assert!(config.web_dist_path.is_none());
    assert!(config.database_url.is_none());
    assert!(config.claude_oauth_client_id.is_none());
}

#[test]
fn supported_environment_overrides_are_parsed_without_rewriting_database_url() {
    let config = config_from(&[
        ("PORT", "8080"),
        ("OAUTH_PORT", "4445"),
        ("OAUTH_HOST", "127.0.0.1"),
        ("SROUTER_PUBLIC_URL", "https://api.example.test"),
        (
            "SROUTER_CORS_ORIGINS",
            "https://ui.example.test, https://admin.example.test ",
        ),
        ("SROUTER_ADMIN_PASSWORD", "private-admin-password"),
        ("SROUTER_SECURE_COOKIES", "true"),
        ("WEB_DIST_PATH", "/srv/srouter/web"),
        ("DATABASE_PATH", "/var/lib/srouter/srouter.db"),
        (
            "DATABASE_URL",
            "postgresql://user:password@db.example.test/srouter?sslmode=require",
        ),
        ("CLAUDE_OAUTH_CLIENT_ID", "claude-client-id"),
    ])
    .unwrap();

    assert_eq!(config.port, 8080);
    assert_eq!(config.oauth_port, 4445);
    assert_eq!(config.oauth_host, "127.0.0.1");
    assert_eq!(
        config.public_url.as_deref(),
        Some("https://api.example.test")
    );
    assert_eq!(
        config.cors_origins,
        ["https://ui.example.test", "https://admin.example.test"]
    );
    assert_eq!(
        config.admin_password.as_deref(),
        Some("private-admin-password")
    );
    assert!(config.secure_cookies);
    assert_eq!(
        config.web_dist_path,
        Some(PathBuf::from("/srv/srouter/web"))
    );
    assert_eq!(
        config.database_path,
        PathBuf::from("/var/lib/srouter/srouter.db")
    );
    assert_eq!(
        config.database_url.as_deref(),
        Some("postgresql://user:password@db.example.test/srouter?sslmode=require")
    );
    assert_eq!(
        config.claude_oauth_client_id.as_deref(),
        Some("claude-client-id")
    );
}

#[test]
fn invalid_listener_ports_return_the_environment_variable_name() {
    let invalid_main_port = config_from(&[("HOME", "/tmp/srouter-home"), ("PORT", "not-a-port")]);
    assert!(matches!(
        invalid_main_port,
        Err(ConfigError::InvalidPort { variable: "PORT" })
    ));

    let invalid_oauth_port = config_from(&[("HOME", "/tmp/srouter-home"), ("OAUTH_PORT", "65536")]);
    assert!(matches!(
        invalid_oauth_port,
        Err(ConfigError::InvalidPort {
            variable: "OAUTH_PORT"
        })
    ));
}

#[test]
fn missing_home_is_reported_when_the_default_database_path_is_needed() {
    assert!(matches!(config_from(&[]), Err(ConfigError::MissingHome)));
}

#[test]
fn secure_cookies_are_enabled_only_by_the_exact_true_value() {
    let config = config_from(&[
        ("HOME", "/tmp/srouter-home"),
        ("SROUTER_SECURE_COOKIES", "TRUE"),
    ])
    .unwrap();

    assert!(!config.secure_cookies);
}

#[test]
fn empty_public_url_is_treated_as_unset() {
    for public_url in ["", " \t "] {
        let config = config_from(&[
            ("HOME", "/tmp/srouter-home"),
            ("SROUTER_PUBLIC_URL", public_url),
        ])
        .unwrap();

        assert!(config.public_url.is_none());
    }
}

#[test]
fn public_url_is_trimmed_and_trailing_slashes_are_removed() {
    let config = config_from(&[
        ("HOME", "/tmp/srouter-home"),
        ("SROUTER_PUBLIC_URL", " https://srouter.example.test/// "),
    ])
    .unwrap();

    assert_eq!(
        config.public_url.as_deref(),
        Some("https://srouter.example.test")
    );
}

#[test]
fn cors_origins_are_trimmed_and_trailing_slashes_are_removed() {
    let config = config_from(&[
        ("HOME", "/tmp/srouter-home"),
        (
            "SROUTER_CORS_ORIGINS",
            " https://ui.example.test///, , https://admin.example.test/ ",
        ),
    ])
    .unwrap();

    assert_eq!(
        config.cors_origins,
        ["https://ui.example.test", "https://admin.example.test"]
    );
}

#[test]
fn empty_web_dist_path_is_treated_as_unset() {
    let config = config_from(&[("HOME", "/tmp/srouter-home"), ("WEB_DIST_PATH", "")]).unwrap();

    assert!(config.web_dist_path.is_none());
}

#[test]
fn nonempty_relative_web_dist_path_is_preserved() {
    let config = config_from(&[
        ("HOME", "/tmp/srouter-home"),
        ("WEB_DIST_PATH", "../web/dist"),
    ])
    .unwrap();

    assert_eq!(config.web_dist_path, Some(PathBuf::from("../web/dist")));
}

#[test]
fn debug_output_redacts_configured_credentials() {
    let config = config_from(&[
        ("HOME", "/tmp/srouter-home"),
        ("SROUTER_ADMIN_PASSWORD", "private-admin-password"),
        (
            "DATABASE_URL",
            "postgresql://user:private-db-password@db.example.test/srouter",
        ),
    ])
    .unwrap();

    let debug_output = format!("{config:?}");

    assert!(!debug_output.contains("private-admin-password"));
    assert!(!debug_output.contains("private-db-password"));
    assert!(debug_output.contains("[REDACTED]"));
}
