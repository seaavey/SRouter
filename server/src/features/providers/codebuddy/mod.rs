//! CodeBuddy provider: the global and China OAuth-backed inference flavors.
//!
//! One executor type serves both deployments, selected by [`types::Flavor`].
//! Models come from a live product-config fetch, never a hardcoded list, so the
//! catalog is empty until a connection exists and a fetch succeeds.

pub mod catalog;
pub mod executor;
pub mod types;

pub use executor::{CodeBuddyExecutor, adapter, adapter_with_endpoints};
pub use types::{
    CODEBUDDY_CN_KEYS, CODEBUDDY_CN_PROVIDER, CODEBUDDY_KEYS, CODEBUDDY_PROVIDER, Flavor,
};
