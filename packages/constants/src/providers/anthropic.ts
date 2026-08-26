import type { ProviderMetadata } from "./types.js";

export const ANTHROPIC_BASE_URL = "https://api.anthropic.com/v1";

export const ANTHROPIC_PROVIDER: ProviderMetadata = {
    id: "anthropic",
    name: "Anthropic Claude",
    category: "oauth",
    protocol: "anthropic",
    alias: "claude",
    web_url: "https://claude.ai",
    requires_api_key: false,
    requires_oauth: true,
    status_message: "OAuth token missing"
};
