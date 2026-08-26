import type { KnownProvider } from "./types.js";

export const TABITOKEN_BASE_URL = "https://tabitoken.com/v1";

export const TABITOKEN_PROVIDER: KnownProvider = {
    id: "tabitoken",
    name: "TabiToken",
    category: "api_key",
    protocol: "openai",
    baseUrl: TABITOKEN_BASE_URL,
    websiteUrl: "https://tabitoken.com/sign-up?aff=h5iN",
    requiresApiKey: true,
    supportsCustomUrl: true,
    statusMessage: "TabiToken API key missing"
};
