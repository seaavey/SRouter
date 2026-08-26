import type { ProviderMetadata } from "./types.js";

export const TABITOKEN_BASE_URL = "https://tabitoken.com/v1";

export const TABITOKEN_PROVIDER: ProviderMetadata = {
    id: "tabitoken",
    name: "TabiToken",
    category: "api_key",
    protocol: "openai",
    base_url: TABITOKEN_BASE_URL,
    web_url: "https://tabitoken.com/sign-up?aff=h5iN",
    requires_api_key: true,
    supports_custom_url: true,
    status_message: "TabiToken API key missing"
};
