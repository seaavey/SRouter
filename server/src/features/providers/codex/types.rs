//! Codex provider types, endpoints, the model seed, and static metadata.
//!
//! Provenance for every constant here, independent of `packages/*`:
//! - vendor binary `@openai/codex` 0.160.0 (`vendor/.../bin/codex`, ELF64 static-pie,
//!   289101384 bytes, sha256 `12eb3e81114588aca3b7998f4f19e8997b056aca08e57a7ca7c8a3ec8c652aad`):
//!   the carved default model catalog (offset 238887657, 472511 bytes), the OAuth token/revoke
//!   endpoints, the public client id, and the `chatgpt-account-id` / `originator` header names.
//! - a credential-free probe of that binary against a local fake upstream: the captured request
//!   headers and `POST /v1/responses` body (scratch `codex-capture.json`) and the error behaviour
//!   for 401 / 429 / 500 (scratch `codex-re-report.md`).
//! - `apps/api/src/services/authHandlers.ts`: the `openai_codex` handler's oauth field set
//!   (`accessToken`, `refreshToken`, `accountId`, `expiresIn`).
//! - `apps/api/tests/token-refresh.test.ts`: the refresh response shape and the `Bearer` header
//!   the executor sends.
//! - `docs/api-database-contract.md`: `providers.credentials` columns (`access_token`,
//!   `refresh_token`, `account_id`, `token_expires_at`, `last_refreshed_at`).

use crate::features::providers::model::{ModelDefinition, ProviderMetadata};

/// API root for `POST {base}/responses` and the model list.
pub const CODEX_BASE_URL: &str = "https://chatgpt.com/backend-api/codex";

/// OAuth token endpoint the official CLI refreshes against (binary literals
/// `https://auth.openai.com/oauth/token` + `grant_type=...`).
pub const CODEX_TOKEN_URL: &str = "https://auth.openai.com/oauth/token";

/// OAuth authorization endpoint the official CLI opens in the browser (binary
/// literal `https://auth.openai.com/oauth/authorize`).
pub const CODEX_AUTHORIZE_URL: &str = "https://auth.openai.com/oauth/authorize";

/// OAuth scopes the official client requests. Source: `openai/codex`
/// `codex-rs/login/src/server.rs` (`build_authorize_url`), which replaced the
/// earlier `openid profile email offline_access` set.
pub const CODEX_OAUTH_SCOPE: &str =
    "openid profile email offline_access api.connectors.read api.connectors.invoke";

/// Public OAuth client id shipped by the official client (binary literal).
pub const CODEX_OAUTH_CLIENT_ID: &str = "app_EMoamEEZ73f0CkXaXp7hrann";

/// The official client's default `originator` value (binary literal next to
/// `login/src/auth/default_client.rs`). Upstream keys telemetry on it.
pub const CODEX_ORIGINATOR: &str = "codex_cli_rs";

/// The official client's user-agent shape, `<originator>/<version> (<os>; <arch>)
/// <client> (<originator>; <version>)`, so the pair stays self-consistent.
pub const CODEX_USER_AGENT: &str =
    "codex_cli_rs/0.160.0 (Linux; x86_64) srouter (codex_cli_rs; 0.160.0)";

/// Registry lookup keys: the base id is also the user-facing alias, so a model
/// advertises as `openai_codex/<slug>` (the id the Node gateway uses).
pub const CODEX_KEYS: &[&str] = &["openai_codex"];

pub const CODEX_PROVIDER: ProviderMetadata = ProviderMetadata {
    id: "openai_codex",
    name: "OpenAI Codex",
    category: "oauth",
    protocol: "openai",
    base_url: CODEX_BASE_URL,
    web_url: "https://chatgpt.com/codex",
    alias: "openai_codex",
    requires_api_key: false,
    requires_oauth: true,
    supports_custom_url: false,
    status_message: "OpenAI Codex account not connected",
};

/// The carved catalog's `visibility: "list"` entries — the models the official
/// client offers in its picker. The three `visibility: "hide"` slugs
/// (`gpt-daybreak-blue-latest`, `gpt-daybreak-red-latest`, `codex-auto-review`)
/// are internal and are deliberately not advertised.
pub const CODEX_MODELS: &[ModelDefinition] = &[
    ModelDefinition {
        id: "gpt-6-astra",
        name: "GPT-6-Astra",
    },
    ModelDefinition {
        id: "gpt-6.1-sol",
        name: "GPT-6.1-Sol",
    },
    ModelDefinition {
        id: "gpt-6-sol",
        name: "GPT-6-Sol",
    },
    ModelDefinition {
        id: "gpt-6-luna",
        name: "GPT-6-Luna",
    },
    ModelDefinition {
        id: "gpt-5.6-sol",
        name: "GPT-5.6-Sol",
    },
    ModelDefinition {
        id: "gpt-5.6-terra",
        name: "GPT-5.6-Terra",
    },
    ModelDefinition {
        id: "gpt-5.6-luna",
        name: "GPT-5.6-Luna",
    },
    ModelDefinition {
        id: "gpt-5.5",
        name: "GPT-5.5",
    },
];

/// Hosts the executor talks to. Production defaults are the constants above;
/// tests inject the fake upstream through `adapter_with_endpoints`.
#[derive(Debug, Clone)]
pub struct CodexEndpoints {
    /// `https://chatgpt.com/backend-api/codex` — the executor appends `/responses`.
    pub api_base_url: String,
    /// The OAuth token endpoint used for the lazy refresh.
    pub token_url: String,
}

impl Default for CodexEndpoints {
    fn default() -> Self {
        Self {
            api_base_url: CODEX_BASE_URL.to_owned(),
            token_url: CODEX_TOKEN_URL.to_owned(),
        }
    }
}
