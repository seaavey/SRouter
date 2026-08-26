import type { ProviderMetadata } from "./types.js";

export const SEEKAI_BASE_URL = "https://seekai.cc/v1";

export const SEEKAI_PROVIDER: ProviderMetadata = {
    id: "seekai",
    name: "SeekAI",
    category: "api_key",
    protocol: "openai",
    base_url: SEEKAI_BASE_URL,
    web_url: "https://seekai.cc/sign-up?aff=UU0C",
    requires_api_key: true,
    supports_custom_url: true,
    status_message: "SeekAI API key missing"
};
