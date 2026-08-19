import type { ModelObject } from "@srouter/types";
import { registry } from "@/services/registry.js";

export class ModelsLogic {
    public static async getAllModels(
        provider?: string,
        forceRefresh = false
    ): Promise<ModelObject[]> {
        return await registry.listAllModels(provider, forceRefresh);
    }

    public static async getModelById(
        modelId: string,
        forceRefresh = false
    ): Promise<ModelObject | undefined> {
        if (!modelId) return undefined;
        const models = await registry.listAllModels(undefined, forceRefresh);

        const cleanId = modelId.replace(/^srouter\//, "");

        // Direct match or clean / prefix match
        const match = models.find(
            (m) =>
                m.id === modelId ||
                m.id === cleanId ||
                m.id.replace(/^srouter\//, "") === cleanId ||
                m.id.endsWith(`/${cleanId}`) ||
                cleanId.endsWith(`/${m.id}`)
        );
        return match;
    }

    public static refreshModels(forceRefresh = false): Promise<ModelObject[]> {
        return registry.refreshModels(forceRefresh);
    }

    public static clearCache(providerId?: string): void {
        registry.clearModelsCache(providerId);
    }
}
