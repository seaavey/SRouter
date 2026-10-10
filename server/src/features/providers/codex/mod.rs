//! Codex provider: the `openai_codex` driver backed by the ChatGPT OAuth
//! session and the upstream Responses API.

pub mod catalog;
pub mod executor;
pub mod quota;
pub mod types;

mod auth;
mod request;
mod translate;

#[cfg(test)]
mod tests;

pub use catalog::{
    CATALOG_REQUEST_TIMEOUT, CATALOG_RETRY_MS, CATALOG_TTL_MS, CodexCatalog, SharedCatalog,
    read_catalog, write_catalog,
};
pub use executor::{CodexExecutor, adapter, adapter_with_endpoints};
pub use quota::{CODEX_USAGE_URL, fetch_codex_quota};
pub use types::{CODEX_CLIENT_VERSION, CODEX_KEYS, CODEX_PROVIDER, CodexEndpoints};
