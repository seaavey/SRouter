//! Claude Code provider types: metadata, the Anthropic OAuth constants, and the
//! request fingerprint the vendor gates on.
//!
//! Provenance for every constant here, independent of `packages/*`:
//! - reverse engineering of the official client binary (`@anthropic-ai/claude-code`
//!   2.1.291, `bin/claude.exe`, 2026-10-06): the OAuth client id is byte-equal to
//!   the one here, the Messages base is `https://api.anthropic.com`, the
//!   `anthropic-version` is `2023-06-01`, the user-agent entrypoint is `sdk-cli`,
//!   and 8 of the 9 `Anthropic-Beta` flags below are present.
//! - the Claude Code OAuth client is public and widely reimplemented: the client
//!   id, the `claude.ai` authorize host, and the
//!   `org:create_api_key user:profile user:inference` scope are corroborated by
//!   four independent sources (the coqu Claude OAuth reference, the `pacode-auth`
//!   and `modelbridge` Rust crates, and `grll/claude-code-login`), and by the
//!   official Claude Code docs for the account-token model.
//! - `apps/api` and the Node oracle's own constant modules are the behavioural
//!   oracle, not the source of record for these literals.
//!
//! Deviations from the Node oracle this module records for the executor:
//! - the OAuth hosts here are the Node oracle's (`claude.ai/oauth/authorize`,
//!   `api.anthropic.com/v1/oauth/token`). The 2.1.291 binary has since moved to
//!   `claude.com/cai/oauth/authorize` / `platform.claude.com/v1/oauth/token`;
//!   the oracle values are kept for parity, and both are injectable through
//!   [`ClaudeEndpoints`], so an operator (or a test) can point them elsewhere.
//! - the `Anthropic-Beta` set is the oracle's `selectAnthropicBeta` list; the
//!   binary no longer sends `token-efficient-tools-2026-03-28`.
//! - the model catalog is live (`GET {base}/models`), not a seeded list.

use crate::features::providers::model::{ProviderMetadata, ProviderProtocol};

/// The Anthropic Messages API base; the chat endpoint is `{base}/messages` and
/// the live catalog is `{base}/models`.
pub const CLAUDE_BASE_URL: &str = "https://api.anthropic.com/v1";
/// Marketing site behind the operator's browser step.
pub const CLAUDE_WEB_URL: &str = "https://claude.ai";

/// Claude Code OAuth authorize endpoint.
pub const CLAUDE_OAUTH_AUTHORIZE_URL: &str = "https://claude.ai/oauth/authorize";
/// Claude Code OAuth token endpoint. JSON body, `client_id` only, no secret.
pub const CLAUDE_OAUTH_TOKEN_URL: &str = "https://api.anthropic.com/v1/oauth/token";
/// The official Claude Code OAuth public client id.
pub const CLAUDE_OAUTH_CLIENT_ID: &str = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
/// The scopes the Node oracle requests. Overridable per login through `?scope=`.
pub const CLAUDE_OAUTH_SCOPE: &str = "org:create_api_key user:profile user:inference";

/// The `anthropic-version` header the Messages API requires.
pub const CLAUDE_ANTHROPIC_VERSION: &str = "2023-06-01";

/// The `Anthropic-Beta` flags every Claude model request carries.
pub const ANTHROPIC_BETA_BASE: &[&str] = &[
    "claude-code-20250219",
    "oauth-2025-04-20",
    "interleaved-thinking-2025-05-14",
    "context-management-2025-06-27",
    "prompt-caching-scope-2026-01-05",
    "structured-outputs-2025-12-15",
    "fast-mode-2026-02-01",
    "redact-thinking-2026-02-12",
    "token-efficient-tools-2026-03-28",
];
/// The extra flags gated to the heavy-agent families (`claude-opus`, `claude-sonnet`).
pub const ANTHROPIC_BETA_HEAVY_AGENT: &[&str] =
    &["advanced-tool-use-2025-11-20", "effort-2025-11-24"];

/// The `Anthropic-Beta` header value for `model`, mirroring Node's
/// `selectAnthropicBeta`: the base set plus the heavy-agent flags for the
/// opus/sonnet families.
pub fn anthropic_beta(model: &str) -> String {
    let mut flags = ANTHROPIC_BETA_BASE.to_vec();
    let bare = model.rsplit('/').next().unwrap_or(model);
    if bare.starts_with("claude-opus") || bare.starts_with("claude-sonnet") {
        flags.extend_from_slice(ANTHROPIC_BETA_HEAVY_AGENT);
    }

    flags.join(",")
}

/// The full Claude CLI fingerprint. The subscription endpoint rejects a request
/// that does not identify as the official client, so these ride every OAuth call.
pub const CLAUDE_CLI_HEADERS: &[(&str, &str)] = &[
    ("Anthropic-Dangerous-Direct-Browser-Access", "true"),
    ("User-Agent", "claude-cli/2.1.92 (external, sdk-cli)"),
    ("X-App", "cli"),
    ("X-Stainless-Helper-Method", "stream"),
    ("X-Stainless-Retry-Count", "0"),
    ("X-Stainless-Runtime-Version", "v24.14.0"),
    ("X-Stainless-Package-Version", "0.80.0"),
    ("X-Stainless-Runtime", "node"),
    ("X-Stainless-Lang", "js"),
    ("X-Stainless-Arch", "arm64"),
    ("X-Stainless-Os", "MacOS"),
    ("X-Stainless-Timeout", "600"),
];

pub const CLAUDE_PROVIDER: ProviderMetadata = ProviderMetadata {
    id: "claude",
    name: "Claude Code",
    category: "oauth",
    protocol: ProviderProtocol::Anthropic,
    base_url: CLAUDE_BASE_URL,
    web_url: CLAUDE_WEB_URL,
    alias: "claude",
    requires_api_key: false,
    requires_oauth: true,
    supports_custom_url: false,
    status_message: "Claude OAuth token missing",
};

/// Every endpoint this provider talks to. Production defaults are the constants
/// above; a test points them at a fake upstream with a single value.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ClaudeEndpoints {
    pub chat_url: String,
    pub models_url: String,
    pub token_url: String,
}

impl Default for ClaudeEndpoints {
    fn default() -> Self {
        Self {
            chat_url: format!("{CLAUDE_BASE_URL}/messages"),
            models_url: format!("{CLAUDE_BASE_URL}/models"),
            token_url: CLAUDE_OAUTH_TOKEN_URL.to_owned(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_beta_header_adds_the_heavy_agent_flags_only_for_opus_and_sonnet() {
        let sonnet = anthropic_beta("claude-sonnet-4-5");
        assert!(sonnet.contains("advanced-tool-use-2025-11-20"));
        assert!(sonnet.contains("effort-2025-11-24"));

        let haiku = anthropic_beta("claude-haiku-4-5");
        assert!(haiku.contains("claude-code-20250219"));
        assert!(!haiku.contains("advanced-tool-use-2025-11-20"));
    }

    #[test]
    fn the_beta_header_ignores_a_provider_prefix() {
        assert_eq!(
            anthropic_beta("claude/claude-opus-4-1"),
            anthropic_beta("claude-opus-4-1")
        );
    }

    #[test]
    fn provider_metadata_carries_the_registered_identity() {
        assert_eq!(CLAUDE_PROVIDER.id, "claude");
        assert_eq!(CLAUDE_PROVIDER.alias, "claude");
        assert_eq!(CLAUDE_PROVIDER.category, "oauth");
        assert_eq!(CLAUDE_PROVIDER.protocol, ProviderProtocol::Anthropic);
        assert_eq!(CLAUDE_PROVIDER.base_url, CLAUDE_BASE_URL);
    }

    #[test]
    fn default_endpoints_point_at_the_anthropic_hosts() {
        let endpoints = ClaudeEndpoints::default();

        assert_eq!(endpoints.chat_url, "https://api.anthropic.com/v1/messages");
        assert_eq!(endpoints.models_url, "https://api.anthropic.com/v1/models");
        assert_eq!(
            endpoints.token_url,
            "https://api.anthropic.com/v1/oauth/token"
        );
    }
}
