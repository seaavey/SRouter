//! Cline provider types, endpoints, and the static provider metadata.
//!
//! Provenance for every constant here, independent of `packages/*`:
//! - official binary npm `cline` 3.0.66, `bin/.cline` (offsets in the plan)
//! - `docs.cline.bot` pages: api/authentication, api/chat-completions, api/models, api/errors
//! - live probes without credentials on 2026-09-30
//! - `apps/api` (behavioural oracle): auth.logic.ts, authHandlers.ts, tokenRefresh.ts
//! - `apps/web/src/components/providers/providers.oauth-flow.tsx`
//! - `docs/api-v1-contract.md` rows 57-58

use crate::features::providers::model::{ProviderMetadata, ProviderProtocol};

/// API root for chat, the model catalog, and the token refresh call.
pub const CLINE_BASE_URL: &str = "https://api.cline.bot/api/v1";
/// Marketing site behind the operator's browser step.
pub const CLINE_WEB_URL: &str = "https://cline.bot";
/// WorkOS root of the device authorization and token poll.
pub const CLINE_WORKOS_BASE_URL: &str = "https://api.workos.com";
/// WorkOS client id shipped by the official client (binary offset 81680331).
pub const CLINE_WORKOS_CLIENT_ID: &str = "client_01K3A541FN8TA3EPPHTD2325AR";

/// The product-surface header every chat request carries. Upstream answers
/// `403 ... only available via Cline product surfaces` to the `cline-free/*`
/// models without it (official binary sets `X-CLIENT-TYPE` from the client
/// name: `cline-cli`, `cline-sdk`, `cline-platform`, ...).
pub const CLINE_CLIENT_TYPE: &str = "cline-cli";

/// Registry lookup keys: the base id is also the user-facing alias, so a model
/// advertises as `cline/<upstream id>`.
pub const CLINE_KEYS: &[&str] = &["cline"];

pub const CLINE_PROVIDER: ProviderMetadata = ProviderMetadata {
    id: "cline",
    name: "Cline",
    category: "oauth",
    protocol: ProviderProtocol::OpenAI,
    base_url: CLINE_BASE_URL,
    web_url: CLINE_WEB_URL,
    alias: "cline",
    requires_api_key: false,
    requires_oauth: true,
    supports_custom_url: false,
    status_message: "Cline account not connected",
};

/// Hosts the device flow talks to. Production defaults are the constants above;
/// tests inject the fake upstream through `adapter_with_endpoints`.
#[derive(Debug, Clone)]
pub struct ClineEndpoints {
    pub workos_device_url: String,
    pub workos_authenticate_url: String,
    pub api_base_url: String,
}

impl Default for ClineEndpoints {
    fn default() -> Self {
        Self {
            workos_device_url: format!("{CLINE_WORKOS_BASE_URL}/user_management/authorize/device"),
            workos_authenticate_url: format!(
                "{CLINE_WORKOS_BASE_URL}/user_management/authenticate"
            ),
            api_base_url: CLINE_BASE_URL.to_owned(),
        }
    }
}
