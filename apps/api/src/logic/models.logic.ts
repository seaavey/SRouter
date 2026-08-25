import type { ModelObject } from "@srouter/types";
import { getAllCustomModelsDB } from "@srouter/db";
import { providerAlias, providerBaseId } from "@srouter/constants";
import { registry } from "@/services/registry.js";

export class ModelsLogic {
    public static async GetAllModels(
        Provider?: string,
        ForceRefresh = false
    ): Promise<ModelObject[]> {
        const Models = await registry.listAllModels(Provider, ForceRefresh);
        return this.MergeCustomModels(Models, Provider);
    }

    private static MergeCustomModels(
        Models: ModelObject[],
        ProviderFilter?: string
    ): ModelObject[] {
        const Rows = getAllCustomModelsDB();
        if (Rows.length === 0) return Models;

        const Merged = new Map<string, ModelObject>();
        for (const M of Models) {
            Merged.set(M.id.toLowerCase(), M);
        }
        for (const Row of Rows) {
            const Alias = providerAlias(providerBaseId(Row.providerId));
            const Id = `${Alias}/${Row.modelId}`;
            if (ProviderFilter && !Alias.toLowerCase().startsWith(ProviderFilter.toLowerCase())) {
                continue;
            }
            Merged.set(Id.toLowerCase(), {
                id: Id,
                object: "model",
                owned_by: Alias,
                custom: true
            });
        }
        return Array.from(Merged.values());
    }

    public static async GetModelById(
        ModelId: string,
        ForceRefresh = false
    ): Promise<ModelObject | undefined> {
        if (!ModelId) return undefined;
        const Models = await registry.listAllModels(undefined, ForceRefresh);
        const CleanId = ModelId.replace(/^srouter\//, "");

        return Models.find(
            (M) =>
                M.id.replace(/^srouter\//, "") === CleanId ||
                M.id.endsWith(`/${CleanId}`) ||
                CleanId.endsWith(`/${M.id}`)
        );
    }

    public static RefreshModels(ForceRefresh = false): Promise<ModelObject[]> {
        return registry.refreshModels(ForceRefresh);
    }

    public static ClearCache(ProviderId?: string): void {
        registry.clearModelsCache(ProviderId);
    }
}
