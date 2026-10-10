//! Antigravity provider: the Google OAuth session, the static CloudCode IDE
//! model catalog, and the Gemini-native executor.
//!
//! The submodules follow the canonical provider contract: `types` holds the
//! metadata and endpoint constants, `auth` the credential load, token refresh,
//! and project bootstrap, `request` the request/header builders and the SSE
//! re-framer, `translate` the pure envelope and frame translation, `refresh`
//! the catalog snapshot policy, and `executor` the thin `ProviderExecutor`.

pub mod executor;
pub mod translate;
pub mod types;

mod auth;
mod refresh;
mod request;

#[cfg(test)]
mod tests;

pub use executor::{ANTIGRAVITY_KEYS, AntigravityExecutor, adapter, adapter_with_endpoints};
pub use refresh::{AntigravityCatalog, SharedCatalog};
pub use types::{ANTIGRAVITY_MODEL_IDS, ANTIGRAVITY_PROVIDER, AntigravityEndpoints};
