import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { CreateAPIKeyZod, APIKeyZod, UpdateAPIKeyZod } from "@srouter/types";

export function useKeys() {
    const [keys, setKeys] = useState<APIKeyZod[]>([]);
    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);
    const [updatingId, setUpdatingId] = useState<string | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [addingCreditId, setAddingCreditId] = useState<string | null>(null);
    const [newlyCreatedKey, setNewlyCreatedKey] = useState<APIKeyZod | null>(null);

    const fetchKeys = useCallback(async () => {
        try {
            const json = await api.get<{ data: APIKeyZod[] }>("/v1/keys");
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
        async (data: CreateAPIKeyZod) => {
            if (!data.name.trim()) {
                toast.error("Key name is required");
                return null;
            }

            setCreating(true);
            try {
                const created = await api.post<APIKeyZod>("/v1/keys", data);
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

    const updateKey = useCallback(
        async (id: string, data: UpdateAPIKeyZod) => {
            setUpdatingId(id);
            try {
                const updated = await api.patch<APIKeyZod>(`/v1/keys/${id}`, data);
                setKeys((prev) => prev.map((k) => (k.id === id ? updated : k)));
                toast.success(`API Key "${updated.name}" updated successfully`);
                return updated;
            } catch (err) {
                const msg = err instanceof Error ? err.message : "Failed to update API key";
                toast.error(msg);
                return null;
            } finally {
                setUpdatingId(null);
            }
        },
        []
    );

    const addCredit = useCallback(async (id: string, amount: number) => {
        if (!Number.isFinite(amount) || amount <= 0) {
            toast.error("Amount must be greater than 0");
            return null;
        }

        setAddingCreditId(id);
        try {
            const updated = await api.post<APIKeyZod>(`/v1/keys/${id}/credit`, { amount });
            setKeys((prev) => prev.map((k) => (k.id === id ? updated : k)));
            toast.success(`Added $${amount.toFixed(2)} credit to "${updated.name}"`);
            return updated;
        } catch (err) {
            const msg = err instanceof Error ? err.message : "Failed to add credit";
            toast.error(msg);
            return null;
        } finally {
            setAddingCreditId(null);
        }
    }, []);

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
        updatingId,
        deletingId,
        addingCreditId,
        newlyCreatedKey,
        setNewlyCreatedKey,
        fetchKeys,
        createKey,
        updateKey,
        addCredit,
        deleteKey
    };
}
