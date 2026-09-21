import type { ModelObject } from "@srouter/types";
import { getAllCustomModelsDB, getAllFallbackRulesDB, getAllHiddenModelsDB } from "@srouter/db";
import { providerAlias, providerBaseId } from "@srouter/constants";
import { registry } from "@/services/registry.js";

export class ModelsLogic {
    public static async GetAllModels(
        Provider?: string,
        ForceRefresh = false
    ): Promise<ModelObject[]> {
        const Models = await registry.listAllModels(Provider, ForceRefresh);
        const MergedModels = await this.MergeCustomModels(Models, Provider);
        const ModelsWithCombos = await this.MergeComboModels(MergedModels);
        return this.FilterHiddenModels(ModelsWithCombos);
    }

    private static async FilterHiddenModels(Models: ModelObject[]): Promise<ModelObject[]> {
        const HiddenRows = await getAllHiddenModelsDB();
        if (HiddenRows.length === 0) return Models;

        const HiddenIds = new Set(HiddenRows.map((Row) => Row.modelId.toLowerCase()));
        return Models.filter((Model) => !HiddenIds.has(Model.id.toLowerCase()));
    }

    private static async MergeComboModels(Models: ModelObject[]): Promise<ModelObject[]> {
        const Rules = (await getAllFallbackRulesDB()).filter((Rule) => Rule.enabled);
        if (Rules.length === 0) return Models;

        const Merged = new Map<string, ModelObject>();

        for (const Model of Models) {
            Merged.set(Model.id.toLowerCase(), Model);
        }

        const ComboModels = new Set<string>();

        for (const Rule of Rules) {
            const SourceModel = Rule.sourceModel.trim();

            if (!SourceModel || SourceModel === "*" || SourceModel.endsWith("/*")) {
                continue;
            }

            ComboModels.add(SourceModel);
        }

        for (const ComboModel of ComboModels) {
            const VirtualModelId = ComboModel.startsWith("srouter/")
                ? ComboModel
                : `srouter/${ComboModel}`;

            Merged.set(ComboModel.toLowerCase(), {
                id: VirtualModelId,
                object: "model",
                owned_by: "srouter",
                custom: true
            });
        }

        return Array.from(Merged.values());
    }

    private static async MergeCustomModels(
        Models: ModelObject[],
        ProviderFilter?: string
    ): Promise<ModelObject[]> {
        const Rows = await getAllCustomModelsDB();
        if (Rows.length === 0) return Models;

        const Merged = new Map<string, ModelObject>();
        for (const M of Models) {
            Merged.set(M.id.toLowerCase(), M);
        }
        for (const Row of Rows) {
            if (!registry.isProviderEnabled(Row.providerId)) continue;
            const Alias = this.AliasForProviderId(Row.providerId);
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

    /**
     * Resolve the human-facing model prefix for a provider id. Custom providers
     * carry UUID ids whose base identity is the UUID itself, so the runtime
     * alias (registered executor's alias) must win over the built-in alias
     * lookup, which would otherwise echo the UUID back as the model prefix.
     */
    private static AliasForProviderId(ProviderId: string): string {
        const Registered = registry.getAllProviders().get(ProviderId);
        if (Registered?.alias) return Registered.alias;
        return providerAlias(providerBaseId(ProviderId));
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
