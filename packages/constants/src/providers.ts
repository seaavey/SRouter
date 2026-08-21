import type { ProviderCategory, ProviderProtocol } from "@srouter/types";

// ─── Provider base URLs ───

export const OPENAI_BASE_URL = "https://api.openai.com/v1";
export const ANTHROPIC_BASE_URL = "https://api.anthropic.com/v1";
export const NEOSANTARA_BASE_URL = "https://api.neosantara.xyz/v1";
export const GOROUTER_BASE_URL = "https://gorouter.app/v1";
export const BLUESMINDS_BASE_URL = "https://api.bluesminds.com/v1";
export const SEEKAI_BASE_URL = "https://seekai.cc/v1";
export const TABITOKEN_BASE_URL = "https://tabitoken.com/v1";
export const TOKENROUTER_BASE_URL = "https://api.tokenrouter.com/v1";
export const COMMANDCODE_BASE_URL = "https://api.commandcode.ai/alpha/generate";
export const COMMANDCODE_MODELS_URL = "https://api.commandcode.ai/provider/v1/models";
export const CODEX_BASE_URL = "https://chatgpt.com/backend-api/codex/responses";
export const CODEX_MODELS_URL = "https://chatgpt.com/backend-api/codex/models";
export const ANTIGRAVITY_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai";
export const ANTIGRAVITY_IDE_BASE_URL = "https://daily-cloudcode-pa.googleapis.com";
export const CODEBUDDY_BASE_URL = "https://www.codebuddy.ai/v2/chat/completions";
export const CODEBUDDY_AUTH_BASE = "https://www.codebuddy.ai";
export const CODEBUDDY_AUTH_STATE_URL = "https://www.codebuddy.ai/v2/plugin/auth/state";
export const CODEBUDDY_AUTH_TOKEN_URL = "https://www.codebuddy.ai/v2/plugin/auth/token";
export const CODEBUDDY_AUTH_REFRESH_URL = "https://www.codebuddy.ai/v2/plugin/auth/token/refresh";
export const CODEBUDDY_AUTH_USER_AGENT = "IDE/2.63.2 CodeBuddy/2.63.2";
export const CODEBUDDY_AUTH_PLATFORM = "ide";

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
    { id: "glm-5.2", name: "GLM-5.2" },
    { id: "glm-5.1", name: "GLM-5.1" },
    { id: "glm-5.0", name: "GLM-5.0" },
    { id: "glm-5.0-turbo", name: "GLM-5.0-Turbo" },
    { id: "glm-5v-turbo", name: "GLM-5v-Turbo" },
    { id: "glm-4.7", name: "GLM-4.7" },
    { id: "minimax-m3", name: "MiniMax-M3" },
    { id: "minimax-m2.7", name: "MiniMax-M2.7" },
    { id: "kimi-k2.7", name: "Kimi-K2.7-Code" },
    { id: "kimi-k2.6", name: "Kimi-K2.6" },
    { id: "kimi-k2.5", name: "Kimi-K2.5" },
    { id: "hy3-preview", name: "Hy3 Preview" }
];

export const CODEBUDDY_MODEL_IDS: string[] = CODEBUDDY_MODELS.map((m) => m.id);

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

export interface QoderModelDefinition {
    id: string;
    name: string;
    level?: string;
}

export const QODER_MODELS: QoderModelDefinition[] = [
    { id: "qwen3.8-max-preview", name: "Qwen 3.8 Max Preview", level: "qmodel_preview" },
    { id: "qwen3.7-max", name: "Qwen 3.7 Max", level: "qmodel_latest" },
    { id: "qwen3.7-plus", name: "Qwen 3.7 Plus", level: "qmodel" },
    { id: "kimi-k3", name: "Kimi K3", level: "kmodel_latest" },
    { id: "kimi-k2.7-code", name: "Kimi K2.7 Code", level: "kmodel" },
    { id: "glm-5.2", name: "GLM 5.2", level: "gm51model" },
    { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", level: "dmodel" },
    { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash", level: "dfmodel" },
    { id: "minimax-m3", name: "MiniMax M3", level: "mmodel" },
    { id: "ultimate", name: "Qoder Ultimate" },
    { id: "qmodel_38max", name: "Qwen 3.8 Max" },
    { id: "qmodel_preview", name: "Qwen Preview" },
    { id: "qmodel_latest", name: "Qwen Latest" },
    { id: "qmodel", name: "Qwen Standard" },
    { id: "auto", name: "Qoder Auto" },
    { id: "performance", name: "Qoder Performance" },
    { id: "efficient", name: "Qoder Efficient" },
    { id: "lite", name: "Qoder Lite" },
    { id: "kmodel_latest", name: "Kimi K3 (Raw)" },
    { id: "kmodel", name: "Kimi K2.7 (Raw)" },
    { id: "gmodel", name: "GLM (Raw)" },
    { id: "gm51model", name: "GLM 5.2 (Raw)" },
    { id: "dmodel", name: "DeepSeek Pro (Raw)" },
    { id: "dfmodel", name: "DeepSeek Flash (Raw)" },
    { id: "mmodel", name: "MiniMax (Raw)" }
];

export const QODER_MODEL_ALIASES: Record<string, string> = {
    "qwen3.8-max-preview": "qmodel_preview",
    "qwen-3.8-max-preview": "qmodel_preview",
    "qwen3.8-max": "qmodel_38max",
    "qwen-3.8-max": "qmodel_38max",
    "qwen3.7-max": "qmodel_latest",
    "qwen-3.7-max": "qmodel_latest",
    "qwen3.7-plus": "qmodel",
    "qwen-3.7-plus": "qmodel",
    "kimi-k3": "kmodel_latest",
    "kimi-k2.7-code": "kmodel",
    "glm-5.2": "gm51model",
    "deepseek-v4-pro": "dmodel",
    "deepseek-v4-flash": "dfmodel",
    "minimax-m3": "mmodel",
    ultimate: "ultimate",
    auto: "auto",
    performance: "performance",
    efficient: "efficient",
    lite: "lite"
};

export const QODER_MODEL_IDS: string[] = QODER_MODELS.map((m) => m.id);

export const QODER_OPENAPI_BASE = "https://openapi.qoder.sh";
export const QODER_CENTER_BASE = "https://center.qoder.sh";
export const QODER_CHAT_BASE = "https://api3.qoder.sh";
export const QODER_CHAT_BASE_ALT = "https://api2.qoder.sh";
export const QODER_LOGIN_URL = "https://qoder.com/device/selectAccounts";
export const QODER_DEVICE_TOKEN_URL = `${QODER_OPENAPI_BASE}/api/v1/deviceToken/poll`;
export const QODER_USERINFO_URL = `${QODER_OPENAPI_BASE}/api/v1/userinfo`;
export const QODER_QUOTA_USAGE_URL = `${QODER_OPENAPI_BASE}/api/v2/quota/usage`;
export const QODER_REFRESH_TOKEN_URL = `${QODER_CENTER_BASE}/algo/api/v3/user/refresh_token`;
export const QODER_JOB_TOKEN_EXCHANGE_URL = `${QODER_OPENAPI_BASE}/api/v1/jobToken/exchange`;
export const QODER_CHAT_SIG_PATH = "/api/v2/service/pro/sse/agent_chat_generation";
export const QODER_CHAT_URL = `${QODER_CHAT_BASE}/algo${QODER_CHAT_SIG_PATH}?FetchKeys=llm_model_result&AgentId=agent_common`;
export const QODER_CHAT_URL_ENCODED = `${QODER_CHAT_URL}&Encode=1`;
export const QODER_MODEL_LIST_URL = `${QODER_CHAT_BASE}/algo/api/v2/model/list`;

export const QODER_IDE_VERSION = "1.0.0";
export const QODER_CLIENT_TYPE = "5";
export const QODER_DATA_POLICY = "disagree";
export const QODER_LOGIN_VERSION = "v2";
export const QODER_MACHINE_OS = "x86_64_windows";
export const QODER_MACHINE_TYPE = "5";

export const QODER_RSA_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDA8iMH5c02LilrsERw9t6Pv5Nc
4k6Pz1EaDicBMpdpxKduSZu5OANqUq8er4GM95omAGIOPOh+Nx0spthYA2BqGz+l
6HRkPJ7S236FZz73In/KVuLnwI8JJ2CbuJap8kvheCCZpmAWpb/cPx/3Vr/J6I17
XcW+ML9FoCI6AOvOzwIDAQAB
-----END PUBLIC KEY-----`;

// ─── Provider category metadata ───
export const PROVIDER_CATEGORIES: ProviderCategory[] = ["custom", "oauth", "free_tier", "api_key"];

export const CATEGORY_ORDER: ProviderCategory[] = ["oauth", "api_key", "free_tier", "custom"];

export const CATEGORY_LABELS: Record<ProviderCategory, string> = {
    oauth: "OAuth Provider",
    api_key: "API Key Provider",
    free_tier: "Free Tier Provider",
    custom: "Custom Provider"
};

export const CATEGORY_DESCRIPTIONS: Record<ProviderCategory, string> = {
    oauth: "Signed in through a provider account rather than a key.",
    api_key: "Authenticated with a platform key you supply.",
    free_tier: "Free or rate-limited public endpoints.",
    custom: "Endpoints you registered on this gateway."
};

export function isProviderCategory(value: string): value is ProviderCategory {
    return PROVIDER_CATEGORIES.includes(value as ProviderCategory);
}

// ─── Known provider catalog ───

/**
 * Built-in providers known to the gateway. This is the single source of truth
 * for provider ids and metadata; `seed.ts` derives its seed rows from here and
 * other consumers (registry, quota, token refresh) look providers up via the
 * helpers below instead of hardcoding ids.
 */
export interface KnownProvider {
    id: string;
    name: string;
    category: ProviderCategory;
    protocol: ProviderProtocol;
    baseUrl?: string;
    websiteUrl?: string;
    /** Model-id prefix override (e.g. openai_codex → "openai"). Defaults to id. */
    alias?: string;
    requiresApiKey: boolean;
    requiresOAuth?: boolean;
    supportsCustomUrl?: boolean;
    /** Shown when the driver has no active connection yet. */
    statusMessage: string;
}

export const KNOWN_PROVIDERS: KnownProvider[] = [
    {
        id: "kiro",
        name: "Kiro",
        category: "api_key",
        protocol: "custom",
        websiteUrl: "https://aws.amazon.com/q/",
        requiresApiKey: true,
        supportsCustomUrl: true,
        statusMessage: "Kiro credential missing"
    },
    {
        id: "neosantara",
        name: "Neosantara",
        category: "api_key",
        protocol: "openai",
        baseUrl: NEOSANTARA_BASE_URL,
        websiteUrl: "https://neosantara.xyz",
        requiresApiKey: true,
        supportsCustomUrl: true,
        statusMessage: "Neosantara API key missing"
    },
    {
        id: "gorouter",
        name: "GoRouter",
        category: "api_key",
        protocol: "openai",
        baseUrl: GOROUTER_BASE_URL,
        websiteUrl: "https://gorouter.app/sign-up?aff=cJJn",
        requiresApiKey: true,
        supportsCustomUrl: true,
        statusMessage: "GoRouter API key missing"
    },
    {
        id: "bluesminds",
        name: "BluesMinds",
        category: "api_key",
        protocol: "openai",
        baseUrl: BLUESMINDS_BASE_URL,
        websiteUrl: "https://api.bluesminds.com/sign-up?aff=nCAw",
        requiresApiKey: true,
        supportsCustomUrl: true,
        statusMessage: "BluesMinds API key missing"
    },
    {
        id: "seekai",
        name: "SeekAI",
        category: "api_key",
        protocol: "openai",
        baseUrl: SEEKAI_BASE_URL,
        websiteUrl: "https://seekai.cc/sign-up?aff=UU0C",
        requiresApiKey: true,
        supportsCustomUrl: true,
        statusMessage: "SeekAI API key missing"
    },
    {
        id: "tabitoken",
        name: "TabiToken",
        category: "api_key",
        protocol: "openai",
        baseUrl: TABITOKEN_BASE_URL,
        websiteUrl: "https://tabitoken.com/sign-up?aff=h5iN",
        requiresApiKey: true,
        supportsCustomUrl: true,
        statusMessage: "TabiToken API key missing"
    },
    {
        id: "tokenrouter",
        name: "TokenRouter",
        category: "api_key",
        protocol: "openai",
        baseUrl: TOKENROUTER_BASE_URL,
        websiteUrl: "https://tokenrouter.com",
        requiresApiKey: true,
        supportsCustomUrl: true,
        statusMessage: "TokenRouter API key missing"
    },
    {
        id: "openai_codex",
        name: "OpenAI Codex / ChatGPT",
        category: "oauth",
        protocol: "openai",
        alias: "openai",
        websiteUrl: "https://chatgpt.com",
        requiresApiKey: false,
        requiresOAuth: true,
        statusMessage: "OAuth token missing"
    },
    {
        id: "anthropic",
        name: "Anthropic Claude",
        category: "oauth",
        protocol: "anthropic",
        alias: "claude",
        websiteUrl: "https://claude.ai",
        requiresApiKey: false,
        requiresOAuth: true,
        statusMessage: "OAuth token missing"
    },
    {
        id: "antigravity",
        name: "Google Antigravity",
        category: "oauth",
        protocol: "openai",
        baseUrl: ANTIGRAVITY_IDE_BASE_URL,
        websiteUrl: "https://ai.google.dev",
        requiresApiKey: false,
        requiresOAuth: true,
        statusMessage: "Antigravity OAuth token missing"
    },
    {
        id: "commandcode",
        name: "Command Code",
        category: "api_key",
        protocol: "openai",
        baseUrl: COMMANDCODE_BASE_URL,
        websiteUrl: "https://commandcode.ai",
        requiresApiKey: true,
        supportsCustomUrl: true,
        statusMessage: "Command Code API key missing"
    },
    {
        id: "qoder",
        name: "Qoder",
        category: "oauth",
        protocol: "openai",
        alias: "qd",
        baseUrl: QODER_CHAT_URL_ENCODED,
        websiteUrl: "https://qoder.com",
        requiresApiKey: false,
        requiresOAuth: true,
        supportsCustomUrl: true,
        statusMessage: "Qoder token or session missing"
    },
    {
        id: "codebuddy",
        name: "CodeBuddy",
        category: "oauth",
        protocol: "openai",
        alias: "codebuddy",
        baseUrl: CODEBUDDY_BASE_URL,
        websiteUrl: "https://www.codebuddy.ai",
        requiresApiKey: false,
        requiresOAuth: true,
        supportsCustomUrl: true,
        statusMessage: "CodeBuddy OAuth token missing"
    },
    {
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
    }
];

export const KNOWN_PROVIDER_MAP: Record<string, KnownProvider> = Object.fromEntries(
    KNOWN_PROVIDERS.map((provider) => [provider.id, provider])
);

export function providerById(id: string): KnownProvider | undefined {
    return KNOWN_PROVIDER_MAP[id];
}

export function isKnownProvider(id: string): boolean {
    return KNOWN_PROVIDER_MAP[id] !== undefined;
}

/**
 * Collapse a provider account id to its base driver id (e.g.
 * openai_codex_1700000000 → openai, kiro-2 → kiro).
 */
export function providerBaseId(id: string): string {
    return id.split("_")[0]?.split("-")[0] ?? id;
}

/**
 * Whether `id` is the base id itself or a multi-account variant of it
 * (`${baseId}_…` or `${baseId}-…`).
 */
export function isProviderBaseId(id: string, baseId: string): boolean {
    return id === baseId || id.startsWith(`${baseId}_`) || id.startsWith(`${baseId}-`);
}

/** Model-id prefix for a base id, honoring the catalog `alias` override. */
export function providerAlias(baseId: string): string {
    return KNOWN_PROVIDER_MAP[baseId]?.alias ?? baseId;
}

/**
 * Resolve a model-id alias to a provider type. The stale "claude" alias is
 * preserved as a no-op for backward compatibility.
 */
export function providerTypeForAlias(alias: string): string | null {
    if (alias === "claude") return "claude";
    if (alias === "cbai") return "codebuddy";
    const provider = KNOWN_PROVIDERS.find((p) => p.alias === alias || p.id === alias);
    return provider ? provider.id : null;
}

/**
 * Returns the homepage / console URL for a given provider.
 */
export function getProviderWebsiteUrl(
    providerId: string,
    defaultBaseUrl?: string
): string | undefined {
    const baseId = providerBaseId(providerId);
    const known = KNOWN_PROVIDER_MAP[providerId] ?? KNOWN_PROVIDER_MAP[baseId];
    if (known?.websiteUrl) return known.websiteUrl;

    if (defaultBaseUrl) {
        try {
            const parsed = new URL(defaultBaseUrl);
            return `${parsed.protocol}//${parsed.host}`;
        } catch {
            return undefined;
        }
    }
    return undefined;
}
