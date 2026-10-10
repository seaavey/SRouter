//! Claude Code provider: the Anthropic OAuth session, the live model catalog,
//! and the Messages-API executor.
//!
//! The submodules follow the provider contract: `types` holds the metadata, the
//! OAuth constants, and the request fingerprint, `catalog` the live `/models`
//! snapshot policy, and `executor` the thin `ProviderExecutor` that carries the
//! credential load, the lazy refresh, and the request/response/SSE translation.

pub mod catalog;
pub mod executor;
pub mod types;

pub use executor::{CLAUDE_KEYS, ClaudeExecutor, adapter, adapter_with_endpoints};
pub use types::{CLAUDE_PROVIDER, ClaudeEndpoints};
