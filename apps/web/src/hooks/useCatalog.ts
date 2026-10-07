import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { KNOWN_PROVIDERS } from "@srouter/constants";
import type { ProviderEntry } from "@/generated/api";
import {
    buildFilterOptions,
    buildGroups,
    buildSummaryItems,
    matchesProvider,
    type CatalogSummary,
    type FilterValue
} from "@/utils/catalog.utils";

const STATIC_DEFAULT_PROVIDERS: ProviderEntry[] = KNOWN_PROVIDERS.map((kp) => ({
    id: kp.id,
    name: kp.name,
    category: kp.category,
    // The Rust enum carries three values; Node's union still lists the dead
    // `gemini`, which no seeded provider uses (`docs/api-v1-contract.md`,
    // "Providers in the Rust build").
    protocol: kp.protocol as ProviderEntry["protocol"],
    default_base_url: kp.base_url ?? "",
    requires_api_key: kp.requires_api_key,
    requires_oauth: kp.requires_oauth ?? false,
    supports_custom_url: kp.supports_custom_url ?? true,
    status: {
        state: !kp.requires_api_key && !kp.requires_oauth ? "connected" : "no_connections",
        message: kp.status_message,
        connected_count: !kp.requires_api_key && !kp.requires_oauth ? 1 : 0
    },
    enabled: true,
    round_robin: true,
    models: [],
    connections: []
}));

export function useCatalog() {
    const [filter, setFilter] = useState<FilterValue>("all");
    const [search, setSearch] = useState("");

    const query = useQuery({
        queryKey: ["providers", "catalog"],
        queryFn: () => api.get<CatalogSummary>("/v1/providers/catalog")
    });

    const liveData = query.data;
    const isLoading = query.isPending || !liveData;

    const allProviders = useMemo(() => {
        // Base list from static known providers
        const providerMap = new Map<string, ProviderEntry>();

        for (const p of STATIC_DEFAULT_PROVIDERS) {
            providerMap.set(p.id, { ...p });
        }

        // Overlay live backend connections and status
        if (liveData?.categories) {
            for (const categoryProviders of Object.values(liveData.categories)) {
                for (const live of categoryProviders) {
                    const existing = providerMap.get(live.id);
                    if (existing) {
                        providerMap.set(live.id, {
                            ...existing,
                            ...live,
                            name: existing.name,
                            category: existing.category,
                            protocol: existing.protocol
                        });
                    } else {
                        providerMap.set(live.id, live);
                    }
                }
            }
        }

        return Array.from(providerMap.values());
    }, [liveData]);

    const normalizedSearch = search.trim().toLowerCase();

    const matches = useMemo(
        () =>
            allProviders.filter((provider) => matchesProvider(provider, filter, normalizedSearch)),
        [allProviders, filter, normalizedSearch]
    );

    const syntheticCatalogSummary: CatalogSummary | undefined = useMemo(() => {
        if (!liveData) return undefined;
        const categories: Record<string, ProviderEntry[]> = {
            oauth: allProviders.filter((p) => p.category === "oauth"),
            api_key: allProviders.filter((p) => p.category === "api_key"),
            custom_provider: allProviders.filter((p) => p.category === "custom_provider"),
            free_tier: allProviders.filter((p) => p.category === "free_tier")
        };
        return {
            total: allProviders.length,
            categories: categories as CatalogSummary["categories"]
        };
    }, [liveData, allProviders]);

    const summaryItems = useMemo(
        () =>
            syntheticCatalogSummary ? buildSummaryItems(syntheticCatalogSummary, allProviders) : [],
        [syntheticCatalogSummary, allProviders]
    );

    const filterOptions = useMemo(
        () =>
            syntheticCatalogSummary
                ? buildFilterOptions(syntheticCatalogSummary, allProviders)
                : [],
        [syntheticCatalogSummary, allProviders]
    );

    const groups = useMemo(() => buildGroups(matches, filter), [matches, filter]);

    return {
        ...query,
        isLoading,
        isPending: isLoading,
        data: syntheticCatalogSummary,
        allProviders,
        filter,
        setFilter,
        search,
        setSearch,
        normalizedSearch,
        matches,
        summaryItems,
        filterOptions,
        groups
    };
}
