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

export const KNOWN_PROVIDERS: readonly KnownProvider[] = Object.freeze([
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
]);

export const KNOWN_PROVIDER_MAP: Readonly<Record<string, KnownProvider>> = Object.freeze(
    Object.fromEntries(KNOWN_PROVIDERS.map((P) => [P.id, P]))
);

const KNOWN_PROVIDER_IDS_BY_LENGTH: readonly string[] = Object.freeze(
    Object.keys(KNOWN_PROVIDER_MAP).sort((A, B) => B.length - A.length)
);

export function providerById(Id: string): KnownProvider | undefined {
    return KNOWN_PROVIDER_MAP[Id];
}

export function isKnownProvider(Id: string): boolean {
    return Id in KNOWN_PROVIDER_MAP;
}

export function providerBaseId(Id: string): string {
    const MatchedId = KNOWN_PROVIDER_IDS_BY_LENGTH.find(
        (Candidate) =>
            Id === Candidate || Id.startsWith(`${Candidate}_`) || Id.startsWith(`${Candidate}-`)
    );
    if (MatchedId) return MatchedId;
    return Id.split("_")[0]?.split("-")[0] ?? Id;
}

export function isProviderBaseId(Id: string, BaseId: string): boolean {
    return Id === BaseId || Id.startsWith(`${BaseId}_`) || Id.startsWith(`${BaseId}-`);
}

export function providerAlias(BaseId: string): string {
    return KNOWN_PROVIDER_MAP[BaseId]?.alias ?? BaseId;
}

export function providerTypeForAlias(Alias: string): string | null {
    if (Alias === "claude") return "claude";
    if (Alias === "cbai") return "codebuddy";
    const Provider = KNOWN_PROVIDERS.find((P) => P.alias === Alias || P.id === Alias);
    return Provider ? Provider.id : null;
}

export function getProviderWebsiteUrl(
    ProviderId: string,
    DefaultBaseUrl?: string
): string | undefined {
    const BaseId = providerBaseId(ProviderId);
    const Known = KNOWN_PROVIDER_MAP[ProviderId] ?? KNOWN_PROVIDER_MAP[BaseId];
    if (Known?.websiteUrl) return Known.websiteUrl;

    if (DefaultBaseUrl) {
        try {
            const Parsed = new URL(DefaultBaseUrl);
            return `${Parsed.protocol}//${Parsed.host}`;
        } catch {
            return undefined;
        }
    }
    return undefined;
}
