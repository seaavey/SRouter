import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { ProviderCategory, ProviderDefinition, ProviderProtocol } from "@srouter/types";

export interface AddConnectionPayload {
    id?: string;
    name: string;
    category: ProviderCategory;
    protocol: ProviderProtocol;
    baseUrl?: string;
    apiKey?: string;
}

/**
 * Loads a provider definition and exposes add/delete connection mutations with
 * query invalidation for both the detail view and the catalog.
 */
export function useProvider(providerId: string) {
    const queryClient = useQueryClient();

    const query = useQuery({
        queryKey: ["providers", providerId],
        queryFn: () => api.get<ProviderDefinition>(`/v1/providers/${providerId}`),
    });

    const addMutation = useMutation({
        mutationFn: (payload: AddConnectionPayload) =>
            api.post<ProviderDefinition>("/v1/providers", payload),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: ["providers", providerId] });
            void queryClient.invalidateQueries({ queryKey: ["providers", "catalog"] });
        },
    });

    const deleteMutation = useMutation({
        mutationFn: (connectionId: string) =>
            api.delete<{ message: string }>(`/v1/providers/${connectionId}`),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: ["providers", providerId] });
            void queryClient.invalidateQueries({ queryKey: ["providers", "catalog"] });
        },
    });

    return { ...query, addMutation, deleteMutation };
}
