import { useCallback, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ModelListResponse } from "@/generated/api";
import { api } from "@/lib/api";

const STORAGE_KEY = "srouter_favorite_models";

function loadLegacyFavorites(): string[] {
    try {
        const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
        return Array.isArray(parsed) && parsed.every((id): id is string => typeof id === "string")
            ? parsed
            : [];
    } catch {
        return [];
    }
}

export function useFavorites() {
    const queryClient = useQueryClient();
    const query = useQuery({
        queryKey: ["favorite-models"],
        queryFn: async () => {
            // Favorites are a flag on the catalog entry, so the list route is the
            // read side and `PATCH /v1/models/:id` the write side.
            const response = await api.get<ModelListResponse>("/v1/models");
            const favorites = response.data
                .filter((model) => model.favorite === true)
                .map((model) => model.id);
            if (favorites.length > 0 || typeof window === "undefined") return favorites;

            const legacyFavorites = loadLegacyFavorites();
            for (const modelId of legacyFavorites) {
                await api.patch(`/v1/models/${encodeURIComponent(modelId)}`, { favorite: true });
            }
            if (legacyFavorites.length > 0) localStorage.removeItem(STORAGE_KEY);
            return legacyFavorites;
        }
    });

    const mutation = useMutation({
        mutationFn: ({ modelId, favorite }: { modelId: string; favorite: boolean }) =>
            api.patch(`/v1/models/${encodeURIComponent(modelId)}`, { favorite }),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: ["favorite-models"] });
        }
    });

    const favorites = query.data ?? [];
    const favoriteSet = useMemo(() => new Set(favorites), [favorites]);

    const toggleFavorite = useCallback(
        (modelId: string) => {
            mutation.mutate({ modelId, favorite: !favoriteSet.has(modelId) });
        },
        [favoriteSet, mutation]
    );

    const addFavorite = useCallback(
        (modelId: string) => {
            if (!favoriteSet.has(modelId)) mutation.mutate({ modelId, favorite: true });
        },
        [favoriteSet, mutation]
    );

    const removeFavorite = useCallback(
        (modelId: string) => {
            if (favoriteSet.has(modelId)) mutation.mutate({ modelId, favorite: false });
        },
        [favoriteSet, mutation]
    );

    const addMultipleFavorites = useCallback(
        (modelIds: string[]) => {
            for (const modelId of modelIds) {
                if (!favoriteSet.has(modelId)) mutation.mutate({ modelId, favorite: true });
            }
        },
        [favoriteSet, mutation]
    );

    const removeMultipleFavorites = useCallback(
        (modelIds: string[]) => {
            for (const modelId of modelIds) {
                if (favoriteSet.has(modelId)) mutation.mutate({ modelId, favorite: false });
            }
        },
        [favoriteSet, mutation]
    );

    const isFavorite = useCallback(
        (modelId: string): boolean => favoriteSet.has(modelId),
        [favoriteSet]
    );

    return {
        favorites,
        isFavorite,
        toggleFavorite,
        addFavorite,
        removeFavorite,
        addMultipleFavorites,
        removeMultipleFavorites
    };
}
