import type { ProviderMetadata } from "./types.js";

export const EXPERIENTIALLABS_BASE_URL = "https://api.experientiallabs.ai/v1";

export const EXPERIENTIALLABS_PROVIDER: ProviderMetadata = {
    id: "experientiallabs",
    name: "Experiential Labs",
    category: "api_key",
    protocol: "openai",
    base_url: EXPERIENTIALLABS_BASE_URL,
    web_url: "https://platform.experientiallabs.ai",
    alias: "explabs",
    requires_api_key: true,
    supports_custom_url: true,
    status_message: "Experiential Labs API key missing"
};
