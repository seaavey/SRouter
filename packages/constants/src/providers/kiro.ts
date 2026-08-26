import type { ProviderMetadata } from "./types.js";

export const KIRO_PROVIDER: ProviderMetadata = {
    id: "kiro",
    name: "Kiro",
    category: "api_key",
    protocol: "custom",
    web_url: "https://aws.amazon.com/q/",
    requires_api_key: true,
    supports_custom_url: true,
    status_message: "Kiro credential missing"
};
