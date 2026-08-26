import type { ProviderCategory, ProviderProtocol } from "@srouter/types";

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
