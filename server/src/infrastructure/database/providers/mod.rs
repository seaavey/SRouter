//! Provider connection store behind the provider catalog. Only management
//! columns are read: `credentials` never leaves the database.
//!
//! Split into the connection catalog (`connections`) and the per-driver
//! credential stores (`credentials`); the public path stays
//! `database::providers::*`.

mod connections;
mod credentials;

pub(crate) use connections::{PROVIDER_ENABLED_PREFIX, matches_base_id};
pub use connections::{
    ProviderConnection, ProviderForQuota, ProviderPatch, apply_provider_patch, list_connections,
    list_providers_for_quota, provider_enabled, provider_exists,
};
pub use credentials::{
    AntigravityConnectionWrite, AntigravityCredentials, ClineConnectionWrite, ClineCredentials,
    CodeBuddyConnectionWrite, CodeBuddyCredentials, CodexConnectionWrite, CodexCredentials,
    GrokWebConnectionWrite, GrokWebCredentials, QoderConnectionWrite, QoderCredentials,
    load_antigravity_credentials, load_cline_credentials, load_codebuddy_credentials,
    load_codex_credentials, load_grok_web_credentials, load_qoder_credentials,
    update_antigravity_project_id, update_antigravity_tokens, update_cline_tokens,
    update_codex_tokens, upsert_antigravity_connection, upsert_cline_connection,
    upsert_codebuddy_connection, upsert_codex_connection, upsert_grok_web_connection,
    upsert_qoder_connection,
};
