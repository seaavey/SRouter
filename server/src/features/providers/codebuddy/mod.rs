//! CodeBuddy provider: the global and China OAuth-backed inference flavors.
//!
//! One executor type serves both deployments, selected by [`types::Flavor`].
//! Models come from the official package's `product.json` (see [`product`]),
//! merged with a live enterprise `/v3/config` when one is available, so the
//! catalog is empty until a connection exists and a refresh succeeds.

pub mod catalog;
pub mod executor;
pub mod types;

mod auth;
mod product;
mod refresh;
mod request;
mod translate;

#[cfg(test)]
mod tests;

pub use executor::{CodeBuddyExecutor, adapter, adapter_with_endpoints};
pub use types::{
    CODEBUDDY_CN_KEYS, CODEBUDDY_CN_PROVIDER, CODEBUDDY_KEYS, CODEBUDDY_PROVIDER, Flavor,
};
