import type { ProviderMetadata } from "./types.js";

export const ANTHROPIC_BASE_URL = "https://api.anthropic.com/v1";

export const CLAUDE_OAUTH_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
export const CLAUDE_OAUTH_REDIRECT_URI = "http://localhost:1455/auth/claude/callback";
export const CLAUDE_OAUTH_SCOPE = "org:create_api_key user:profile user:inference";
export const CLAUDE_OAUTH_AUTHORIZE_URL = "https://claude.ai/oauth/authorize";
export const CLAUDE_OAUTH_TOKEN_URL = "https://api.anthropic.com/v1/oauth/token";

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
