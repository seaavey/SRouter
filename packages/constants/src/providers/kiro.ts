import type { KnownProvider } from "./types.js";

export const KIRO_PROVIDER: KnownProvider = {
    id: "kiro",
    name: "Kiro",
    category: "api_key",
    protocol: "custom",
    websiteUrl: "https://aws.amazon.com/q/",
    requiresApiKey: true,
    supportsCustomUrl: true,
    statusMessage: "Kiro credential missing"
};
