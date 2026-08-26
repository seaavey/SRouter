import type { ProviderCategory } from "@srouter/types";

export const PROVIDER_CATEGORIES: ProviderCategory[] = ["custom", "oauth", "free_tier", "api_key"];

export const CATEGORY_ORDER: ProviderCategory[] = ["oauth", "api_key", "free_tier", "custom"];

export const CATEGORY_LABELS: Record<ProviderCategory, string> = {
    oauth: "OAuth Provider",
    api_key: "API Key Provider",
    free_tier: "Free Tier Provider",
    custom: "Custom Provider"
};

export const CATEGORY_DESCRIPTIONS: Record<ProviderCategory, string> = {
    oauth: "Signed in through a provider account rather than a key.",
    api_key: "Authenticated with a platform key you supply.",
    free_tier: "Free or rate-limited public endpoints.",
    custom: "Endpoints you registered on this gateway."
};

export function isProviderCategory(value: string): value is ProviderCategory {
    return PROVIDER_CATEGORIES.includes(value as ProviderCategory);
}
