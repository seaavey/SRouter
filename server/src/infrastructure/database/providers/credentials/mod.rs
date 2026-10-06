//! Per-driver credential stores behind the provider catalog. Each driver owns
//! one module with its credential shape, its parser, and the load/upsert/update
//! queries that read and write the `providers.credentials` column.

mod antigravity;
mod claude;
mod cline;
mod codebuddy;
mod codex;
mod grok_web;
mod qoder;

use serde_json::Value;

pub use antigravity::{
    AntigravityConnectionWrite, AntigravityCredentials, load_antigravity_credentials,
    update_antigravity_project_id, update_antigravity_tokens, upsert_antigravity_connection,
};
pub use claude::{
    ClaudeConnectionWrite, ClaudeCredentials, load_claude_credentials, update_claude_tokens,
    upsert_claude_connection,
};
pub use cline::{
    ClineConnectionWrite, ClineCredentials, load_cline_credentials, update_cline_tokens,
    upsert_cline_connection,
};
pub use codebuddy::{
    CodeBuddyConnectionWrite, CodeBuddyCredentials, load_codebuddy_credentials,
    upsert_codebuddy_connection,
};
pub use codex::{
    CodexConnectionWrite, CodexCredentials, load_codex_credentials, update_codex_tokens,
    upsert_codex_connection,
};
pub use grok_web::{
    GrokWebConnectionWrite, GrokWebCredentials, load_grok_web_credentials,
    upsert_grok_web_connection,
};
pub use qoder::{
    QoderConnectionWrite, QoderCredentials, load_qoder_credentials, upsert_qoder_connection,
};

/// Reads one credential field under either spelling. Empty strings count as
/// missing, so a token that was cleared cannot be mistaken for a stored one.
pub(super) fn credential_string(
    object: &serde_json::Map<String, Value>,
    keys: &[&str],
) -> Option<String> {
    keys.iter()
        .find_map(|key| object.get(*key).and_then(Value::as_str))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}
