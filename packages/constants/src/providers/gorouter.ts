import type { KnownProvider } from "./types.js";

export const GOROUTER_BASE_URL = "https://gorouter.app/v1";

export const GOROUTER_PROVIDER: KnownProvider = {
    id: "gorouter",
    name: "GoRouter",
    category: "api_key",
    protocol: "openai",
    base_url: GOROUTER_BASE_URL,
    web_url: "https://gorouter.app/sign-up?aff=cJJn",
    requires_api_key: true,
    supports_custom_url: true,
    status_message: "GoRouter API key missing"
};
