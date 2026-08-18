import { useCallback, useEffect, useMemo, useState } from "react";

const STORAGE_KEY = "srouter_favorite_models";
const EVENT_NAME = "srouter:favorites-updated";

function loadFavorites(): string[] {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function saveFavorites(favorites: string[]): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(favorites));
        window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: favorites }));
    } catch (e) {
        console.error("Failed to save favorite models to localStorage:", e);
    }
}

/**
 * Hook for managing pinned/favorite models across the dashboard and playground.
 */
export function useFavorites() {
    const [favorites, setFavorites] = useState<string[]>(loadFavorites);

    useEffect(() => {
        const handleUpdate = (e: Event) => {
            const customEvent = e as CustomEvent<string[]>;
            if (customEvent.detail) {
                setFavorites(customEvent.detail);
            } else {
                setFavorites(loadFavorites());
            }
        };

        const handleStorage = (e: StorageEvent) => {
            if (e.key === STORAGE_KEY) {
                setFavorites(loadFavorites());
            }
        };

        window.addEventListener(EVENT_NAME, handleUpdate);
        window.addEventListener("storage", handleStorage);

        return () => {
            window.removeEventListener(EVENT_NAME, handleUpdate);
            window.removeEventListener("storage", handleStorage);
        };
    }, []);

    const favoriteSet = useMemo(() => new Set(favorites), [favorites]);

    const isFavorite = useCallback(
        (modelId: string): boolean => {
            return favoriteSet.has(modelId);
        },
        [favoriteSet]
    );

    const toggleFavorite = useCallback((modelId: string) => {
        setFavorites((prev) => {
            const exists = prev.includes(modelId);
            const next = exists ? prev.filter((id) => id !== modelId) : [...prev, modelId];
            saveFavorites(next);
            return next;
        });
    }, []);

    const addFavorite = useCallback((modelId: string) => {
        setFavorites((prev) => {
            if (prev.includes(modelId)) return prev;
            const next = [...prev, modelId];
            saveFavorites(next);
            return next;
        });
    }, []);

    const removeFavorite = useCallback((modelId: string) => {
        setFavorites((prev) => {
            if (!prev.includes(modelId)) return prev;
            const next = prev.filter((id) => id !== modelId);
            saveFavorites(next);
            return next;
        });
    }, []);

    const addMultipleFavorites = useCallback((modelIds: string[]) => {
        setFavorites((prev) => {
            const set = new Set(prev);
            for (const id of modelIds) {
                set.add(id);
            }
            const next = Array.from(set);
            saveFavorites(next);
            return next;
        });
    }, []);

    const removeMultipleFavorites = useCallback((modelIds: string[]) => {
        setFavorites((prev) => {
            const removeSet = new Set(modelIds);
            const next = prev.filter((id) => !removeSet.has(id));
            saveFavorites(next);
            return next;
        });
    }, []);

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
