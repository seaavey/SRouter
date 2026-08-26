import type { ProviderCategory, ProviderProtocol } from "@srouter/types";

export interface ProviderMetadata {
    id: string;
    name: string;
    category: ProviderCategory;
    protocol: ProviderProtocol;
    base_url?: string;
    web_url?: string;
    alias?: string;
    requires_api_key: boolean;
    requires_oauth?: boolean;
    supports_custom_url?: boolean;
    status_message: string;
}
