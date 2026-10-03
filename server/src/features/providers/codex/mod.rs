//! Codex provider: the `openai_codex` driver backed by the ChatGPT OAuth
//! session and the upstream Responses API.

pub mod executor;
pub mod types;

pub use executor::{CodexExecutor, adapter, adapter_with_endpoints};
pub use types::{CODEX_KEYS, CODEX_MODELS, CODEX_PROVIDER, CodexEndpoints};
