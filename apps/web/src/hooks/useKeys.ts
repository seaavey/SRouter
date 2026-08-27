import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { DBAPIKey } from "@srouter/types";

export function useKeys() {
    const [keys, setKeys] = useState<DBAPIKey[]>([]);
    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [newlyCreatedKey, setNewlyCreatedKey] = useState<DBAPIKey | null>(null);

    const fetchKeys = useCallback(async () => {
        try {
            const json = await api.get<{ data: DBAPIKey[] }>("/v1/keys");
            setKeys(json.data ?? []);
        } catch (err) {
            console.error("Failed to fetch API keys:", err);
            toast.error("Failed to load API keys");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void fetchKeys();
    }, [fetchKeys]);

    const createKey = useCallback(
        async (data: {
            name: string;
            rateLimit?: number;
            quotaLimit?: number;
            allowed_models?: string[] | null;
        }) => {
            if (!data.name.trim()) {
                toast.error("Key name is required");
                return null;
            }

            setCreating(true);
            try {
                const created = await api.post<DBAPIKey>("/v1/keys", data);
                setKeys((prev) => [created, ...prev]);
                setNewlyCreatedKey(created);
                toast.success(`API Key "${created.name}" created successfully`);
                return created;
            } catch (err) {
                const msg = err instanceof Error ? err.message : "Failed to create API key";
                toast.error(msg);
                return null;
            } finally {
                setCreating(false);
            }
        },
        []
    );

    const deleteKey = useCallback(async (id: string) => {
        setDeletingId(id);
        try {
            await api.delete(`/v1/keys/${id}`);
            setKeys((prev) => prev.filter((k) => k.id !== id));
            toast.success("API Key revoked and deleted");
            return true;
        } catch (err) {
            const msg = err instanceof Error ? err.message : "Failed to delete API key";
            toast.error(msg);
            return false;
        } finally {
            setDeletingId(null);
        }
    }, []);

    return {
        keys,
        loading,
        creating,
        deletingId,
        newlyCreatedKey,
        setNewlyCreatedKey,
        fetchKeys,
        createKey,
        deleteKey
    };
}
