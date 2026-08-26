import type { KnownProvider } from "./types.js";

export const TOKENROUTER_BASE_URL = "https://api.tokenrouter.com/v1";

export const TOKENROUTER_PROVIDER: KnownProvider = {
    id: "tokenrouter",
    name: "TokenRouter",
    category: "api_key",
    protocol: "openai",
    baseUrl: TOKENROUTER_BASE_URL,
    websiteUrl: "https://tokenrouter.com",
    requiresApiKey: true,
    supportsCustomUrl: true,
    statusMessage: "TokenRouter API key missing"
};
