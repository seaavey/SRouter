use std::collections::HashMap;
use std::path::PathBuf;

use srouter_server::config::{APIConfig, ConfigError};

fn config_from(entries: &[(&str, &str)]) -> Result<APIConfig, ConfigError> {
    let environment = entries
        .iter()
        .map(|(key, value)| ((*key).to_owned(), (*value).to_owned()))
        .collect::<HashMap<_, _>>();

    APIConfig::from_env_map(&environment)
}

#[test]
fn defaults_use_frozen_listener_and_sqlite_values() {
    let config = config_from(&[("HOME", "/tmp/srouter-home")]).unwrap();

    assert_eq!(config.port, 3000);
    assert_eq!(
        config.database_path,
        PathBuf::from("/tmp/srouter-home/.srouter/srouter.db")
    );
    assert!(config.public_url.is_none());
    assert!(config.cors_origins.is_empty());
    assert!(config.admin_password.is_none());
    assert!(!config.secure_cookies);
    assert!(!config.is_production);
    assert!(config.access_log, "the access log is on outside production");
    assert!(config.web_dist_path.is_none());
    assert!(config.database_url.is_none());
}

#[test]
fn supported_environment_overrides_are_parsed_without_rewriting_database_url() {
    let config = config_from(&[
        ("PORT", "8080"),
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
    ])
    .unwrap();

    assert_eq!(config.port, 8080);
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
}

#[test]
fn empty_optional_environment_overrides_use_unset_defaults() {
    let config = config_from(&[
        ("HOME", "/tmp/srouter-home"),
        ("SROUTER_ADMIN_PASSWORD", ""),
        ("DATABASE_URL", ""),
    ])
    .unwrap();

    assert!(config.admin_password.is_none());
    assert!(config.database_url.is_none());
}

#[test]
fn invalid_listener_ports_return_the_environment_variable_name() {
    let invalid_main_port = config_from(&[("HOME", "/tmp/srouter-home"), ("PORT", "not-a-port")]);
    assert!(matches!(
        invalid_main_port,
        Err(ConfigError::InvalidPort { variable: "PORT" })
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
fn secure_cookies_accept_the_exact_true_value_without_an_https_public_url() {
    let config = config_from(&[
        ("HOME", "/tmp/srouter-home"),
        ("SROUTER_SECURE_COOKIES", "true"),
    ])
    .unwrap();

    assert!(config.secure_cookies);
}

#[test]
fn https_public_url_enables_secure_cookies_without_the_flag() {
    let config = config_from(&[
        ("HOME", "/tmp/srouter-home"),
        ("SROUTER_PUBLIC_URL", "https://srouter.example.test"),
    ])
    .unwrap();

    assert!(config.secure_cookies);
}

#[test]
fn http_public_url_does_not_enable_secure_cookies() {
    let config = config_from(&[
        ("HOME", "/tmp/srouter-home"),
        ("SROUTER_PUBLIC_URL", "http://srouter.example.test"),
    ])
    .unwrap();

    assert!(!config.secure_cookies);
}

#[test]
fn https_public_url_keeps_secure_cookies_on_when_the_flag_is_false() {
    let config = config_from(&[
        ("HOME", "/tmp/srouter-home"),
        ("SROUTER_PUBLIC_URL", "https://srouter.example.test"),
        ("SROUTER_SECURE_COOKIES", "false"),
    ])
    .unwrap();

    assert!(config.secure_cookies);
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

#[test]
fn production_turns_the_access_log_off() {
    let config = config_from(&[("HOME", "/tmp/srouter-home"), ("NODE_ENV", "production")]).unwrap();

    assert!(config.is_production);
    assert!(!config.access_log);
}

#[test]
fn access_log_can_be_forced_on_or_off() {
    let forced_on = config_from(&[
        ("HOME", "/tmp/srouter-home"),
        ("NODE_ENV", "production"),
        ("SROUTER_ACCESS_LOG", "on"),
    ])
    .unwrap();
    assert!(forced_on.access_log);

    let forced_off =
        config_from(&[("HOME", "/tmp/srouter-home"), ("SROUTER_ACCESS_LOG", "off")]).unwrap();
    assert!(!forced_off.access_log);

    let blank = config_from(&[
        ("HOME", "/tmp/srouter-home"),
        ("NODE_ENV", "development"),
        ("SROUTER_ACCESS_LOG", "  "),
    ])
    .unwrap();
    assert!(blank.access_log, "a blank override is treated as unset");
}
