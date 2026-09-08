import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MODELS_DEV_URL = "https://models.dev/models.json";
const MODELS_DEV_API_URL = "https://models.dev/api.json";

interface RawModelDevEntry {
    id: string;
    name: string;
    description?: string;
    family?: string;
    attachment?: boolean;
    reasoning?: boolean;
    tool_call?: boolean;
    temperature?: boolean;
    structured_output?: boolean;
    open_weights?: boolean;
    modalities?: {
        input?: string[];
        output?: string[];
    };
    limit?: {
        context?: number;
        output?: number;
    };
    knowledge?: string;
    release_date?: string;
    last_updated?: string;
    cost?: {
        input?: number;
        output?: number;
        cache_read?: number;
        cache_write?: number;
        reasoning?: number;
        input_audio?: number;
        output_audio?: number;
        [key: string]: unknown;
    };
    [key: string]: unknown;
}

interface ProviderEntry {
    id: string;
    name?: string;
    models?: Record<string, RawModelDevEntry>;
}

async function updateModelsDevData() {
    console.log(`[pricing] Fetching models list from ${MODELS_DEV_URL}...`);
    const [modelsResp, apiResp] = await Promise.all([
        fetch(MODELS_DEV_URL, {
            headers: { "User-Agent": "SRouter-Pricing-Updater/1.0" }
        }),
        fetch(MODELS_DEV_API_URL, {
            headers: { "User-Agent": "SRouter-Pricing-Updater/1.0" }
        })
    ]);

    if (!modelsResp.ok) {
        throw new Error(`Failed to fetch models.json: ${modelsResp.status} ${modelsResp.statusText}`);
    }
    if (!apiResp.ok) {
        throw new Error(`Failed to fetch api.json: ${apiResp.status} ${apiResp.statusText}`);
    }

    const rawModelsData = (await modelsResp.json()) as Record<string, RawModelDevEntry>;
    const rawApiData = (await apiResp.json()) as Record<string, ProviderEntry>;

    // Index costs from api.json by model ID and provider
    // providerId -> modelKey -> cost
    // also fallback index by modelKey -> list of costs
    const providerCosts: Record<string, Record<string, RawModelDevEntry["cost"]>> = {};
    const globalModelCosts: Record<string, Array<{ provider: string; cost: RawModelDevEntry["cost"] }>> = {};

    for (const [providerId, providerData] of Object.entries(rawApiData)) {
        if (!providerData || typeof providerData !== "object" || !providerData.models) continue;
        providerCosts[providerId] = {};

        for (const [mKey, mVal] of Object.entries(providerData.models)) {
            if (mVal?.cost) {
                providerCosts[providerId][mKey] = mVal.cost;
                if (!globalModelCosts[mKey]) {
                    globalModelCosts[mKey] = [];
                }
                globalModelCosts[mKey].push({ provider: providerId, cost: mVal.cost });
            }
        }
    }

    console.log(`[pricing] Filtering and merging pricing data for ${Object.keys(rawModelsData).length} models...`);

    const filtered: Record<string, Record<string, unknown>> = {};

    for (const [key, model] of Object.entries(rawModelsData)) {
        if (!model || typeof model !== "object" || !model.id) continue;

        // Resolve cost
        const parts = key.split("/");
        const providerPrefix = parts.length > 1 ? parts[0] : undefined;
        const modelShortName = parts.length > 1 ? parts.slice(1).join("/") : key;

        let resolvedCost = model.cost;

        if (!resolvedCost) {
            // 1. Try matching provider prefix directly
            if (providerPrefix && providerCosts[providerPrefix]) {
                resolvedCost = providerCosts[providerPrefix][modelShortName] || providerCosts[providerPrefix][key];
            }

            // 2. Try global model cost index
            if (!resolvedCost) {
                const candidates = globalModelCosts[key] || globalModelCosts[modelShortName] || [];
                if (candidates.length > 0) {
                    // Prefer canonical providers
                    const canonical = candidates.find((c) =>
                        ["openai", "anthropic", "google", "deepseek", "mistral", "cohere", "qwen", "minimax", "xai"].includes(c.provider)
                    );
                    resolvedCost = canonical ? canonical.cost : candidates[0]?.cost;
                }
            }
        }

        const entry: Record<string, unknown> = {
            id: model.id,
            name: model.name || model.id
        };

        if (model.description) entry.description = model.description;
        if (model.family) entry.family = model.family;
        if (model.attachment !== undefined) entry.attachment = Boolean(model.attachment);
        if (model.reasoning !== undefined) entry.reasoning = Boolean(model.reasoning);
        if (model.tool_call !== undefined) entry.tool_call = Boolean(model.tool_call);
        if (model.temperature !== undefined) entry.temperature = Boolean(model.temperature);
        if (model.structured_output !== undefined) entry.structured_output = Boolean(model.structured_output);
        if (model.open_weights !== undefined) entry.open_weights = Boolean(model.open_weights);

        if (resolvedCost) {
            const cleanCost: Record<string, number> = {};
            if (typeof resolvedCost.input === "number") cleanCost.input = resolvedCost.input;
            if (typeof resolvedCost.output === "number") cleanCost.output = resolvedCost.output;
            if (typeof resolvedCost.cache_read === "number") cleanCost.cache_read = resolvedCost.cache_read;
            if (typeof resolvedCost.cache_write === "number") cleanCost.cache_write = resolvedCost.cache_write;
            if (typeof resolvedCost.reasoning === "number") cleanCost.reasoning = resolvedCost.reasoning;
            if (typeof resolvedCost.input_audio === "number") cleanCost.input_audio = resolvedCost.input_audio;
            if (typeof resolvedCost.output_audio === "number") cleanCost.output_audio = resolvedCost.output_audio;

            if (Object.keys(cleanCost).length > 0) {
                entry.cost = cleanCost;
            }
        }

        if (model.limit && (model.limit.context || model.limit.output)) {
            entry.limit = {
                ...(model.limit.context !== undefined && { context: model.limit.context }),
                ...(model.limit.output !== undefined && { output: model.limit.output })
            };
        }

        if (model.modalities) {
            entry.modalities = model.modalities;
        }

        if (model.knowledge) entry.knowledge = model.knowledge;
        if (model.release_date) entry.release_date = model.release_date;
        if (model.last_updated) entry.last_updated = model.last_updated;

        filtered[key] = entry;
    }

    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    const targetFile = path.resolve(currentDir, "../pricing.jsonc");

    const header = "// Source by models.dev\n// Source: https://models.dev\n";
    const jsonContent = JSON.stringify(filtered);

    fs.writeFileSync(targetFile, header + jsonContent + "\n", "utf-8");
    console.log(`[pricing] ✓ Saved ${Object.keys(filtered).length} models with pricing info to ${targetFile}`);
}

updateModelsDevData().catch((err) => {
    console.error("[pricing] ✖ Error updating models:", err);
    process.exit(1);
});
