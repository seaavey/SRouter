//! Qoder provider: COSY-signed inference over the Qoder gateway, the live model
//! catalog it reads from `model/list`, and the endpoints of the device flow.

pub mod catalog;
pub mod cosy;
pub mod executor;
pub mod types;

mod auth;
mod refresh;
mod request;
mod state;
mod translate;

#[cfg(test)]
mod tests;

pub use executor::{QoderExecutor, adapter, adapter_with_endpoints};
pub use types::{QODER_KEYS, QODER_PROVIDER, QoderEndpoints};
