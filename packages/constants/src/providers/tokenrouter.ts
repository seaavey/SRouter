import type { KnownProvider } from "./types.js";

export const TOKENROUTER_BASE_URL = "https://api.tokenrouter.com/v1";

export const TOKENROUTER_PROVIDER: KnownProvider = {
    id: "tokenrouter",
    name: "TokenRouter",
    category: "api_key",
    protocol: "openai",
    base_url: TOKENROUTER_BASE_URL,
    web_url: "https://tokenrouter.com",
    requires_api_key: true,
    supports_custom_url: true,
    status_message: "TokenRouter API key missing"
};
