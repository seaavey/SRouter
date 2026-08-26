import type { ProviderCategory, ProviderProtocol } from "@srouter/types";

export interface KnownProvider {
    id: string;
    name: string;
    category: ProviderCategory;
    protocol: ProviderProtocol;
    baseUrl?: string;
    websiteUrl?: string;
    alias?: string;
    requiresApiKey: boolean;
    requiresOAuth?: boolean;
    supportsCustomUrl?: boolean;
    statusMessage: string;
}
