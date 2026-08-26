import type { KnownProvider } from "./types.js";

export const NEOSANTARA_BASE_URL = "https://api.neosantara.xyz/v1";

export const NEOSANTARA_PROVIDER: KnownProvider = {
    id: "neosantara",
    name: "Neosantara",
    category: "api_key",
    protocol: "openai",
    baseUrl: NEOSANTARA_BASE_URL,
    websiteUrl: "https://neosantara.xyz",
    requiresApiKey: true,
    supportsCustomUrl: true,
    statusMessage: "Neosantara API key missing"
};
