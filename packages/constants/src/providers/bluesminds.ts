import type { ProviderMetadata } from "./types.js";

export const BLUESMINDS_BASE_URL = "https://api.bluesminds.com/v1";

export const BLUESMINDS_PROVIDER: ProviderMetadata = {
    id: "bluesminds",
    name: "BluesMinds",
    category: "api_key",
    protocol: "openai",
    base_url: BLUESMINDS_BASE_URL,
    web_url: "https://api.bluesminds.com/sign-up?aff=nCAw",
    requires_api_key: true,
    supports_custom_url: true,
    status_message: "BluesMinds API key missing"
};
