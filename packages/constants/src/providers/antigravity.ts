import type { ProviderMetadata } from "./types.js";

export const ANTIGRAVITY_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai";
export const ANTIGRAVITY_IDE_BASE_URL = "https://daily-cloudcode-pa.googleapis.com";

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
