//! CodeBuddy provider types, endpoints, and the static provider metadata.
//!
//! Provenance for every constant here, independent of `packages/*`:
//! - official binary `@tencent-ai/codebuddy-code` 2.161.2 (reverse-engineering
//!   notes in `~/Projects/SRouter/.local/codebuddy-reverse-engineering.md`)
//! - `apps/api` + `packages/executors/src/codebuddy.ts` (behavioural oracle)
//! - live probe on 2026-10-04: the product-config endpoint is `GET {base}/v3/config`
//!   (`/v2/config`, `/config/models`, `/v2/models` are all 404)

use std::path::PathBuf;

use crate::features::providers::model::ProviderMetadata;

/// Chat endpoint of the global flavor. The Node oracle stores the full
/// completions URL as its base; the executor POSTs to it verbatim.
pub const CODEBUDDY_CHAT_URL: &str = "https://www.codebuddy.ai/v2/chat/completions";
/// Product-configuration endpoint that carries the live model catalog.
pub const CODEBUDDY_CONFIG_URL: &str = "https://www.codebuddy.ai/v3/config";
/// Marketing site behind the operator's browser step.
pub const CODEBUDDY_WEB_URL: &str = "https://www.codebuddy.ai";

/// Chat endpoint of the China flavor.
pub const CODEBUDDY_CN_CHAT_URL: &str = "https://copilot.tencent.com/v2/chat/completions";
/// Product-configuration endpoint of the China flavor.
pub const CODEBUDDY_CN_CONFIG_URL: &str = "https://copilot.tencent.com/v3/config";
/// China marketing site.
pub const CODEBUDDY_CN_WEB_URL: &str = "https://www.codebuddy.cn";

/// Inference user agent of the global (IDE plugin) flavor, matching the Node
/// oracle's default (`packages/executors/src/codebuddy.ts`).
pub const CODEBUDDY_USER_AGENT: &str = "IDE/2.108.1 CodeBuddy/2.108.1";
/// Inference user agent of the China (CLI) flavor.
pub const CODEBUDDY_CN_USER_AGENT: &str = "CLI/2.96.0 CodeBuddy/2.96.0";

/// Registry lookup keys for the global flavor. The base id is also the
/// user-facing alias, so a model advertises as `codebuddy/<upstream id>`.
pub const CODEBUDDY_KEYS: &[&str] = &["codebuddy"];
/// Registry lookup keys for the China flavor.
pub const CODEBUDDY_CN_KEYS: &[&str] = &["codebuddy-cn"];

pub const CODEBUDDY_PROVIDER: ProviderMetadata = ProviderMetadata {
    id: "codebuddy",
    name: "CodeBuddy",
    category: "oauth",
    protocol: "openai",
    base_url: CODEBUDDY_CHAT_URL,
    web_url: CODEBUDDY_WEB_URL,
    alias: "codebuddy",
    requires_api_key: false,
    requires_oauth: true,
    supports_custom_url: true,
    status_message: "CodeBuddy account not connected",
};

pub const CODEBUDDY_CN_PROVIDER: ProviderMetadata = ProviderMetadata {
    id: "codebuddy-cn",
    name: "CodeBuddy CN",
    category: "oauth",
    protocol: "openai",
    base_url: CODEBUDDY_CN_CHAT_URL,
    web_url: CODEBUDDY_CN_WEB_URL,
    alias: "codebuddy-cn",
    requires_api_key: false,
    requires_oauth: true,
    supports_custom_url: true,
    status_message: "CodeBuddy CN account not connected",
};

/// The endpoints one flavor talks to. Production defaults are the constants
/// above; tests inject a fake upstream through `adapter_with_endpoints`.
#[derive(Debug, Clone)]
pub struct CodeBuddyEndpoints {
    pub chat_url: String,
    pub config_url: String,
    /// `X-Domain` header value, set for the China flavor only (the Node oracle
    /// sends no `X-Domain` for the global flavor).
    pub domain: Option<&'static str>,
    /// The official package's `product.json`, the source of the personal-account
    /// model list. `None` (tests, or no installed package) skips it and leaves
    /// only the live enterprise config.
    pub product_json_path: Option<PathBuf>,
}

impl Default for CodeBuddyEndpoints {
    fn default() -> Self {
        Self {
            chat_url: CODEBUDDY_CHAT_URL.to_owned(),
            config_url: CODEBUDDY_CONFIG_URL.to_owned(),
            domain: None,
            product_json_path: super::product::resolve_product_json_path(),
        }
    }
}

impl CodeBuddyEndpoints {
    /// The China flavor's endpoints: different host, and the `X-Domain` header.
    pub fn cn() -> Self {
        Self {
            chat_url: CODEBUDDY_CN_CHAT_URL.to_owned(),
            config_url: CODEBUDDY_CN_CONFIG_URL.to_owned(),
            domain: Some("www.codebuddy.cn"),
            product_json_path: super::product::resolve_product_json_path(),
        }
    }
}

/// The two CodeBuddy deployments. One executor type is parameterized by this,
/// so the wire behavior is written once and only the endpoints, headers, and
/// registry identity differ.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Flavor {
    Global,
    China,
}

impl Flavor {
    /// The `provider_id` the OAuth flow writes into the `providers` table and
    /// the executor reads back. Also the catalog alias.
    pub fn provider_id(self) -> &'static str {
        match self {
            Self::Global => "codebuddy",
            Self::China => "codebuddy-cn",
        }
    }

    pub fn keys(self) -> &'static [&'static str] {
        match self {
            Self::Global => CODEBUDDY_KEYS,
            Self::China => CODEBUDDY_CN_KEYS,
        }
    }

    pub fn alias(self) -> &'static str {
        self.provider_id()
    }

    /// The `X-IDE-Type`/`X-IDE-Name` value: the IDE plugin for global, the CLI
    /// for China (`getHeaders` in the Node oracle).
    pub fn ide_name(self) -> &'static str {
        match self {
            Self::Global => "IDE",
            Self::China => "CLI",
        }
    }

    pub fn user_agent(self) -> &'static str {
        match self {
            Self::Global => CODEBUDDY_USER_AGENT,
            Self::China => CODEBUDDY_CN_USER_AGENT,
        }
    }

    pub fn endpoints(self) -> CodeBuddyEndpoints {
        match self {
            Self::Global => CodeBuddyEndpoints::default(),
            Self::China => CodeBuddyEndpoints::cn(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flavors_are_distinct_in_identity_and_wire_configuration() {
        assert_eq!(Flavor::Global.provider_id(), "codebuddy");
        assert_eq!(Flavor::China.provider_id(), "codebuddy-cn");
        assert_eq!(Flavor::Global.keys(), &["codebuddy"]);
        assert_eq!(Flavor::China.keys(), &["codebuddy-cn"]);
        assert_eq!(Flavor::Global.alias(), "codebuddy");
        assert_eq!(Flavor::China.alias(), "codebuddy-cn");
        assert_eq!(Flavor::Global.ide_name(), "IDE");
        assert_eq!(Flavor::China.ide_name(), "CLI");
        assert_eq!(Flavor::Global.user_agent(), CODEBUDDY_USER_AGENT);
        assert_eq!(Flavor::China.user_agent(), CODEBUDDY_CN_USER_AGENT);
    }

    #[test]
    fn only_the_china_flavor_sets_the_domain_header() {
        assert_eq!(Flavor::Global.endpoints().domain, None);
        assert_eq!(Flavor::China.endpoints().domain, Some("www.codebuddy.cn"));
    }

    #[test]
    fn endpoints_point_at_the_v3_config_and_v2_chat_paths() {
        let global = Flavor::Global.endpoints();
        assert_eq!(global.chat_url, CODEBUDDY_CHAT_URL);
        assert_eq!(global.config_url, CODEBUDDY_CONFIG_URL);

        let china = Flavor::China.endpoints();
        assert_eq!(china.chat_url, CODEBUDDY_CN_CHAT_URL);
        assert_eq!(china.config_url, CODEBUDDY_CN_CONFIG_URL);
    }

    #[test]
    fn the_seed_metadata_carries_each_flavor_identity() {
        assert_eq!(CODEBUDDY_PROVIDER.id, "codebuddy");
        assert_eq!(CODEBUDDY_PROVIDER.alias, "codebuddy");
        assert_eq!(CODEBUDDY_PROVIDER.base_url, CODEBUDDY_CHAT_URL);
        assert_eq!(CODEBUDDY_CN_PROVIDER.id, "codebuddy-cn");
        assert_eq!(CODEBUDDY_CN_PROVIDER.alias, "codebuddy-cn");
        assert_eq!(CODEBUDDY_CN_PROVIDER.base_url, CODEBUDDY_CN_CHAT_URL);
    }
}
