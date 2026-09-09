import { loadModelsDevData } from "@srouter/pricing";
import type { ModelPricingItem, PricingListResponse } from "@srouter/types";

export class PricingLogic {
    private static cachedListResponse: PricingListResponse | null = null;
    private static cachedAt: number = 0;
    private static readonly CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour memory TTL

    public static getPricingList(forceRefresh: boolean = false): PricingListResponse {
        const now = Date.now();
        if (!forceRefresh && this.cachedListResponse && now - this.cachedAt < this.CACHE_TTL_MS) {
            return this.cachedListResponse;
        }

        const rawData = loadModelsDevData();
        const items: ModelPricingItem[] = [];

        for (const [key, model] of Object.entries(rawData)) {
            if (!model || typeof model !== "object" || !model.id) continue;

            const cost = model.cost;

            const parts = key.split("/");
            const provider = parts.length > 1 ? parts[0] : (model.family || "other");

            items.push({
                id: model.id,
                name: model.name || model.id,
                description: model.description,
                family: model.family,
                provider,
                attachment: model.attachment,
                reasoning: model.reasoning,
                tool_call: model.tool_call,
                temperature: model.temperature,
                structured_output: model.structured_output,
                open_weights: model.open_weights,
                knowledge: model.knowledge,
                release_date: model.release_date,
                last_updated: model.last_updated,
                cost: {
                    input: cost?.input,
                    output: cost?.output,
                    cache_read: cost?.cache_read,
                    cache_write: cost?.cache_write,
                    reasoning: cost?.reasoning,
                    input_audio: cost?.input_audio,
                    output_audio: cost?.output_audio
                },
                limit: model.limit
                    ? {
                          context: model.limit.context,
                          output: model.limit.output
                      }
                    : undefined,
                modalities: model.modalities
                    ? {
                          input: model.modalities.input,
                          output: model.modalities.output
                      }
                    : undefined
            });
        }

        // Sort items by provider, then name
        items.sort((a, b) => {
            const providerCompare = (a.provider || "").localeCompare(b.provider || "");
            if (providerCompare !== 0) return providerCompare;
            return a.name.localeCompare(b.name);
        });

        this.cachedListResponse = {
            object: "list",
            total: items.length,
            updated_at: new Date().toISOString(),
            data: items
        };
        this.cachedAt = now;

        return this.cachedListResponse;
    }
}
