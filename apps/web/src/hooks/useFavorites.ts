import { useCallback, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

const STORAGE_KEY = "srouter_favorite_models";

function loadLegacyFavorites(): string[] {
    try {
        const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
        return Array.isArray(parsed) && parsed.every((id): id is string => typeof id === "string") ? parsed : [];
    } catch {
        return [];
    }
}

export function useFavorites() {
    const queryClient = useQueryClient();
    const query = useQuery({
        queryKey: ["favorite-models"],
        queryFn: async () => {
            const response = await api.get<{ models: string[] }>("/v1/favorites");
            if (response.models.length > 0 || typeof window === "undefined") return response.models;

            const legacyFavorites = loadLegacyFavorites();
            for (const modelId of legacyFavorites) {
                await api.post("/v1/favorites", { model_id: modelId });
            }
            if (legacyFavorites.length > 0) localStorage.removeItem(STORAGE_KEY);
            return legacyFavorites;
        }
    });

    const mutation = useMutation({
        mutationFn: ({ modelId, favorite }: { modelId: string; favorite: boolean }) =>
            favorite
                ? api.post("/v1/favorites", { model_id: modelId })
                : api.delete(`/v1/favorites/${encodeURIComponent(modelId)}`),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: ["favorite-models"] });
        }
    });

    const favorites = query.data ?? [];
    const favoriteSet = useMemo(() => new Set(favorites), [favorites]);

    const toggleFavorite = useCallback((modelId: string) => {
        mutation.mutate({ modelId, favorite: !favoriteSet.has(modelId) });
    }, [favoriteSet, mutation]);

    const addFavorite = useCallback((modelId: string) => {
        if (!favoriteSet.has(modelId)) mutation.mutate({ modelId, favorite: true });
    }, [favoriteSet, mutation]);

    const removeFavorite = useCallback((modelId: string) => {
        if (favoriteSet.has(modelId)) mutation.mutate({ modelId, favorite: false });
    }, [favoriteSet, mutation]);

    const addMultipleFavorites = useCallback((modelIds: string[]) => {
        for (const modelId of modelIds) {
            if (!favoriteSet.has(modelId)) mutation.mutate({ modelId, favorite: true });
        }
    }, [favoriteSet, mutation]);

    const removeMultipleFavorites = useCallback((modelIds: string[]) => {
        for (const modelId of modelIds) {
            if (favoriteSet.has(modelId)) mutation.mutate({ modelId, favorite: false });
        }
    }, [favoriteSet, mutation]);

    return {
        favorites,
        isFavorite: (modelId: string): boolean => favoriteSet.has(modelId),
        toggleFavorite,
        addFavorite,
        removeFavorite,
        addMultipleFavorites,
        removeMultipleFavorites
    };
}
