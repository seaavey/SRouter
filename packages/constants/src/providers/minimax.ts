import type { ProviderMetadata } from "./types.js";

export const MINIMAX_BASE_URL = "https://api.minimax.io/v1";

export const MINIMAX_PROVIDER: ProviderMetadata = {
    id: "minimax",
    name: "MiniMax",
    category: "api_key",
    protocol: "openai",
    base_url: MINIMAX_BASE_URL,
    web_url: "https://platform.minimax.io",
    requires_api_key: true,
    supports_custom_url: true,
    status_message: "MiniMax API key missing"
};
