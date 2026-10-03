//! Cline provider: WorkOS device-flow OAuth, the live model catalog from
//! `GET /api/v1/models`, and the OpenAI-compatible chat executor.

pub mod catalog;
pub mod executor;
pub mod types;

pub use executor::{ClineExecutor, adapter, adapter_with_endpoints};
pub use types::{CLINE_KEYS, CLINE_PROVIDER, ClineEndpoints};
