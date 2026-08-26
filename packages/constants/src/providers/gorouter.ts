import type { KnownProvider } from "./types.js";

export const GOROUTER_BASE_URL = "https://gorouter.app/v1";

export const GOROUTER_PROVIDER: KnownProvider = {
    id: "gorouter",
    name: "GoRouter",
    category: "api_key",
    protocol: "openai",
    baseUrl: GOROUTER_BASE_URL,
    websiteUrl: "https://gorouter.app/sign-up?aff=cJJn",
    requiresApiKey: true,
    supportsCustomUrl: true,
    statusMessage: "GoRouter API key missing"
};
