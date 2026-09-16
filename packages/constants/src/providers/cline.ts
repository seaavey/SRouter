import type { ProviderMetadata } from "./types.js";

export const CLINE_BASE_URL = "https://api.cline.bot/api/v1";

export const CLINE_PROVIDER: ProviderMetadata = {
    id: "cline",
    name: "Cline",
    category: "api_key",
    protocol: "openai",
    base_url: CLINE_BASE_URL,
    web_url: "https://cline.bot",
    alias: "cline",
    requires_api_key: true,
    supports_custom_url: true,
    status_message: "Cline API key missing"
};