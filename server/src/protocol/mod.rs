//! OpenAI wire contract shared by the gateway handlers and the provider
//! adapters.
//!
//! Kept outside both `features::gateway` and `features::providers` so neither
//! feature depends on the other for its request/response types; both depend on
//! this leaf module instead.

pub mod image;
pub mod model;
pub mod sse;
pub mod usage;
