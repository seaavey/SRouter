import type { ProviderMetadata } from "./types.js";

export const ANTIGRAVITY_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai";
export const ANTIGRAVITY_IDE_BASE_URL = "https://daily-cloudcode-pa.googleapis.com";

export const ANTIGRAVITY_OAUTH_CLIENT_ID =
    "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com";
export const ANTIGRAVITY_OAUTH_CLIENT_SECRET = "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";
export const ANTIGRAVITY_OAUTH_REDIRECT_URI = "http://localhost:1455/auth/antigravity/callback";
export const ANTIGRAVITY_OAUTH_SCOPE =
    "openid profile email https://www.googleapis.com/auth/cloud-platform";
export const ANTIGRAVITY_OAUTH_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const ANTIGRAVITY_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const ANTIGRAVITY_OAUTH_PROMPT = "consent";

export interface AntigravityModelDefinition {
    id: string;
    name: string;
}

export const ANTIGRAVITY_MODELS: AntigravityModelDefinition[] = [
    { id: "gemini-3.7-flash-high", name: "Gemini 3.7 Flash (High)" },
    { id: "gemini-3.7-flash-medium", name: "Gemini 3.7 Flash (Medium)" },
    { id: "gemini-3.7-flash-low", name: "Gemini 3.7 Flash (Low)" },
    { id: "gemini-3.6-flash-high", name: "Gemini 3.6 Flash (High)" },
    { id: "gemini-3.6-flash-medium", name: "Gemini 3.6 Flash (Medium)" },
    { id: "gemini-3.6-flash-low", name: "Gemini 3.6 Flash (Low)" },
    { id: "gemini-3.5-flash-high", name: "Gemini 3.5 Flash (High)" },
    { id: "gemini-3.5-flash-medium", name: "Gemini 3.5 Flash (Medium)" },
    { id: "gemini-3.5-flash-low", name: "Gemini 3.5 Flash (Low)" },
    { id: "gemini-3.1-pro-high", name: "Gemini 3.1 Pro (High)" },
    { id: "gemini-3.1-pro-low", name: "Gemini 3.1 Pro (Low)" },
    { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6 (Thinking)" },
    { id: "claude-opus-4-6-thinking", name: "Claude Opus 4.6 (Thinking)" },
    { id: "gpt-oss-120b-medium", name: "GPT-OSS 120B (Medium)" }
];

export const ANTIGRAVITY_MODEL_IDS: string[] = ANTIGRAVITY_MODELS.map((m) => m.id);

export const ANTIGRAVITY_PROVIDER: ProviderMetadata = {
    id: "antigravity",
    name: "Google Antigravity",
    category: "oauth",
    protocol: "openai",
    base_url: ANTIGRAVITY_IDE_BASE_URL,
    web_url: "https://ai.google.dev",
    requires_api_key: false,
    requires_oauth: true,
    status_message: "Antigravity OAuth token missing"
};
