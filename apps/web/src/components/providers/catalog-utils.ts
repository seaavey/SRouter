import type { ProviderCategory, ProviderDefinition } from "@srouter/types";
import { getConnectedCount } from "./provider-status";

export interface CatalogSummary {
    total: number;
    categories: Record<ProviderCategory, ProviderDefinition[]>;
}

export const categoryOrder: ProviderCategory[] = ["oauth", "api_key", "free_tier", "custom"];

export const categoryLabels: Record<ProviderCategory, string> = {
    oauth: "OAuth session",
    api_key: "API key",
    free_tier: "Free tier",
    custom: "Custom",
};

export const categoryDescriptions: Record<ProviderCategory, string> = {
    oauth: "Signed in through a provider account rather than a key.",
    api_key: "Authenticated with a platform key you supply.",
    free_tier: "Free or rate-limited public endpoints.",
    custom: "Endpoints you registered on this gateway.",
};

export type FilterValue = "all" | ProviderCategory;

export function flattenCatalog(data: CatalogSummary): ProviderDefinition[] {
    return categoryOrder.flatMap((category) => data.categories[category] ?? []);
}

export interface CatalogSummaryItems {
    label: string;
    value: string;
    detail: string;
}

export function buildSummaryItems(
    data: CatalogSummary,
    allProviders: ProviderDefinition[],
): CatalogSummaryItems[] {
    const connectedProviders = allProviders.filter((provider) => getConnectedCount(provider) > 0);
    const totalConnections = allProviders.reduce(
        (total, provider) => total + getConnectedCount(provider),
        0,
    );
    const totalModels = allProviders.reduce((total, provider) => total + provider.models.length, 0);

    return [
        {
            label: "Drivers",
            value: data.total.toLocaleString(),
            detail: "Available in the registry",
        },
        {
            label: "Connected",
            value: connectedProviders.length.toLocaleString(),
            detail: `${totalConnections.toLocaleString()} active ${totalConnections === 1 ? "connection" : "connections"}`,
        },
        {
            label: "Unconfigured",
            value: (allProviders.length - connectedProviders.length).toLocaleString(),
            detail: "Ready to connect",
        },
        {
            label: "Models",
            value: totalModels.toLocaleString(),
            detail: "Exposed across all drivers",
        },
    ];
}

export function buildFilterOptions(
    data: CatalogSummary,
    allProviders: ProviderDefinition[],
): { value: FilterValue; label: string; count: number }[] {
    return [
        { value: "all", label: "All", count: allProviders.length },
        ...categoryOrder.map((category) => ({
            value: category as FilterValue,
            label: categoryLabels[category],
            count: (data.categories[category] ?? []).length,
        })),
    ];
}

export function matchesProvider(
    provider: ProviderDefinition,
    filter: FilterValue,
    normalizedSearch: string,
): boolean {
    if (filter !== "all" && provider.category !== filter) return false;
    if (!normalizedSearch) return true;
    return (
        provider.name.toLowerCase().includes(normalizedSearch) ||
        provider.id.toLowerCase().includes(normalizedSearch) ||
        provider.protocol.toLowerCase().includes(normalizedSearch)
    );
}

export function buildGroups(
    providers: ProviderDefinition[],
    filter: FilterValue,
): { category: ProviderCategory; providers: ProviderDefinition[] }[] {
    if (filter === "all") {
        return categoryOrder
            .map((category) => ({
                category,
                providers: providers.filter((provider) => provider.category === category),
            }))
            .filter((group) => group.providers.length > 0);
    }
    return [{ category: filter, providers }];
}
