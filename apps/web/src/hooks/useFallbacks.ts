import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { FallbackRule } from "@srouter/types";

export function useFallbacks() {
    const [fallbacks, setFallbacks] = useState<FallbackRule[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [deletingId, setDeletingId] = useState<string | null>(null);

    const fetchFallbacks = useCallback(async () => {
        try {
            const json = await api.get<{ fallbacks: FallbackRule[] }>("/v1/settings/fallbacks");
            setFallbacks(json.fallbacks ?? []);
        } catch (err) {
            console.error("Failed to fetch fallback rules:", err);
            toast.error("Failed to load fallback rules");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void fetchFallbacks();
    }, [fetchFallbacks]);

    const createFallback = useCallback(
        async (data: {
            sourceModel: string;
            targetModel: string;
            priority?: number;
            enabled?: boolean;
            triggerOnStatus?: number[];
            maxRetries?: number;
        }) => {
            if (!data.sourceModel.trim() || !data.targetModel.trim()) {
                toast.error("Both Source Model and Target Model are required");
                return null;
            }

            setSaving(true);
            try {
                const res = await api.post<{ fallback: FallbackRule }>(
                    "/v1/settings/fallbacks",
                    data
                );
                if (res.fallback) {
                    setFallbacks((prev) =>
                        [...prev, res.fallback].sort((a, b) => a.priority - b.priority)
                    );
                    toast.success(
                        `Fallback rule for "${res.fallback.sourceModel}" created successfully`
                    );
                    return res.fallback;
                }
                return null;
            } catch (err) {
                const msg = err instanceof Error ? err.message : "Failed to create fallback rule";
                toast.error(msg);
                return null;
            } finally {
                setSaving(false);
            }
        },
        []
    );

    const updateFallback = useCallback(async (id: string, updates: Partial<FallbackRule>) => {
        setSaving(true);
        try {
            const res = await api.put<{ fallback: FallbackRule }>(
                `/v1/settings/fallbacks/${id}`,
                updates
            );
            if (res.fallback) {
                setFallbacks((prev) =>
                    prev
                        .map((r) => (r.id === id ? res.fallback : r))
                        .sort((a, b) => a.priority - b.priority)
                );
                toast.success("Fallback rule updated");
                return res.fallback;
            }
            return null;
        } catch (err) {
            const msg = err instanceof Error ? err.message : "Failed to update fallback rule";
            toast.error(msg);
            return null;
        } finally {
            setSaving(false);
        }
    }, []);

    const deleteFallback = useCallback(async (id: string) => {
        setDeletingId(id);
        try {
            await api.delete(`/v1/settings/fallbacks/${id}`);
            setFallbacks((prev) => prev.filter((r) => r.id !== id));
            toast.success("Fallback rule deleted");
            return true;
        } catch (err) {
            const msg = err instanceof Error ? err.message : "Failed to delete fallback rule";
            toast.error(msg);
            return false;
        } finally {
            setDeletingId(null);
        }
    }, []);

    return {
        fallbacks,
        loading,
        saving,
        deletingId,
        fetchFallbacks,
        createFallback,
        updateFallback,
        deleteFallback
    };
}
