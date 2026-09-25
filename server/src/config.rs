use std::collections::HashMap;
use std::fmt::{self, Debug, Formatter};
use std::path::PathBuf;

const REDACTED: &str = "[REDACTED]";

#[derive(Clone, PartialEq, Eq)]
pub struct ApiConfig {
    pub port: u16,
    pub oauth_port: u16,
    pub oauth_host: String,
    pub public_url: Option<String>,
    pub cors_origins: Vec<String>,
    pub admin_password: Option<String>,
    pub secure_cookies: bool,
    pub web_dist_path: Option<PathBuf>,
    pub database_path: PathBuf,
    pub database_url: Option<String>,
    pub claude_oauth_client_id: Option<String>,
}

impl ApiConfig {
    pub fn from_env_map(environment: &HashMap<String, String>) -> Result<Self, ConfigError> {
        let port = parse_port(environment, "PORT", 3000)?;
        let oauth_port = parse_port(environment, "OAUTH_PORT", 1455)?;
        let database_path = match environment.get("DATABASE_PATH") {
            Some(path) => PathBuf::from(path),
            None => {
                let home = environment
                    .get("HOME")
                    .filter(|home| !home.is_empty())
                    .ok_or(ConfigError::MissingHome)?;
                PathBuf::from(home).join(".srouter").join("srouter.db")
            }
        };

        Ok(Self {
            port,
            oauth_port,
            oauth_host: environment
                .get("OAUTH_HOST")
                .filter(|host| !host.is_empty())
                .cloned()
                .unwrap_or_else(|| "0.0.0.0".to_owned()),
            public_url: environment
                .get("SROUTER_PUBLIC_URL")
                .map(|url| url.trim().trim_end_matches('/'))
                .filter(|url| !url.is_empty())
                .map(str::to_owned),
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
            secure_cookies: environment
                .get("SROUTER_SECURE_COOKIES")
                .is_some_and(|value| value == "true"),
            web_dist_path: environment
                .get("WEB_DIST_PATH")
                .filter(|path| !path.is_empty())
                .map(PathBuf::from),
            database_path,
            database_url: environment
                .get("DATABASE_URL")
                .filter(|url| !url.is_empty())
                .cloned(),
            claude_oauth_client_id: environment
                .get("CLAUDE_OAUTH_CLIENT_ID")
                .filter(|client_id| !client_id.is_empty())
                .cloned(),
        })
    }
}

impl Debug for ApiConfig {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ApiConfig")
            .field("port", &self.port)
            .field("oauth_port", &self.oauth_port)
            .field("oauth_host", &self.oauth_host)
            .field("public_url", &self.public_url.as_ref().map(|_| REDACTED))
            .field("cors_origins", &self.cors_origins)
            .field(
                "admin_password",
                &self.admin_password.as_ref().map(|_| REDACTED),
            )
            .field("secure_cookies", &self.secure_cookies)
            .field("web_dist_path", &self.web_dist_path)
            .field("database_path", &self.database_path)
            .field(
                "database_url",
                &self.database_url.as_ref().map(|_| REDACTED),
            )
            .field(
                "claude_oauth_client_id",
                &self.claude_oauth_client_id.as_ref().map(|_| REDACTED),
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
