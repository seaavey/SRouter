//! Qoder provider types, endpoints, and the static model seed.
//!
//! Provenance for every constant here, independent of `packages/*`:
//! - `apps/api/tests/qoder-provider.test.ts`
//! - `apps/api/src/logic/auth.logic.ts` and `apps/api/src/controllers/auth.controller.ts`
//! - `docs/api-v1-contract.md` rows 57-65
//! - public protocol docs: `pi-qoder-provider` (npm), `qoder2api`, `qodercli2api`, `docs.qoder.com`
//! - `apps/docs/src/pages/docs/concepts/providers-routing.md`

use crate::features::providers::model::ProviderMetadata;

/// Gateway root for chat and the model catalog. China/VPC hosts are a follow-up.
pub const QODER_BASE_URL: &str = "https://api3.qoder.sh";
/// OpenAPI root for the device flow and userinfo.
pub const QODER_OPENAPI_BASE_URL: &str = "https://openapi.qoder.sh";
pub const QODER_WEB_URL: &str = "https://qoder.com";
pub const QODER_LOGIN_URL: &str = "https://qoder.com/device/selectAccounts";

pub const QODER_MODEL_LIST_PATH: &str = "/algo/api/v2/model/list";
pub const QODER_CHAT_PATH: &str = "/algo/api/v2/service/pro/sse/agent_chat_generation";
pub const QODER_CHAT_QUERY: &str = "FetchKeys=llm_model_result&AgentId=agent_common&Encode=1";
pub const QODER_DEVICE_TOKEN_PATH: &str = "/api/v1/deviceToken/poll";
pub const QODER_USERINFO_PATH: &str = "/api/v1/userinfo";

/// Registry lookup keys: the base id plus the user-facing `qd` alias that
/// `ProviderMetadata::alias` and the model list prefix use.
pub const QODER_KEYS: &[&str] = &["qoder", "qd"];

/// Friendly model names the gateway accepts in place of a raw model key while
/// the live catalog has not answered. Once `model/list` has landed, that
/// snapshot decides both what is advertised and how a name resolves, so a row
/// here is only ever reached before the first fetch or for a name upstream never
/// used.
pub const QODER_MODEL_ALIASES: &[(&str, &str)] = &[
    ("qwen3.8-flash", "qfmodel"),
    ("qwen3.8-max", "qmodel_38max"),
    ("qwen3.7-max", "qmodel_latest"),
    ("qwen3.7-plus", "qmodel"),
    ("deepseek-v4-pro", "dmodel"),
    ("deepseek-v4-flash", "dfmodel"),
    ("glm-5.2", "gm51model"),
    ("kimi-k2.7", "kmodel"),
    ("minimax-m3", "mmodel"),
];

pub const QODER_PROVIDER: ProviderMetadata = ProviderMetadata {
    id: "qoder",
    name: "Qoder",
    category: "oauth",
    protocol: "openai",
    base_url: QODER_BASE_URL,
    web_url: QODER_WEB_URL,
    alias: "qd",
    requires_api_key: false,
    requires_oauth: true,
    supports_custom_url: false,
    status_message: "Qoder device token missing or expired",
};

/// Values the upstream signature checks against the Qoder CLI client.
pub const QODER_IDE_VERSION: &str = "1.0.0";
pub const QODER_CLIENT_TYPE: &str = "5";
pub const QODER_MACHINE_TYPE: &str = "5";
pub const QODER_MACHINE_OS: &str = "x86_64_windows";
pub const QODER_DATA_POLICY: &str = "disagree";
pub const QODER_LOGIN_VERSION: &str = "v2";
pub const QODER_USER_AGENT: &str = "qodercli/1.0.0";

/// 1024-bit RSA public key the gateway encrypts each AES key with.
pub const QODER_RSA_PUBLIC_KEY: &str = "-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDA8iMH5c02LilrsERw9t6Pv5Nc
4k6Pz1EaDicBMpdpxKduSZu5OANqUq8er4GM95omAGIOPOh+Nx0spthYA2BqGz+l
6HRkPJ7S236FZz73In/KVuLnwI8JJ2CbuJap8kvheCCZpmAWpb/cPx/3Vr/J6I17
XcW+ML9FoCI6AOvOzwIDAQAB
-----END PUBLIC KEY-----";

pub const QODER_DEFAULT_MAX_OUTPUT: i64 = 32_768;
pub const QODER_DEFAULT_CONTEXT: i64 = 180_000;

/// Settings key holding the stable machine id used in the COSY headers.
pub const QODER_MACHINE_ID_SETTING: &str = "qoder_machine_id";

/// Resolves a requested model id onto the key the gateway expects upstream.
/// An unknown id passes through, so a key the catalog has not seen yet still
/// reaches the model list lookup instead of failing locally.
pub fn resolve_model_key(model: &str) -> String {
    let model = model.trim();

    for (alias, key) in QODER_MODEL_ALIASES {
        if model.eq_ignore_ascii_case(alias) {
            return (*key).to_owned();
        }
    }

    model.to_owned()
}

/// Every endpoint this provider talks to. The executor owns the gateway root and
/// the auth routes own the OpenAPI root; keeping them in one struct lets a test
/// point both at a fake upstream with a single value.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct QoderEndpoints {
    pub base_url: String,
    pub login_url: String,
    pub device_token_url: String,
    pub userinfo_url: String,
}

impl Default for QoderEndpoints {
    fn default() -> Self {
        Self {
            base_url: QODER_BASE_URL.to_owned(),
            login_url: QODER_LOGIN_URL.to_owned(),
            device_token_url: format!("{QODER_OPENAPI_BASE_URL}{QODER_DEVICE_TOKEN_PATH}"),
            userinfo_url: format!("{QODER_OPENAPI_BASE_URL}{QODER_USERINFO_PATH}"),
        }
    }
}

impl QoderEndpoints {
    /// Chat endpoint. `Encode=1` opts the body into the obfuscated encoding the
    /// CLI sends.
    pub fn chat_url(&self) -> String {
        format!(
            "{}{}?{}",
            self.base_url.trim_end_matches('/'),
            QODER_CHAT_PATH,
            QODER_CHAT_QUERY
        )
    }

    /// Model catalog endpoint, signed like a chat request but with an empty body.
    pub fn model_list_url(&self) -> String {
        format!(
            "{}{}",
            self.base_url.trim_end_matches('/'),
            QODER_MODEL_LIST_PATH
        )
    }

    /// The browser authorization URL of the device flow.
    pub fn authorize_url(&self, challenge: &str, machine_id: &str, nonce: &str) -> String {
        format!(
            "{}?challenge={}&challenge_method=S256&machine_id={}&nonce={}",
            self.login_url,
            urlencode(challenge),
            urlencode(machine_id),
            urlencode(nonce)
        )
    }

    /// The poll query string of the device flow.
    pub fn device_poll_query(&self, nonce: &str, verifier: &str) -> String {
        format!(
            "?nonce={}&verifier={}&challenge_method=S256",
            urlencode(nonce),
            urlencode(verifier)
        )
    }
}

/// Percent-encodes a query value the way `URLSearchParams` does: the unreserved
/// set stays literal, everything else is `%XX`.
fn urlencode(value: &str) -> String {
    let mut encoded = String::with_capacity(value.len());

    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                encoded.push(byte as char);
            }
            _ => encoded.push_str(&format!("%{byte:02X}")),
        }
    }

    encoded
}

#[cfg(test)]
mod tests {
    use super::{
        QODER_KEYS, QODER_MODEL_ALIASES, QODER_PROVIDER, QoderEndpoints, resolve_model_key,
    };

    /// Raw model keys upstream was observed serving. This is a test fixture, not
    /// an advertisement: the catalog takes its list from `model/list` alone.
    /// Provenance: the raw-key rows of `packages/constants/src/providers/qoder.ts`.
    const UPSTREAM_KEYS: &[&str] = &[
        "auto",
        "ultimate",
        "performance",
        "efficient",
        "lite",
        "qmodel",
        "qmodel_latest",
        "qmodel_38max",
        "qmodel_preview",
        "qfmodel",
        "dmodel",
        "dfmodel",
        "gm51model",
        "gmodel",
        "kmodel",
        "kmodel_latest",
        "mmodel",
    ];

    #[test]
    fn resolves_aliases_case_insensitively_and_passes_keys_through() {
        assert_eq!(resolve_model_key("qwen3.7-max"), "qmodel_latest");
        assert_eq!(resolve_model_key(" GLM-5.2 "), "gm51model");
        assert_eq!(resolve_model_key("qmodel_latest"), "qmodel_latest");
        assert_eq!(resolve_model_key("unknown-model"), "unknown-model");
    }

    #[test]
    fn every_alias_target_is_a_key_upstream_serves() {
        for &(alias, key) in QODER_MODEL_ALIASES {
            assert!(
                UPSTREAM_KEYS.contains(&key),
                "{alias} points at unknown key {key}"
            );
        }
    }

    #[test]
    fn the_alias_table_has_no_redundant_or_clashing_rows() {
        let mut seen_aliases = std::collections::HashSet::new();

        for &(alias, key) in QODER_MODEL_ALIASES {
            assert!(!alias.is_empty() && !key.is_empty(), "{alias}");
            assert_ne!(alias, key, "{alias} resolves to itself");
            assert_eq!(alias, alias.to_lowercase(), "{alias} must be lowercase");
            assert!(seen_aliases.insert(alias), "duplicate alias {alias}");
        }
    }

    #[test]
    fn provider_metadata_matches_the_registered_keys() {
        assert_eq!(QODER_PROVIDER.alias, "qd");
        assert!(QODER_KEYS.contains(&QODER_PROVIDER.id));
        assert!(QODER_KEYS.contains(&QODER_PROVIDER.alias));
    }

    #[test]
    fn endpoint_urls_keep_the_algo_prefix_and_query() {
        let endpoints = QoderEndpoints::default();

        assert_eq!(
            endpoints.chat_url(),
            "https://api3.qoder.sh/algo/api/v2/service/pro/sse/agent_chat_generation?FetchKeys=llm_model_result&AgentId=agent_common&Encode=1"
        );
        assert_eq!(
            endpoints.model_list_url(),
            "https://api3.qoder.sh/algo/api/v2/model/list"
        );
        assert!(
            endpoints
                .device_poll_query("state", "verifier")
                .starts_with("?nonce=state&verifier=verifier&challenge_method=S256")
        );
    }

    #[test]
    fn authorize_url_carries_pkce_challenge_and_nonce() {
        let url = QoderEndpoints::default().authorize_url("a+b/c=", "machine", "state-1");

        assert!(url.starts_with("https://qoder.com/device/selectAccounts?"));
        assert!(url.contains("challenge=a%2Bb%2Fc%3D"));
        assert!(url.contains("challenge_method=S256"));
        assert!(url.contains("machine_id=machine"));
        assert!(url.contains("nonce=state-1"));
    }
}
