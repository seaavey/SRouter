import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import {
    buildFilterOptions,
    buildGroups,
    buildSummaryItems,
    flattenCatalog,
    matchesProvider,
    type CatalogSummary,
    type FilterValue,
} from "@/components/providers/catalog-utils";

export function useCatalog() {
    const [filter, setFilter] = useState<FilterValue>("all");
    const [search, setSearch] = useState("");

    const query = useQuery({
        queryKey: ["providers", "catalog"],
        queryFn: () => api.get<CatalogSummary>("/v1/providers/catalog"),
    });

    const data = query.data;

    const allProviders = useMemo(() => (data ? flattenCatalog(data) : []), [data]);

    const normalizedSearch = search.trim().toLowerCase();

    const matches = useMemo(
        () =>
            allProviders.filter((provider) => matchesProvider(provider, filter, normalizedSearch)),
        [allProviders, filter, normalizedSearch],
    );

    const summaryItems = useMemo(
        () => (data ? buildSummaryItems(data, allProviders) : []),
        [data, allProviders],
    );

    const filterOptions = useMemo(
        () => (data ? buildFilterOptions(data, allProviders) : []),
        [data, allProviders],
    );

    const groups = useMemo(() => buildGroups(matches, filter), [matches, filter]);

    return {
        ...query,
        data,
        allProviders,
        filter,
        setFilter,
        search,
        setSearch,
        normalizedSearch,
        matches,
        summaryItems,
        filterOptions,
        groups,
    };
}
