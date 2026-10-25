//! Command Code provider types, endpoints, and the static provider metadata.
//!
//! The wire is the one the official CLI speaks (`POST /alpha/generate`), not the
//! documented OpenAI-compatible Provider API under `/provider/v1`: a key from the
//! CLI or studio sign-in is valid only against the former. Oracle: the Hermes
//! `commandcode-oauth` plugin (`transport.py`), whose author verified the shapes
//! against a real account on 2026-10-08.

use crate::features::providers::model::{ProviderMetadata, ProviderProtocol};

/// API origin. Every route below hangs off it; the studio lives elsewhere.
pub const COMMANDCODE_ORIGIN: &str = "https://api.commandcode.ai";
/// The NDJSON generation endpoint this driver exists for.
pub const COMMANDCODE_GENERATE_URL: &str = "https://api.commandcode.ai/alpha/generate";
/// The public model catalog, which accepts the same CLI key.
pub const COMMANDCODE_MODELS_URL: &str = "https://api.commandcode.ai/provider/v1/models";
/// Key validation and the account label.
pub const COMMANDCODE_WHOAMI_URL: &str = "https://api.commandcode.ai/alpha/whoami";
/// The marketing site, and the studio page the operator signs in through.
pub const COMMANDCODE_STUDIO_ORIGIN: &str = "https://commandcode.ai";
pub const COMMANDCODE_STUDIO_AUTH_URL: &str = "https://commandcode.ai/studio/auth/cli";
/// The public callback the studio page posts the key to. CORS reads the same
/// string, because that one route reflects the studio origin by itself.
pub const COMMANDCODE_CALLBACK_PATH: &str = "/auth/commandcode/callback";
/// The relay script the operator runs on their own machine, served publicly:
/// the browser fetches it, and it carries nothing secret.
pub const COMMANDCODE_RELAY_PATH: &str = "/auth/commandcode/relay.mjs";
/// The CLI wire version the relay reads for capability gating. It is a vendor
/// version, not ours: it may need bumping without any change on this side.
pub const COMMANDCODE_CLI_VERSION: &str = "0.52.1";

/// Registry lookup keys. The base id is also the user-facing alias, so a model
/// advertises as `commandcode/<vendor>/<model>`.
pub const COMMANDCODE_KEYS: &[&str] = &["commandcode"];

pub const COMMANDCODE_PROVIDER: ProviderMetadata = ProviderMetadata {
    id: "commandcode",
    name: "Command Code",
    category: "oauth",
    protocol: ProviderProtocol::OpenAI,
    base_url: COMMANDCODE_GENERATE_URL,
    web_url: COMMANDCODE_STUDIO_ORIGIN,
    alias: "commandcode",
    requires_api_key: false,
    requires_oauth: true,
    supports_custom_url: true,
    status_message: "Command Code account not connected",
};

/// The endpoints one process talks to. Production defaults are the constants
/// above; tests inject a fake upstream through `adapter_with_endpoints`.
#[derive(Debug, Clone)]
pub struct CommandCodeEndpoints {
    pub generate_url: String,
    pub models_url: String,
    pub whoami_url: String,
}

impl Default for CommandCodeEndpoints {
    fn default() -> Self {
        Self {
            generate_url: COMMANDCODE_GENERATE_URL.to_owned(),
            models_url: COMMANDCODE_MODELS_URL.to_owned(),
            whoami_url: COMMANDCODE_WHOAMI_URL.to_owned(),
        }
    }
}

impl CommandCodeEndpoints {
    /// Every endpoint rehosted on one origin, which is how a test points the
    /// driver at its fake upstream.
    pub fn on_origin(origin: &str) -> Self {
        let origin = origin.trim_end_matches('/');

        Self {
            generate_url: format!("{origin}/alpha/generate"),
            models_url: format!("{origin}/provider/v1/models"),
            whoami_url: format!("{origin}/alpha/whoami"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_seed_metadata_carries_the_alias_and_the_cli_endpoint() {
        assert_eq!(COMMANDCODE_PROVIDER.id, "commandcode");
        assert_eq!(COMMANDCODE_PROVIDER.alias, "commandcode");
        assert_eq!(COMMANDCODE_PROVIDER.base_url, COMMANDCODE_GENERATE_URL);
        // The category is what puts the provider behind the browser sign-in in
        // the dashboard, so it is the flag pair that matters.
        assert_eq!(COMMANDCODE_PROVIDER.category, "oauth");
        assert_eq!(COMMANDCODE_KEYS, &["commandcode"]);
    }

    #[test]
    fn the_default_endpoints_are_the_production_routes() {
        let endpoints = CommandCodeEndpoints::default();

        assert_eq!(endpoints.generate_url, COMMANDCODE_GENERATE_URL);
        assert_eq!(endpoints.models_url, COMMANDCODE_MODELS_URL);
        assert_eq!(endpoints.whoami_url, COMMANDCODE_WHOAMI_URL);
    }

    #[test]
    fn a_rehosted_origin_keeps_every_path() {
        let endpoints = CommandCodeEndpoints::on_origin("http://127.0.0.1:8080/");

        assert_eq!(
            endpoints.generate_url,
            "http://127.0.0.1:8080/alpha/generate"
        );
        assert_eq!(
            endpoints.models_url,
            "http://127.0.0.1:8080/provider/v1/models"
        );
        assert_eq!(endpoints.whoami_url, "http://127.0.0.1:8080/alpha/whoami");
    }
}
