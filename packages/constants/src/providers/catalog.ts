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
import { BAI_PROVIDER } from "./bai.js";
import { QODER_PROVIDER } from "./qoder.js";
import { SEEKAI_PROVIDER } from "./seekai.js";
import { TABITOKEN_PROVIDER } from "./tabitoken.js";
import { TOKENROUTER_PROVIDER } from "./tokenrouter.js";
import type { ProviderMetadata } from "./types.js";

export const KNOWN_PROVIDERS = [
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
    OPENCODE_ZEN_PROVIDER,
    BAI_PROVIDER
] as const satisfies readonly ProviderMetadata[];

export const KNOWN_PROVIDER_MAP = Object.freeze(
    Object.fromEntries(KNOWN_PROVIDERS.map((Provider) => [Provider.id, Provider]))
) as Readonly<Record<string, ProviderMetadata>>;

const KNOWN_PROVIDER_IDS_DESC = Object.freeze(
    Object.keys(KNOWN_PROVIDER_MAP).sort((A, B) => B.length - A.length)
);

const LEGACY_ALIAS_MAP: Readonly<Record<string, string>> = Object.freeze({
    claude: "claude",
    cbai: "codebuddy"
});

export function providerById(Id: string): ProviderMetadata | undefined {
    return KNOWN_PROVIDER_MAP[Id];
}

export function isKnownProvider(Id: string): boolean {
    return Id in KNOWN_PROVIDER_MAP;
}

export function providerBaseId(Id: string): string {
    return (
        KNOWN_PROVIDER_IDS_DESC.find(
            (Candidate) =>
                Id === Candidate || Id.startsWith(`${Candidate}_`) || Id.startsWith(`${Candidate}-`)
        ) ??
        Id.split("_")[0]?.split("-")[0] ??
        Id
    );
}

export function isProviderBaseId(Id: string, BaseId: string): boolean {
    return Id === BaseId || Id.startsWith(`${BaseId}_`) || Id.startsWith(`${BaseId}-`);
}

export function providerAlias(BaseId: string): string {
    return KNOWN_PROVIDER_MAP[BaseId]?.alias ?? BaseId;
}

export function providerTypeForAlias(Alias: string): string | null {
    if (Alias in LEGACY_ALIAS_MAP) return LEGACY_ALIAS_MAP[Alias];
    return KNOWN_PROVIDERS.find((P) => P.alias === Alias || P.id === Alias)?.id ?? null;
}

export function getProviderWebsiteUrl(
    ProviderId: string,
    DefaultBaseUrl?: string
): string | undefined {
    const BaseId = providerBaseId(ProviderId);
    const Metadata = KNOWN_PROVIDER_MAP[ProviderId] ?? KNOWN_PROVIDER_MAP[BaseId];
    if (Metadata?.web_url) return Metadata.web_url;

    if (!DefaultBaseUrl) return undefined;
    try {
        return new URL(DefaultBaseUrl).origin;
    } catch {
        return undefined;
    }
}
