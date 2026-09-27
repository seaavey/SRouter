//! OpenCode Zen provider module.

pub mod executor;
pub mod types;

#[cfg(test)]
mod tests;

pub use executor::{
    OpenCodeExecutor, adapter, adapter_with_base_url, opencode_executor,
    opencode_executor_with_base_url,
};
pub use types::{
    OPENCODE_ZEN_BASE_URL, OPENCODE_ZEN_KEYS, OPENCODE_ZEN_MODELS, OPENCODE_ZEN_PROVIDER,
};
