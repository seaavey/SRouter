import type { KnownProvider } from "./types.js";

export const ANTHROPIC_BASE_URL = "https://api.anthropic.com/v1";

export const ANTHROPIC_PROVIDER: KnownProvider = {
    id: "anthropic",
    name: "Anthropic Claude",
    category: "oauth",
    protocol: "anthropic",
    alias: "claude",
    websiteUrl: "https://claude.ai",
    requiresApiKey: false,
    requiresOAuth: true,
    statusMessage: "OAuth token missing"
};
