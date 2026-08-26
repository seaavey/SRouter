import { ANTHROPIC_PROVIDER } from "./anthropic.js";
import { ANTIGRAVITY_PROVIDER } from "./antigravity.js";
import { BLUESMINDS_PROVIDER } from "./bluesminds.js";
import { CODEBUDDY_CN_PROVIDER, CODEBUDDY_PROVIDER } from "./codebuddy.js";
import { COMMANDCODE_PROVIDER } from "./commandcode.js";
import { GOROUTER_PROVIDER } from "./gorouter.js";
import { KIRO_PROVIDER } from "./kiro.js";
import { NEOSANTARA_PROVIDER } from "./neosantara.js";
import { OPENAI_CODEX_PROVIDER } from "./openai.js";
import { OPENCODE_ZEN_PROVIDER } from "./opencode.js";
import { QODER_PROVIDER } from "./qoder.js";
import { SEEKAI_PROVIDER } from "./seekai.js";
import { TABITOKEN_PROVIDER } from "./tabitoken.js";
import { TOKENROUTER_PROVIDER } from "./tokenrouter.js";
import type { KnownProvider } from "./types.js";

export const KNOWN_PROVIDERS: KnownProvider[] = [
    KIRO_PROVIDER,
    NEOSANTARA_PROVIDER,
    GOROUTER_PROVIDER,
    BLUESMINDS_PROVIDER,
    SEEKAI_PROVIDER,
    TABITOKEN_PROVIDER,
    TOKENROUTER_PROVIDER,
    OPENAI_CODEX_PROVIDER,
    ANTHROPIC_PROVIDER,
    ANTIGRAVITY_PROVIDER,
    COMMANDCODE_PROVIDER,
    QODER_PROVIDER,
    CODEBUDDY_PROVIDER,
    CODEBUDDY_CN_PROVIDER,
    OPENCODE_ZEN_PROVIDER
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
