import type { ProviderCategory } from "@srouter/types";

export const PROVIDER_CATEGORIES: ProviderCategory[] = [
    "oauth",
    "free_tier",
    "api_key",
    "custom_provider"
];

export const CATEGORY_ORDER: ProviderCategory[] = [
    "oauth",
    "api_key",
    "custom_provider",
    "free_tier"
];

export const CATEGORY_LABELS: Record<ProviderCategory, string> = {
    oauth: "OAuth Provider",
    api_key: "API Key Provider",
    custom_provider: "Custom Provider",
    free_tier: "Free Tier Provider"
};

export const CATEGORY_DESCRIPTIONS: Record<ProviderCategory, string> = {
    oauth: "Signed in through a provider account rather than a key.",
    api_key: "Authenticated with a platform key you supply.",
    custom_provider: "User-registered endpoint with a custom base URL.",
    free_tier: "Free or rate-limited public endpoints."
};

export function isProviderCategory(value: string): value is ProviderCategory {
    return PROVIDER_CATEGORIES.includes(value as ProviderCategory);
}
