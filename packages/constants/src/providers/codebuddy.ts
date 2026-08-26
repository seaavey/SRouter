import type { ProviderMetadata } from "./types.js";

export const CODEBUDDY_BASE_URL = "https://www.codebuddy.ai/v2/chat/completions";
export const CODEBUDDY_AUTH_BASE = "https://www.codebuddy.ai";
export const CODEBUDDY_AUTH_STATE_URL = "https://www.codebuddy.ai/v2/plugin/auth/state";
export const CODEBUDDY_AUTH_TOKEN_URL = "https://www.codebuddy.ai/v2/plugin/auth/token";
export const CODEBUDDY_AUTH_REFRESH_URL = "https://www.codebuddy.ai/v2/plugin/auth/token/refresh";
export const CODEBUDDY_CN_BASE_URL = "https://copilot.tencent.com/v2/chat/completions";
export const CODEBUDDY_CN_AUTH_BASE = "https://copilot.tencent.com";
export const CODEBUDDY_CN_AUTH_STATE_URL = "https://copilot.tencent.com/v2/plugin/auth/state";
export const CODEBUDDY_CN_AUTH_TOKEN_URL = "https://copilot.tencent.com/v2/plugin/auth/token";
export const CODEBUDDY_CN_AUTH_REFRESH_URL =
    "https://copilot.tencent.com/v2/plugin/auth/token/refresh";
export const CODEBUDDY_CN_ORIGIN = "https://www.codebuddy.cn";
export const CODEBUDDY_CN_DOMAIN = "www.codebuddy.cn";
export const CODEBUDDY_CN_USER_AGENT = "CLI/2.96.0 CodeBuddy/2.96.0";
export const CODEBUDDY_AUTH_USER_AGENT = "IDE/2.63.2 CodeBuddy/2.63.2";
export const CODEBUDDY_AUTH_PLATFORM = "ide";

export interface CodeBuddyModelDefinition {
    id: string;
    name: string;
}

export const CODEBUDDY_MODELS: CodeBuddyModelDefinition[] = [
    { id: "default-model", name: "Default (CodeBuddy)" },
    { id: "default-model-lite", name: "Default-Lite" },
    { id: "gpt-5.5", name: "GPT-5.5" },
    { id: "gpt-5.4", name: "GPT-5.4" },
    { id: "gpt-5.3-codex", name: "GPT-5.3-Codex" },
    { id: "gpt-5.1-codex", name: "GPT-5.1-Codex" },
    { id: "gpt-5.1-codex-mini", name: "GPT-5.1-Codex-Mini" },
    { id: "gemini-3.1-pro", name: "Gemini 3.1 Pro" },
    { id: "gemini-3.5-flash", name: "Gemini 3.5 Flash" },
    { id: "gemini-3.0-flash", name: "Gemini 3.0 Flash" },
    { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
    { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
    { id: "gemini-3.1-flash-lite", name: "Gemini 3.1 Flash Lite" },
    { id: "deepseek-v3", name: "DeepSeek-V3" },
    { id: "deepseek-v3-2-volc", name: "DeepSeek-V3.2" },
    { id: "deepseek-v4-pro", name: "DeepSeek-V4-Pro" },
    { id: "deepseek-v4-flash", name: "DeepSeek-V4-Flash" },
    { id: "glm-5.3", name: "GLM-5.3" },
    { id: "glm-5.2", name: "GLM-5.2" },
    { id: "glm-5.1", name: "GLM-5.1" },
    { id: "glm-5.0", name: "GLM-5.0" },
    { id: "glm-5.0-turbo", name: "GLM-5.0-Turbo" },
    { id: "glm-5v-turbo", name: "GLM-5v-Turbo" },
    { id: "glm-4.7", name: "GLM-4.7" },
    { id: "minimax-m3", name: "MiniMax-M3" },
    { id: "minimax-m2.7", name: "MiniMax-M2.7" },
    { id: "kimi-k3", name: "Kimi-K3" },
    { id: "kimi-k2.7", name: "Kimi-K2.7-Code" },
    { id: "kimi-k2.6", name: "Kimi-K2.6" },
    { id: "kimi-k2.5", name: "Kimi-K2.5" },
    { id: "hy3-preview", name: "Hy3 Preview" }
];

export const CODEBUDDY_MODEL_IDS: string[] = CODEBUDDY_MODELS.map((m) => m.id);

export const CODEBUDDY_PROVIDER: ProviderMetadata = {
    id: "codebuddy",
    name: "CodeBuddy",
    category: "oauth",
    protocol: "openai",
    alias: "codebuddy",
    base_url: CODEBUDDY_BASE_URL,
    web_url: "https://www.codebuddy.ai",
    requires_api_key: false,
    requires_oauth: true,
    supports_custom_url: true,
    status_message: "CodeBuddy OAuth token missing"
};

export const CODEBUDDY_CN_PROVIDER: ProviderMetadata = {
    id: "codebuddy-cn",
    name: "CodeBuddy CN",
    category: "oauth",
    protocol: "openai",
    alias: "codebuddy-cn",
    base_url: CODEBUDDY_CN_BASE_URL,
    web_url: "https://www.codebuddy.cn",
    requires_api_key: false,
    requires_oauth: true,
    supports_custom_url: true,
    status_message: "CodeBuddy CN OAuth token missing"
};
