import type { ProviderCategory, ProviderProtocol } from "@srouter/types";
import { ANTHROPIC_BASE_URL } from "./anthropic.js";
import { ANTIGRAVITY_IDE_BASE_URL } from "./antigravity.js";
import {
    BLUESMINDS_BASE_URL,
    COMMANDCODE_BASE_URL,
    GOROUTER_BASE_URL,
    NEOSANTARA_BASE_URL,
    SEEKAI_BASE_URL,
    TABITOKEN_BASE_URL,
    TOKENROUTER_BASE_URL
} from "./apiKeys.js";
import { CODEBUDDY_BASE_URL, CODEBUDDY_CN_BASE_URL } from "./codebuddy.js";
import { OPENCODE_ZEN_BASE_URL } from "./opencode.js";
import { QODER_CHAT_URL_ENCODED } from "./qoder.js";

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
        id: "codebuddy-cn",
        name: "CodeBuddy CN",
        category: "oauth",
        protocol: "openai",
        alias: "codebuddy-cn",
        baseUrl: CODEBUDDY_CN_BASE_URL,
        websiteUrl: "https://www.codebuddy.cn",
        requiresApiKey: false,
        requiresOAuth: true,
        supportsCustomUrl: true,
        statusMessage: "CodeBuddy CN OAuth token missing"
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
const KNOWN_PROVIDER_IDS_BY_LENGTH = Object.keys(KNOWN_PROVIDER_MAP).sort(
    (left, right) => right.length - left.length
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
    const knownId = KNOWN_PROVIDER_IDS_BY_LENGTH.find(
        (candidate) =>
            id === candidate || id.startsWith(`${candidate}_`) || id.startsWith(`${candidate}-`)
    );
    if (knownId) return knownId;
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
