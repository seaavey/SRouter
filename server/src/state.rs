use std::sync::Arc;

use crate::config::APIConfig;
use crate::error::APIError;
use crate::features::admin_auth::{
    AdminAuthRepository, AdminSessionStore, EmptyAdminAuthRepository, EmptyAdminSessionStore,
    LoginThrottle,
};
use crate::features::api_keys::{
    APIKeyRepository, APIKeyStore, EmptyAPIKeyRepository, EmptyAPIKeyStore,
};
use crate::features::providers::ProviderRegistry;
use crate::http::middleware::rate_limit::RateLimiter;

/// Persistence-backed security dependencies. Until the SQLx stores land behind
/// the schema gate the process runs with `unconfigured()`, which behaves like a
/// fresh install: no keys, `require_api_key` off, no valid admin sessions.
#[derive(Clone)]
pub struct SecurityState {
    pub api_keys: Arc<dyn APIKeyStore>,
    pub admin_sessions: Arc<dyn AdminSessionStore>,
    /// Management CRUD source behind `/v1/keys`. Separate from `api_keys`, which
    /// only serves authentication lookups.
    pub key_repository: Arc<dyn APIKeyRepository>,
    /// Account and session lifecycle behind `/v1/admin/*`.
    pub admin_auth: Arc<dyn AdminAuthRepository>,
    pub login_throttle: Arc<LoginThrottle>,
    pub rate_limiter: Arc<RateLimiter>,
    configured: bool,
}

impl SecurityState {
    /// Wraps explicit, persistence-backed stores with the unconfigured
    /// management repository. Prefer [`SecurityState::with_repository`] once a
    /// database backs `/v1/keys`.
    pub fn new(api_keys: Arc<dyn APIKeyStore>, admin_sessions: Arc<dyn AdminSessionStore>) -> Self {
        Self::with_repository(api_keys, admin_sessions, Arc::new(EmptyAPIKeyRepository))
    }

    /// Wraps explicit, persistence-backed stores including the `/v1/keys`
    /// repository.
    pub fn with_repository(
        api_keys: Arc<dyn APIKeyStore>,
        admin_sessions: Arc<dyn AdminSessionStore>,
        key_repository: Arc<dyn APIKeyRepository>,
    ) -> Self {
        Self {
            api_keys,
            admin_sessions,
            key_repository,
            admin_auth: Arc::new(EmptyAdminAuthRepository),
            login_throttle: Arc::new(LoginThrottle::new()),
            rate_limiter: Arc::new(RateLimiter::new()),
            configured: true,
        }
    }

    /// Attaches the admin account/session repository backing `/v1/admin/*`.
    pub fn with_admin_auth(mut self, admin_auth: Arc<dyn AdminAuthRepository>) -> Self {
        self.admin_auth = admin_auth;
        self
    }

    /// Builds the empty-default state used while no database is wired in.
    pub fn unconfigured() -> Self {
        Self {
            api_keys: Arc::new(EmptyAPIKeyStore),
            admin_sessions: Arc::new(EmptyAdminSessionStore),
            key_repository: Arc::new(EmptyAPIKeyRepository),
            admin_auth: Arc::new(EmptyAdminAuthRepository),
            login_throttle: Arc::new(LoginThrottle::new()),
            rate_limiter: Arc::new(RateLimiter::new()),
            configured: false,
        }
    }

    /// Reports whether the stores read persisted data. Startup logs a warning
    /// while this is false so a shadow boot cannot look production-ready.
    pub fn is_persistence_configured(&self) -> bool {
        self.configured
    }
}

/// Shared runtime dependencies, constructed once by the composition root.
#[derive(Clone)]
pub struct AppState {
    pub config: Arc<APIConfig>,
    pub providers: Arc<ProviderRegistry>,
    pub security: SecurityState,
}

impl AppState {
    /// Builds the state with the built-in provider registry.
    pub fn new(config: APIConfig) -> Result<Self, APIError> {
        Ok(Self::with_registry(
            config,
            ProviderRegistry::with_defaults()?,
        ))
    }

    /// Builds the state around an explicit registry. Tests inject a fake
    /// upstream here instead of reaching the real providers.
    pub fn with_registry(config: APIConfig, providers: ProviderRegistry) -> Self {
        Self::with_security(config, providers, SecurityState::unconfigured())
    }

    /// Builds the state with explicit security stores; tests inject fixtures and
    /// the composition root will inject the SQLx-backed stores once they exist.
    pub fn with_security(
        config: APIConfig,
        providers: ProviderRegistry,
        security: SecurityState,
    ) -> Self {
        Self {
            config: Arc::new(config),
            providers: Arc::new(providers),
            security,
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use crate::features::admin_auth::EmptyAdminSessionStore;
    use crate::features::api_keys::EmptyAPIKeyStore;

    use super::SecurityState;

    #[test]
    fn unconfigured_security_state_reports_no_persistence() {
        let security = SecurityState::unconfigured();

        assert!(!security.is_persistence_configured());
    }

    #[test]
    fn explicit_security_state_reports_persistence() {
        let security =
            SecurityState::new(Arc::new(EmptyAPIKeyStore), Arc::new(EmptyAdminSessionStore));

        assert!(security.is_persistence_configured());
    }
}
