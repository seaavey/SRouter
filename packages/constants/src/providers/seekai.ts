import type { KnownProvider } from "./types.js";

export const SEEKAI_BASE_URL = "https://seekai.cc/v1";

export const SEEKAI_PROVIDER: KnownProvider = {
    id: "seekai",
    name: "SeekAI",
    category: "api_key",
    protocol: "openai",
    baseUrl: SEEKAI_BASE_URL,
    websiteUrl: "https://seekai.cc/sign-up?aff=UU0C",
    requiresApiKey: true,
    supportsCustomUrl: true,
    statusMessage: "SeekAI API key missing"
};
