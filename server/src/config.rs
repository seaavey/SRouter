use std::collections::HashMap;
use std::fmt::{self, Debug, Formatter};
use std::path::{Path, PathBuf};

const REDACTED: &str = "[REDACTED]";

#[derive(Clone, PartialEq, Eq)]
pub struct APIConfig {
    pub port: u16,
    pub public_url: Option<String>,
    pub cors_origins: Vec<String>,
    pub admin_password: Option<String>,
    pub secure_cookies: bool,
    /// `NODE_ENV=production` (case-insensitive). Drives production-only defaults.
    pub is_production: bool,
    /// Whether the per-request access log runs. Off in production unless
    /// `SROUTER_ACCESS_LOG` explicitly turns it back on.
    pub access_log: bool,
    pub web_dist_path: Option<PathBuf>,
    pub database_path: PathBuf,
    pub database_url: Option<String>,
    /// `<HOME>/.srouter`, the SRouter data directory. The database importer
    /// keeps its transfer temp dirs and backups here (`databaseTransfer.ts:325-328`),
    /// which is `$HOME/.srouter` even when `DATABASE_PATH` points elsewhere.
    pub srouter_dir: PathBuf,
}

impl APIConfig {
    pub fn from_env_map(environment: &HashMap<String, String>) -> Result<Self, ConfigError> {
        let port = parse_port(environment, "PORT", 3000)?;
        let home = environment
            .get("HOME")
            .filter(|home| !home.is_empty())
            .map(PathBuf::from);
        let database_path = match environment.get("DATABASE_PATH") {
            Some(path) => PathBuf::from(path),
            None => home
                .as_ref()
                .ok_or(ConfigError::MissingHome)?
                .join(".srouter")
                .join("srouter.db"),
        };
        // `<HOME>/.srouter` is where the importer keeps transfer temp dirs and
        // backups (`databaseTransfer.ts:325-328`). It follows `HOME` even when
        // `DATABASE_PATH` points elsewhere; without `HOME` it falls back to the
        // database's own directory rather than refusing to boot.
        let srouter_dir = match &home {
            Some(home) => home.join(".srouter"),
            None => database_path
                .parent()
                .map(Path::to_path_buf)
                .unwrap_or_else(|| PathBuf::from(".")),
        };
        let public_url = environment
            .get("SROUTER_PUBLIC_URL")
            .map(|url| url.trim().trim_end_matches('/'))
            .filter(|url| !url.is_empty())
            .map(str::to_owned);
        // Owner ruling 2026-10-03 --- 10-30 WIB: an `https://` public URL implies secure
        // cookies without `SROUTER_SECURE_COOKIES`, so production stays correct by
        // validation alone. The flag still enables them for deployments without a public
        // URL; under `https://` it cannot turn them off (a non-Secure cookie would be the
        // misconfiguration).
        let secure_cookies = environment
            .get("SROUTER_SECURE_COOKIES")
            .is_some_and(|value| value == "true")
            || public_url.as_deref().is_some_and(|url| {
                url.get(..8)
                    .is_some_and(|scheme| scheme.eq_ignore_ascii_case("https://"))
            });
        // Production detection follows the Node convention. The access log is a
        // development aid, so it defaults off in production and stays on
        // everywhere else; `SROUTER_ACCESS_LOG` overrides either way.
        let is_production = environment
            .get("NODE_ENV")
            .is_some_and(|value| value.trim().eq_ignore_ascii_case("production"));
        let access_log_override = environment
            .get("SROUTER_ACCESS_LOG")
            .map(|value| value.trim().to_ascii_lowercase())
            .filter(|value| !value.is_empty());
        let access_log = match access_log_override.as_deref() {
            Some("off" | "false" | "0" | "no") => false,
            Some(_) => true,
            None => !is_production,
        };

        Ok(Self {
            port,
            public_url,
            cors_origins: environment
                .get("SROUTER_CORS_ORIGINS")
                .into_iter()
                .flat_map(|origins| origins.split(','))
                .map(|origin| origin.trim().trim_end_matches('/'))
                .filter(|origin| !origin.is_empty())
                .map(str::to_owned)
                .collect(),
            admin_password: environment
                .get("SROUTER_ADMIN_PASSWORD")
                .filter(|password| !password.is_empty())
                .cloned(),
            secure_cookies,
            is_production,
            access_log,
            web_dist_path: environment
                .get("WEB_DIST_PATH")
                .filter(|path| !path.is_empty())
                .map(PathBuf::from),
            database_path,
            database_url: environment
                .get("DATABASE_URL")
                .filter(|url| !url.is_empty())
                .cloned(),
            srouter_dir,
        })
    }
}

impl Debug for APIConfig {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("APIConfig")
            .field("port", &self.port)
            .field("public_url", &self.public_url.as_ref().map(|_| REDACTED))
            .field("cors_origins", &self.cors_origins)
            .field(
                "admin_password",
                &self.admin_password.as_ref().map(|_| REDACTED),
            )
            .field("secure_cookies", &self.secure_cookies)
            .field("is_production", &self.is_production)
            .field("access_log", &self.access_log)
            .field("web_dist_path", &self.web_dist_path)
            .field("database_path", &self.database_path)
            .field("srouter_dir", &self.srouter_dir)
            .field(
                "database_url",
                &self.database_url.as_ref().map(|_| REDACTED),
            )
            .finish()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConfigError {
    InvalidPort { variable: &'static str },
    MissingHome,
}

impl fmt::Display for ConfigError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidPort { variable } => {
                write!(formatter, "{variable} must be a valid 16-bit port number")
            }
            Self::MissingHome => {
                formatter.write_str("HOME is required for the default database path")
            }
        }
    }
}

impl std::error::Error for ConfigError {}

fn parse_port(
    environment: &HashMap<String, String>,
    variable: &'static str,
    default: u16,
) -> Result<u16, ConfigError> {
    environment.get(variable).map_or(Ok(default), |value| {
        value
            .parse::<u16>()
            .map_err(|_| ConfigError::InvalidPort { variable })
    })
}
