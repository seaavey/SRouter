import { useMemo, useState } from "react";
import type { ModelObject } from "@srouter/types";
import { providerFor } from "@/components/models/model-utils";

export function useModels(models: ModelObject[]) {
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedProviderFilter, setSelectedProviderFilter] = useState("all");

    const providersList = useMemo(
        () => Array.from(new Set(models.map((model) => providerFor(model)))),
        [models],
    );

    const filteredModels = useMemo(
        () =>
            models.filter((model) => {
                const provider = providerFor(model).toLowerCase();
                const matchesQuery =
                    model.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
                    provider.includes(searchQuery.toLowerCase());

                const matchesProvider =
                    selectedProviderFilter === "all" ||
                    provider === selectedProviderFilter.toLowerCase();

                return matchesQuery && matchesProvider;
            }),
        [models, searchQuery, selectedProviderFilter],
    );

    const providerCounts = useMemo(
        () =>
            new Map(
                providersList.map((provider) => [
                    provider,
                    models.filter(
                        (model) => providerFor(model).toLowerCase() === provider.toLowerCase(),
                    ).length,
                ]),
            ),
        [models, providersList],
    );

    return {
        searchQuery,
        setSearchQuery,
        selectedProviderFilter,
        setSelectedProviderFilter,
        providersList,
        providerCounts,
        filteredModels,
    };
}
