import type { ProviderCategory, ProviderProtocol } from "@srouter/types";
import { KNOWN_PROVIDERS } from "./providers.js";

export interface DefaultProviderSeed {
    id: string;
    name: string;
    category: ProviderCategory;
    protocol: ProviderProtocol;
    base_url?: string;
    requires_api_key: boolean;
    requires_oauth?: boolean;
    supports_custom_url?: boolean;
    status_message: string;
}

export const DEFAULT_PROVIDERS: readonly DefaultProviderSeed[] = Object.freeze(
    KNOWN_PROVIDERS.map(({ alias: _alias, ...seed }) => seed)
);

export const DEFAULT_PROVIDER_MAP: Readonly<Record<string, DefaultProviderSeed>> = Object.freeze(
    Object.fromEntries(DEFAULT_PROVIDERS.map((seed) => [seed.id, seed]))
);

export const SEED_MARKER = "__seed__";

export function isSeedProvider(row: { providerSpecificData?: Record<string, string> }): boolean {
    return row.providerSpecificData?.[SEED_MARKER] === "true";
}
