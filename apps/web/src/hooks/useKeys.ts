import { useCallback, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type {
    APIKeyResponse,
    CreateAPIKeyInput,
    CreatedAPIKeyResponse,
    UpdateAPIKeyInput
} from "@/generated/api";

type KeysResponse = {
    data: APIKeyResponse[];
};

type UpdateKeyVariables = {
    id: string;
    data: UpdateAPIKeyInput;
};

const KEYS_QUERY_KEY = ["keys"] as const;

function getErrorMessage(error: unknown, fallback: string): string {
    return error instanceof Error ? error.message : fallback;
}

export function useKeys() {
    const queryClient = useQueryClient();
    const [newlyCreatedKey, setNewlyCreatedKey] = useState<CreatedAPIKeyResponse | null>(null);

    const keysQuery = useQuery({
        queryKey: KEYS_QUERY_KEY,
        queryFn: () => api.get<KeysResponse>("/v1/keys")
    });

    useEffect(() => {
        if (!keysQuery.error) return;

        console.error("Failed to fetch API keys:", keysQuery.error);
        toast.error("Failed to load API keys");
    }, [keysQuery.error]);

    const createMutation = useMutation({
        mutationFn: (data: CreateAPIKeyInput) => api.post<CreatedAPIKeyResponse>("/v1/keys", data),
        onSuccess: (created) => {
            queryClient.setQueryData<KeysResponse>(KEYS_QUERY_KEY, (current) =>
                current ? { ...current, data: [created, ...current.data] } : current
            );
            void queryClient.invalidateQueries({ queryKey: KEYS_QUERY_KEY });
            setNewlyCreatedKey(created);
            toast.success(`API Key "${created.name}" created successfully`);
        },
        onError: (error) => {
            toast.error(getErrorMessage(error, "Failed to create API key"));
        }
    });

    const updateMutation = useMutation({
        mutationFn: ({ id, data }: UpdateKeyVariables) =>
            api.patch<APIKeyResponse>(`/v1/keys/${id}`, data),
        onSuccess: (updated) => {
            queryClient.setQueryData<KeysResponse>(KEYS_QUERY_KEY, (current) =>
                current
                    ? {
                          ...current,
                          data: current.data.map((key) => (key.id === updated.id ? updated : key))
                      }
                    : current
            );
            void queryClient.invalidateQueries({ queryKey: KEYS_QUERY_KEY });
            toast.success(`API Key "${updated.name}" updated successfully`);
        },
        onError: (error) => {
            toast.error(getErrorMessage(error, "Failed to update API key"));
        }
    });

    const deleteMutation = useMutation({
        mutationFn: (id: string) => api.delete<{ message: string }>(`/v1/keys/${id}`),
        onSuccess: (_, deletedId) => {
            queryClient.setQueryData<KeysResponse>(KEYS_QUERY_KEY, (current) =>
                current
                    ? { ...current, data: current.data.filter((key) => key.id !== deletedId) }
                    : current
            );
            void queryClient.invalidateQueries({ queryKey: KEYS_QUERY_KEY });
            toast.success("API Key revoked and deleted");
        },
        onError: (error) => {
            toast.error(getErrorMessage(error, "Failed to delete API key"));
        }
    });

    const createKey = useCallback(
        async (data: CreateAPIKeyInput) => {
            if (!data.name.trim()) {
                toast.error("Key name is required");
                return null;
            }

            try {
                return await createMutation.mutateAsync(data);
            } catch {
                return null;
            }
        },
        [createMutation]
    );

    const updateKey = useCallback(
        async (id: string, data: UpdateAPIKeyInput) => {
            try {
                return await updateMutation.mutateAsync({ id, data });
            } catch {
                return null;
            }
        },
        [updateMutation]
    );

    const deleteKey = useCallback(
        async (id: string) => {
            try {
                await deleteMutation.mutateAsync(id);
                return true;
            } catch {
                return false;
            }
        },
        [deleteMutation]
    );

    return {
        keys: keysQuery.data?.data ?? [],
        loading: keysQuery.isPending,
        creating: createMutation.isPending,
        updatingId: updateMutation.isPending ? (updateMutation.variables?.id ?? null) : null,
        deletingId: deleteMutation.isPending ? (deleteMutation.variables ?? null) : null,

        newlyCreatedKey,
        setNewlyCreatedKey,
        createKey,
        updateKey,

        deleteKey
    };
}
