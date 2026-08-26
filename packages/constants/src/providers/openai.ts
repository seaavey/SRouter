import type { KnownProvider } from "./types.js";

export const OPENAI_BASE_URL = "https://api.openai.com/v1";
export const CODEX_BASE_URL = "https://chatgpt.com/backend-api/codex/responses";
export const CODEX_MODELS_URL = "https://chatgpt.com/backend-api/codex/models";

export const OPENAI_CODEX_PROVIDER: KnownProvider = {
    id: "openai_codex",
    name: "OpenAI Codex / ChatGPT",
    category: "oauth",
    protocol: "openai",
    alias: "openai",
    websiteUrl: "https://chatgpt.com",
    requiresApiKey: false,
    requiresOAuth: true,
    statusMessage: "OAuth token missing"
};
