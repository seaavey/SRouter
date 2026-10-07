import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { toast } from "sonner";
import type { CatalogModel, ProviderEntry, ProviderProtocol } from "@/generated/api";
import type { CreateProviderZod } from "@srouter/types";

export type AddConnectionPayload = Pick<
    CreateProviderZod,
    "id" | "name" | "category" | "protocol" | "base_url" | "api_key"
>;

const EMPTY_HIDDEN_MODELS: string[] = [];

/**
 * Loads a provider definition and exposes add/delete connection mutations with
 * query invalidation for both the detail view and the catalog.
 */
export function useProvider(providerId: string) {
    const queryClient = useQueryClient();

    const query = useQuery({
        queryKey: ["providers", providerId],
        queryFn: () => api.get<ProviderEntry>(`/v1/providers/${providerId}`),
        enabled: Boolean(providerId)
    });

    const hiddenModelsQuery = useQuery({
        queryKey: ["providers", providerId, "hidden-models"],
        queryFn: async () => {
            // The provider detail already carries `hidden` per model, so the read
            // side needs no separate listing route.
            const provider = await api.get<ProviderEntry>(`/v1/providers/${providerId}`);
            const models = provider.models
                .filter((model) => model.hidden === true)
                .map((model) => model.id);
            if (models.length > 0 || typeof window === "undefined") return { models };

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
                await api.patch(`/v1/models/${encodeURIComponent(modelId)}`, { hidden: true });
            }
            if (legacyModels.length > 0) localStorage.removeItem(legacyKey);
            return { models: legacyModels };
        },
        enabled: Boolean(providerId)
    });

    const addMutation = useMutation({
        mutationFn: (payload: AddConnectionPayload) =>
            api.post<ProviderEntry>("/v1/providers", payload),
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
            api.patch<ProviderEntry>(`/v1/providers/${providerId}/round-robin`, { enabled }),
        onSuccess: (data) => {
            void queryClient.invalidateQueries({ queryKey: ["providers", providerId] });
            void queryClient.invalidateQueries({ queryKey: ["providers", "catalog"] });
            toast.success(
                data.round_robin
                    ? "Round-robin load balancing enabled"
                    : "Round-robin load balancing disabled"
            );
        },
        onError: (err: Error) => {
            toast.error(err.message || "Failed to update round-robin mode");
        }
    });

    const toggleProviderMutation = useMutation({
        mutationFn: (enabled: boolean) =>
            api.patch<ProviderEntry>(`/v1/providers/${providerId}`, { enabled }),
        onSuccess: (data) => {
            void queryClient.invalidateQueries({ queryKey: ["providers", providerId] });
            void queryClient.invalidateQueries({ queryKey: ["providers", "catalog"] });
            void queryClient.invalidateQueries({ queryKey: ["models"] });
            toast.success(data.enabled ? "Provider enabled" : "Provider disabled");
        },
        onError: (err: Error) => toast.error(err.message || "Failed to toggle provider")
    });

    const addModelMutation = useMutation({
        mutationFn: (modelId: string) =>
            api.post<CatalogModel>("/v1/models", { model_id: modelId }),
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
            api.delete<{ deleted: boolean }>(`/v1/models/${encodeURIComponent(modelId)}`),
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
            api.patch(`/v1/models/${encodeURIComponent(modelId)}`, { hidden: true }),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: ["providers", providerId] });
            void queryClient.invalidateQueries({
                queryKey: ["providers", providerId, "hidden-models"]
            });
        }
    });

    const restoreModelMutation = useMutation({
        mutationFn: (modelId: string) =>
            api.patch(`/v1/models/${encodeURIComponent(modelId)}`, { hidden: false }),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: ["providers", providerId] });
            void queryClient.invalidateQueries({
                queryKey: ["providers", providerId, "hidden-models"]
            });
        }
    });

    const hideModelsMutation = useMutation({
        mutationFn: async (modelIds: string[]) => {
            await Promise.all(
                modelIds.map((modelId) =>
                    api.patch(`/v1/models/${encodeURIComponent(modelId)}`, { hidden: true })
                )
            );
            return modelIds;
        },
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: ["providers", providerId] });
            void queryClient.invalidateQueries({
                queryKey: ["providers", providerId, "hidden-models"]
            });
        }
    });

    const restoreModelsMutation = useMutation({
        mutationFn: async (modelIds: string[]) => {
            await Promise.all(
                modelIds.map((modelId) =>
                    api.patch(`/v1/models/${encodeURIComponent(modelId)}`, { hidden: false })
                )
            );
            return modelIds;
        },
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
        toggleProviderMutation,
        addModelMutation,
        deleteModelMutation,
        hideModelMutation,
        restoreModelMutation,
        hideModelsMutation,
        restoreModelsMutation
    };
}
