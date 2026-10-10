//! Grok Web provider types, constants, endpoint set, and static metadata.
//!
//! Provenance for every constant here (independent of `packages/*`):
//! - live probes against grok.com on 2026-10-01 with a real SSO session:
//!   `GET /` with a valid `sso` cookie issues the `x-userid` cookie the
//!   WebSocket query string requires, an invalid cookie lands on a 307 to
//!   `accounts.x.ai` with no `x-userid`, `wss://grok.com/ws/mgw/?uid=<x-userid>`
//!   accepts `session.create` with only the `sso`/`sso-rw`/`x-userid` cookies,
//!   and an invalid cookie fails the WebSocket handshake with HTTP 401.
//! - model menu captured from the composer selector on grok.com: Fast, Build,
//!   Auto, Expert, Heavy; `fast` and `auto` answered end-to-end on a free
//!   account, `expert`/`build`/`heavy` returned `response.done` with
//!   `status_details.reason = "stream_error"` (account tier gate).
//! - reference implementation read for context only (not a source of truth):
//!   `decolua/9router` `open-sse/executors/grok-web.js` speaks the older REST
//!   transport, which grok.com now rejects without the browser `botoxSign`
//!   signature; this provider speaks the WebSocket the real web client uses.

use crate::features::providers::model::{ModelDefinition, ProviderMetadata, ProviderProtocol};

/// Page whose `GET` response issues the `x-userid` cookie. Also the cookie
/// probe used by the connect route: a valid session returns `200` plus the
/// cookie, an invalid one redirects to `accounts.x.ai`.
pub const GROK_WEB_PAGE_URL: &str = "https://grok.com/";
/// Realtime chat endpoint: WebSocket, `?uid=` must equal the `x-userid` cookie.
pub const GROK_WEB_WS_URL: &str = "wss://grok.com/ws/mgw/";

/// The browser user agent the WebSocket handshake is sent with; grok.com is
/// served behind a bot check that an SDK user agent would stand out against.
pub const GROK_WEB_USER_AGENT: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) \
     AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

/// Registry lookup keys: the base id is the user-facing alias, so a model
/// advertises as `grok-web/<session model>`.
pub const GROK_WEB_KEYS: &[&str] = &["grok-web"];

/// Models advertised by the composer menu. The id is the exact `session.model`
/// value the WebSocket protocol accepts; there is no second mapping table.
/// The advertised ids are also the WS ids, so `grok-web/fast` reaches the
/// upstream unchanged.
pub const GROK_WEB_MODELS: &[ModelDefinition] = &[
    ModelDefinition {
        id: "fast",
        name: "Grok Fast",
    },
    ModelDefinition {
        id: "build",
        name: "Grok Build",
    },
    ModelDefinition {
        id: "auto",
        name: "Grok Auto",
    },
    ModelDefinition {
        id: "expert",
        name: "Grok Expert",
    },
    ModelDefinition {
        id: "heavy",
        name: "Grok Heavy",
    },
];

pub const GROK_WEB_PROVIDER: ProviderMetadata = ProviderMetadata {
    id: "grok-web",
    name: "Grok Web (Subscription)",
    category: "api_key",
    protocol: ProviderProtocol::OpenAI,
    base_url: GROK_WEB_WS_URL,
    web_url: "https://grok.com",
    alias: "grok-web",
    requires_api_key: true,
    requires_oauth: false,
    supports_custom_url: false,
    status_message: "Grok Web account not connected",
};

/// Hosts the page probe and the WebSocket live under one origin in
/// production; tests inject the fake upstream through `adapter_with_endpoints`.
#[derive(Debug, Clone)]
pub struct GrokWebEndpoints {
    pub page_url: String,
    pub ws_url: String,
}

impl Default for GrokWebEndpoints {
    fn default() -> Self {
        Self {
            page_url: GROK_WEB_PAGE_URL.to_owned(),
            ws_url: GROK_WEB_WS_URL.to_owned(),
        }
    }
}

/// The `session.x_grok` capability block the web client sends with
/// `session.create`, captured verbatim from the live client.
pub fn session_capabilities() -> serde_json::Value {
    serde_json::json!({
        "protocol_capabilities": [
            "conversation_attached",
            "custom_methods_v1",
            "workspace_servers_v1"
        ],
        "use_chunk": true,
        "accept_interleaved_phases": true,
        "client_side_toolsets": ["connectors-v3"],
        "enable_side_by_side": true,
        "force_side_by_side": false,
        "enable_image_generation": false,
        "image_generation_count": 0,
        "disable_text_follow_ups": false,
        "disable_artifact": true,
        "force_concise": false
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_advertised_model_is_a_ws_session_model() {
        let ids: Vec<&str> = GROK_WEB_MODELS.iter().map(|model| model.id).collect();
        assert_eq!(ids, ["fast", "build", "auto", "expert", "heavy"]);
    }

    #[test]
    fn the_ws_url_carries_no_query_string_of_its_own() {
        // The executor appends `?uid=` itself; a baked-in query would double up.
        assert!(!GROK_WEB_WS_URL.contains('?'));
        assert!(GROK_WEB_WS_URL.starts_with("wss://"));
    }

    #[test]
    fn provider_metadata_points_at_grok() {
        assert_eq!(GROK_WEB_PROVIDER.id, "grok-web");
        const { assert!(GROK_WEB_PROVIDER.requires_api_key) };
        const { assert!(!GROK_WEB_PROVIDER.supports_custom_url) };
    }

    #[test]
    fn session_capabilities_disable_image_generation() {
        let capabilities = session_capabilities();
        assert_eq!(capabilities["enable_image_generation"], false);
        assert_eq!(capabilities["use_chunk"], true);
    }
}
