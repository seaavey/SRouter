//! Antigravity provider types: metadata, the static 17-id CloudCode catalog,
//! the Google OAuth constants, and the endpoints this slice talks to.
//!
//! Provenance for every constant here, independent of `packages/*`:
//! - reverse engineering of the official client binary `agy` (2026-10-04): the
//!   OAuth endpoints, the embedded client id/secret pair, the `cloudcode-pa` /
//!   `daily-cloudcode-pa` hosts, and 13 of the 17 catalog ids.
//! - live probes without credentials (2026-10-05): Google accepts only loopback
//!   redirect URIs for this client, the token endpoint requires `client_secret`
//!   for both grants, and there is no unauthenticated model endpoint.
//! - the public OmniRoute repository: the `gemini-3.x-flash-tiered` alias table,
//!   the `claude-opus-4-x-thinking` family, and the always-stream endpoint.
//! - `apps/api` plus the Node oracle's own constant modules (behavioural oracle).
//!
//! Deviations from the Node oracle this module records for the executor:
//! - D3: the OAuth redirect URI is pinned to loopback; `SROUTER_PUBLIC_URL` is
//!   ignored for Antigravity because Google rejects any non-loopback redirect
//!   for this client. Remote completions use the callback-paste path instead.
//! - D5: the CloudCode project id is resolved once through `loadCodeAssist` and
//!   persisted on the connection, falling back to a generated id on failure.
//! - D7: the chat endpoint is the static `daily-cloudcode-pa` host; a
//!   per-connection `base_url` is not honored, and the OpenAI-compatible
//!   fallback executor for `AIzaSy` keys is deferred.

use crate::features::providers::model::ProviderMetadata;

/// Static chat host of the CloudCode IDE envelope. It is not the OpenAI-compatible
/// `generativelanguage.googleapis.com` base the deferred fallback executor would use.
pub const ANTIGRAVITY_IDE_BASE_URL: &str = "https://daily-cloudcode-pa.googleapis.com";
/// Marketing site behind the operator's browser step.
pub const ANTIGRAVITY_WEB_URL: &str = "https://ai.google.dev";

/// The always-stream chat endpoint. Non-stream callers accumulate the SSE frames.
pub const ANTIGRAVITY_CHAT_URL: &str =
    "https://daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse";
/// Project-bootstrap endpoint that resolves `cloudaicompanionProject` (D5).
pub const ANTIGRAVITY_CODE_ASSIST_URL: &str =
    "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist";

/// Google OAuth authorize endpoint.
pub const ANTIGRAVITY_OAUTH_AUTHORIZE_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
/// Google OAuth token endpoint; form-encoded, and `client_secret` is required
/// for both the `authorization_code` and `refresh_token` grants.
pub const ANTIGRAVITY_OAUTH_TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
/// The official Antigravity Google OAuth public client id.
pub const ANTIGRAVITY_OAUTH_CLIENT_ID: &str =
    "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com";
/// The official Antigravity Google OAuth public client secret.
pub const ANTIGRAVITY_OAUTH_CLIENT_SECRET: &str = "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";
/// The Node oracle's four scopes; the binary requests seven, the extra four are
/// not known to be required (recorded as an open question).
pub const ANTIGRAVITY_OAUTH_SCOPE: &str =
    "openid profile email https://www.googleapis.com/auth/cloud-platform";
/// Default consent prompt, overridable per login through `?prompt=`.
pub const ANTIGRAVITY_OAUTH_PROMPT: &str = "consent";

pub const ANTIGRAVITY_PROVIDER: ProviderMetadata = ProviderMetadata {
    id: "antigravity",
    name: "Google Antigravity",
    category: "oauth",
    protocol: "openai",
    base_url: ANTIGRAVITY_IDE_BASE_URL,
    web_url: ANTIGRAVITY_WEB_URL,
    alias: "antigravity",
    requires_api_key: false,
    requires_oauth: true,
    supports_custom_url: false,
    status_message: "Antigravity OAuth token missing",
};

/// The static catalog. There is no unauthenticated model endpoint (probe 401),
/// so the list is static by necessity; the executor advertises it only while a
/// connection exists.
pub const ANTIGRAVITY_MODEL_IDS: &[&str] = &[
    "gemini-3.8-flash-high",
    "gemini-3.8-flash-medium",
    "gemini-3.8-flash-low",
    "gemini-3.7-flash-high",
    "gemini-3.7-flash-medium",
    "gemini-3.7-flash-low",
    "gemini-3.6-flash-high",
    "gemini-3.6-flash-medium",
    "gemini-3.6-flash-low",
    "gemini-3.5-flash-high",
    "gemini-3.5-flash-medium",
    "gemini-3.5-flash-low",
    "gemini-3.1-pro-high",
    "gemini-3.1-pro-low",
    "claude-sonnet-4-6",
    "claude-opus-4-6-thinking",
    "gpt-oss-120b-medium",
];

/// Every endpoint this provider talks to. Production defaults are the constants
/// above; a test points them at a fake upstream with a single value.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AntigravityEndpoints {
    pub chat_url: String,
    pub token_url: String,
    pub code_assist_url: String,
}

impl Default for AntigravityEndpoints {
    fn default() -> Self {
        Self {
            chat_url: ANTIGRAVITY_CHAT_URL.to_owned(),
            token_url: ANTIGRAVITY_OAUTH_TOKEN_URL.to_owned(),
            code_assist_url: ANTIGRAVITY_CODE_ASSIST_URL.to_owned(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_catalog_lists_the_seventeen_node_ids() {
        assert_eq!(ANTIGRAVITY_MODEL_IDS.len(), 17);
        assert!(ANTIGRAVITY_MODEL_IDS.contains(&"gemini-3.7-flash-high"));
        assert!(ANTIGRAVITY_MODEL_IDS.contains(&"claude-opus-4-6-thinking"));
        assert!(ANTIGRAVITY_MODEL_IDS.contains(&"gpt-oss-120b-medium"));
    }

    #[test]
    fn the_catalog_ids_are_unique_and_non_empty() {
        let mut seen = std::collections::HashSet::new();

        for id in ANTIGRAVITY_MODEL_IDS {
            assert!(!id.is_empty());
            assert!(seen.insert(*id), "duplicate model id {id}");
        }
    }

    #[test]
    fn default_endpoints_point_at_the_cloudcode_hosts() {
        let endpoints = AntigravityEndpoints::default();

        assert_eq!(
            endpoints.chat_url,
            "https://daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse"
        );
        assert_eq!(endpoints.token_url, "https://oauth2.googleapis.com/token");
        assert_eq!(
            endpoints.code_assist_url,
            "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist"
        );
    }

    #[test]
    fn provider_metadata_carries_the_registered_identity() {
        assert_eq!(ANTIGRAVITY_PROVIDER.id, "antigravity");
        assert_eq!(ANTIGRAVITY_PROVIDER.alias, "antigravity");
        assert_eq!(ANTIGRAVITY_PROVIDER.category, "oauth");
        assert_eq!(ANTIGRAVITY_PROVIDER.protocol, "openai");
        assert_eq!(ANTIGRAVITY_PROVIDER.base_url, ANTIGRAVITY_IDE_BASE_URL);
    }
}
