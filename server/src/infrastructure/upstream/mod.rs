//! Shared upstream HTTP transport. Provider-specific request mapping stays with
//! its adapter; this module owns the client, timeouts, and address guards.

pub mod client;
pub mod ssrf;

pub use client::{STREAM_IDLE_TIMEOUT, UpstreamClient};
