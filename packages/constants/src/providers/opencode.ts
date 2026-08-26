import type { KnownProvider } from "./types.js";

export const OPENCODE_ZEN_BASE_URL = "https://opencode.ai/zen/v1";

export interface OpenCodeZenModelDefinition {
    id: string;
    name: string;
}

export const OPENCODE_ZEN_MODELS: OpenCodeZenModelDefinition[] = [
    { id: "x-preview-f-free", name: "Ox Alpha Free (Unlimited)" },
    { id: "big-pickle", name: "Big Pickle (Free)" },
    { id: "laguna-s-2.1-free", name: "Poolside Laguna S 2.1 (Free)" },
    { id: "nemotron-3.5-lightning-free", name: "Nemotron 3.5 Lightning (Free)" },
    { id: "nemotron-3-ultra-free", name: "Nemotron 3 Ultra (Free)" },
    { id: "mimo-v2.5-free", name: "Xiaomi MiMo V2.5 (Free)" }
];

export const OPENCODE_ZEN_MODEL_IDS: string[] = OPENCODE_ZEN_MODELS.map((m) => m.id);

export const OPENCODE_ZEN_PROVIDER: KnownProvider = {
    id: "opencode_zen",
    name: "OpenCode Zen",
    category: "free_tier",
    protocol: "openai",
    alias: "zen",
    baseUrl: OPENCODE_ZEN_BASE_URL,
    websiteUrl: "https://opencode.ai/zen",
    requiresApiKey: false,
    requiresOAuth: false,
    supportsCustomUrl: true,
    statusMessage: "Free Tier Ready (Unlimited)"
};
