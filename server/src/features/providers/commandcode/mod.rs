//! Command Code provider: the CLI's `/alpha/generate` wire.
//!
//! This is deliberately not the documented Provider API under `/provider/v1` —
//! an OpenAI-compatible endpoint already has a home in a custom-provider row, and
//! a key from the studio sign-in is valid only against this one. Models come from
//! the public `/provider/v1/models` list, so the catalog is empty until a
//! connection exists and a refresh succeeds.

pub mod catalog;
pub mod executor;
pub mod types;

mod auth;
mod refresh;
mod request;
mod translate;

#[cfg(test)]
mod tests;

pub use executor::{CATALOG_REQUEST_TIMEOUT, CommandCodeExecutor, adapter, adapter_with_endpoints};
pub use types::{
    COMMANDCODE_KEYS, COMMANDCODE_ORIGIN, COMMANDCODE_PROVIDER, COMMANDCODE_STUDIO_AUTH_URL,
    COMMANDCODE_STUDIO_ORIGIN, CommandCodeEndpoints,
};
