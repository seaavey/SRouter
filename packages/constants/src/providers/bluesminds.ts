import type { KnownProvider } from "./types.js";

export const BLUESMINDS_BASE_URL = "https://api.bluesminds.com/v1";

export const BLUESMINDS_PROVIDER: KnownProvider = {
    id: "bluesminds",
    name: "BluesMinds",
    category: "api_key",
    protocol: "openai",
    baseUrl: BLUESMINDS_BASE_URL,
    websiteUrl: "https://api.bluesminds.com/sign-up?aff=nCAw",
    requiresApiKey: true,
    supportsCustomUrl: true,
    statusMessage: "BluesMinds API key missing"
};
