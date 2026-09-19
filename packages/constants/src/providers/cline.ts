import type { ProviderMetadata } from "./types.js";

export const CLINE_BASE_URL = "https://api.cline.bot/api/v1";
export const CLINE_API_ROOT = "https://api.cline.bot";
export const CLINE_WORKOS_BASE_URL = "https://api.workos.com";
export const CLINE_WORKOS_CLIENT_ID = "client_01K3A541FN8TA3EPPHTD2325AR";

export const CLINE_PROVIDER: ProviderMetadata = {
    id: "cline",
    name: "Cline",
    category: "oauth",
    protocol: "openai",
    base_url: CLINE_BASE_URL,
    web_url: "https://cline.bot",
    alias: "cline",
    requires_api_key: false,
    requires_oauth: true,
    supports_custom_url: true,
    status_message: "Cline OAuth account missing"
};
