import type { KnownProvider } from "./types.js";

export const NEOSANTARA_BASE_URL = "https://api.neosantara.xyz/v1";

export const NEOSANTARA_PROVIDER: KnownProvider = {
    id: "neosantara",
    name: "Neosantara",
    category: "api_key",
    protocol: "openai",
    base_url: NEOSANTARA_BASE_URL,
    web_url: "https://neosantara.xyz",
    requires_api_key: true,
    supports_custom_url: true,
    status_message: "Neosantara API key missing"
};
