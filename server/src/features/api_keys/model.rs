//! API-key domain types: the record the auth middleware reads and the
//! principal it attaches to authorized requests.

#[derive(Clone, Debug, PartialEq)]
pub struct APIKeyRecord {
    pub id: String,
    pub enabled: bool,
    /// Requests per minute; `0` means unlimited.
    pub rate_limit: u32,
    pub quota_limit: f64,
    pub usage_tokens: f64,
    pub credit_limit: f64,
    pub usage_cost: f64,
    pub allowed_models: Option<Vec<String>>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AuthSource {
    AdminSession,
    APIKey,
    Anonymous,
}

/// Which credential authorized the request, plus the key record when one was
/// used. Cloned into request extensions, which is why it derives `Clone`.
#[derive(Clone, Debug)]
pub struct APIPrincipal {
    pub source: AuthSource,
    pub api_key: Option<APIKeyRecord>,
}
