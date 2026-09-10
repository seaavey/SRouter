import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { toast } from "sonner";
import type {
    ModelObject,
    ProviderCategory,
    ProviderDefinition,
    ProviderProtocol
} from "@srouter/types";

export interface AddConnectionPayload {
    id?: string;
    name: string;
    category: ProviderCategory;
    protocol: ProviderProtocol;
    base_url?: string;
    api_key?: string;
}

const EMPTY_HIDDEN_MODELS: string[] = [];

/**
 * Loads a provider definition and exposes add/delete connection mutations with
 * query invalidation for both the detail view and the catalog.
 */
export function useProvider(providerId: string) {
    const queryClient = useQueryClient();

    const query = useQuery({
        queryKey: ["providers", providerId],
        queryFn: () => api.get<ProviderDefinition>(`/v1/providers/${providerId}`),
        enabled: Boolean(providerId)
    });

    const hiddenModelsQuery = useQuery({
        queryKey: ["providers", providerId, "hidden-models"],
        queryFn: async () => {
            const response = await api.get<{ models: string[] }>(
                `/v1/providers/${providerId}/hidden-models`
            );
            if (response.models.length > 0 || typeof window === "undefined") return response;
            const legacyKey = `srouter_deleted_models_${providerId}`;
            let legacyModels: string[] = [];
            try {
                const parsed: unknown = JSON.parse(localStorage.getItem(legacyKey) || "[]");
                if (
                    Array.isArray(parsed) &&
                    parsed.every((id): id is string => typeof id === "string")
                ) {
                    legacyModels = parsed;
                }
            } catch {
                legacyModels = [];
            }
            for (const modelId of legacyModels) {
                await api.post(`/v1/providers/${providerId}/hidden-models`, { model_id: modelId });
            }
            if (legacyModels.length > 0) localStorage.removeItem(legacyKey);
            return { models: legacyModels };
        },
        enabled: Boolean(providerId)
    });

    const addMutation = useMutation({
        mutationFn: (payload: AddConnectionPayload) =>
            api.post<ProviderDefinition>("/v1/providers", payload),
        onSuccess: (_data, variables) => {
            void queryClient.invalidateQueries({ queryKey: ["providers", providerId] });
            void queryClient.invalidateQueries({ queryKey: ["providers", "catalog"] });
            void queryClient.invalidateQueries({ queryKey: ["models"] });
            toast.success(`Connection "${variables.name}" saved successfully`);
        },
        onError: (err: Error) => {
            toast.error(err.message || "Failed to save connection");
        }
    });

    const deleteMutation = useMutation({
        mutationFn: (connectionId: string) =>
            api.delete<{ message: string }>(`/v1/providers/${connectionId}`),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: ["providers", providerId] });
            void queryClient.invalidateQueries({ queryKey: ["providers", "catalog"] });
            void queryClient.invalidateQueries({ queryKey: ["models"] });
            toast.success("Connection deleted successfully");
        },
        onError: (err: Error) => {
            toast.error(err.message || "Failed to delete connection");
        }
    });

    const toggleRoundRobinMutation = useMutation({
        mutationFn: (enabled: boolean) =>
            api.patch<ProviderDefinition>(`/v1/providers/${providerId}/round-robin`, { enabled }),
        onSuccess: (data) => {
            void queryClient.invalidateQueries({ queryKey: ["providers", providerId] });
            void queryClient.invalidateQueries({ queryKey: ["providers", "catalog"] });
            toast.success(
                data.roundRobin
                    ? "Round-robin load balancing enabled"
                    : "Round-robin load balancing disabled"
            );
        },
        onError: (err: Error) => {
            toast.error(err.message || "Failed to update round-robin mode");
        }
    });

    const addModelMutation = useMutation({
        mutationFn: (modelId: string) =>
            api.post<ModelObject>(`/v1/providers/${providerId}/models`, { model_id: modelId }),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: ["providers", providerId] });
            void queryClient.invalidateQueries({ queryKey: ["models"] });
            toast.success("Custom model added");
        },
        onError: (err: Error) => {
            toast.error(err.message || "Failed to add custom model");
        }
    });

    const deleteModelMutation = useMutation({
        mutationFn: (modelId: string) =>
            api.delete<{ message: string }>(
                `/v1/providers/${providerId}/models/${encodeURIComponent(modelId)}`
            ),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: ["providers", providerId] });
            void queryClient.invalidateQueries({ queryKey: ["models"] });
            toast.success("Custom model deleted");
        },
        onError: (err: Error) => {
            toast.error(err.message || "Failed to delete custom model");
        }
    });

    const hideModelMutation = useMutation({
        mutationFn: (modelId: string) =>
            api.post(`/v1/providers/${providerId}/hidden-models`, { model_id: modelId }),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: ["providers", providerId] });
            void queryClient.invalidateQueries({
                queryKey: ["providers", providerId, "hidden-models"]
            });
        }
    });

    const restoreModelMutation = useMutation({
        mutationFn: (modelId: string) =>
            api.delete(`/v1/providers/${providerId}/hidden-models/${encodeURIComponent(modelId)}`),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: ["providers", providerId] });
            void queryClient.invalidateQueries({
                queryKey: ["providers", providerId, "hidden-models"]
            });
        }
    });

    return {
        ...query,
        hiddenModelIds: hiddenModelsQuery.data?.models ?? EMPTY_HIDDEN_MODELS,
        addMutation,
        deleteMutation,
        toggleRoundRobinMutation,
        addModelMutation,
        deleteModelMutation,
        hideModelMutation,
        restoreModelMutation
    };
}
