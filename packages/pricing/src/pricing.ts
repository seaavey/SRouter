import { loadModelsDevData, loadPricingData } from "./parser.js";
import { findCanonicalModelKey, normalizeModelName } from "./matcher.js";
import type { ModelPrice, ModelsDevModel, PricingDataset } from "./types.js";

export * from "./types.js";
export * from "./parser.js";
export * from "./matcher.js";

/** Default pricing fallback when the dataset fails to load or model isn't in catalog */
const EMBEDDED_DEFAULT_PRICING: ModelPrice = {
    input: 2.0,
    output: 8.0,
    cached: 1.0,
    reasoning: 12.0,
    cache_creation: 2.0
};

let loadedDataset: PricingDataset;
try {
    loadedDataset = loadPricingData();
} catch {
    loadedDataset = {
        defaults: EMBEDDED_DEFAULT_PRICING,
        models: {},
        aliases: {}
    };
}

/**
 * Default fallback pricing when model isn't found in catalog.
 */
export const DEFAULT_PRICING: ModelPrice = loadedDataset.defaults || EMBEDDED_DEFAULT_PRICING;

/**
 * Canonical model pricing table loaded from pricing.jsonc.
 */
export const MODEL_PRICING: Record<string, ModelPrice> = loadedDataset.models;

/**
 * Provider-grouped model pricing list loaded from pricing.jsonc.
 */
export const PROVIDER_MODELS = loadedDataset.providerModels;

/**
 * Model aliases map loaded from pricing.jsonc.
 */
export const MODEL_ALIASES: Record<string, string> = loadedDataset.aliases;

/** Default free tier pricing (zero cost across all token types) */
export const FREE_PRICING: ModelPrice = {
    input: 0,
    output: 0,
    cached: 0,
    reasoning: 0,
    cache_creation: 0
};

/**
 * Resolves pricing for a model by normalizing prefixes ("commandcode/deepseek/deepseek-v4-flash"
 * or "deepseek/deepseek-v4-flash" -> "deepseek-v4-flash") and checking aliases.
 * If the model name explicitly indicates a free tier (e.g. contains 'free'), returns 0 cost.
 * Falls back to DEFAULT_PRICING for unknown models.
 */
export function getPricingForModel(_provider: string | undefined, model: string): ModelPrice {
    if (!model) return DEFAULT_PRICING;

    // Check if the raw model name or normalized name explicitly specifies "free"
    const lower = model.toLowerCase();
    if (
        /(?:^|[/:._-])free(?:[/:._-]|$)/i.test(lower) ||
        lower.endsWith(":free") ||
        lower.includes("/free") ||
        lower === "free"
    ) {
        return FREE_PRICING;
    }

    const matchedKey = findCanonicalModelKey(model, MODEL_PRICING, MODEL_ALIASES);
    if (matchedKey && MODEL_PRICING[matchedKey]) {
        return MODEL_PRICING[matchedKey]!;
    }

    return DEFAULT_PRICING;
}

let cachedModelsDevData: Record<string, ModelsDevModel> | undefined;

/**
 * Retrieves comprehensive metadata (modalities, limits, capabilities) for a model
 * by resolving aliases and canonical keys from pricing.jsonc.
 */
export function getModelMetadata(modelId: string): ModelsDevModel | undefined {
    if (!modelId) return undefined;
    if (!cachedModelsDevData) {
        try {
            cachedModelsDevData = loadModelsDevData();
        } catch {
            cachedModelsDevData = {};
        }
    }

    const data = cachedModelsDevData;

    // 1. Direct key match
    if (data[modelId]) {
        return data[modelId];
    }

    // 2. Canonical / Normalized match using pricing aliases and catalog
    const canonical =
        findCanonicalModelKey(modelId, MODEL_PRICING, MODEL_ALIASES) ||
        normalizeModelName(modelId, MODEL_ALIASES);

    if (canonical && data[canonical]) {
        return data[canonical];
    }

    // 3. Search modelsDevData by suffix or id match
    const targetSuffix = `/${canonical}`;
    for (const [key, item] of Object.entries(data)) {
        if (
            key === canonical ||
            key.endsWith(targetSuffix) ||
            item.id === canonical ||
            item.id.endsWith(targetSuffix)
        ) {
            return item;
        }
    }

    return undefined;
}

/**
 * Calculates cost in dollars from token counts and pricing rates.
 * prompt_tokens is cache-inclusive: cached + cache_creation are subsets,
 * so subtract both to avoid charging them at the full input rate.
 */
export function calculateCostFromTokens(
    tokens: {
        prompt_tokens?: number;
        input_tokens?: number;
        completion_tokens?: number;
        output_tokens?: number;
        cached_tokens?: number;
        cache_read_input_tokens?: number;
        cache_creation_input_tokens?: number;
        reasoning_tokens?: number;
    },
    pricing: ModelPrice
): number {
    if (!tokens || !pricing) return 0;

    let cost = 0;

    const inputTokens = tokens.prompt_tokens || tokens.input_tokens || 0;
    const cachedTokens = tokens.cached_tokens || tokens.cache_read_input_tokens || 0;
    const cacheCreationTokens = tokens.cache_creation_input_tokens || 0;
    const nonCachedInput = Math.max(0, inputTokens - cachedTokens - cacheCreationTokens);

    cost += nonCachedInput * (pricing.input / 1_000_000);

    if (cachedTokens > 0) {
        cost += cachedTokens * ((pricing.cached ?? pricing.input) / 1_000_000);
    }

    const outputTokens = tokens.completion_tokens || tokens.output_tokens || 0;
    cost += outputTokens * (pricing.output / 1_000_000);

    const reasoningTokens = tokens.reasoning_tokens || 0;
    if (reasoningTokens > 0) {
        cost += reasoningTokens * ((pricing.reasoning ?? pricing.output) / 1_000_000);
    }

    if (cacheCreationTokens > 0) {
        cost += cacheCreationTokens * ((pricing.cache_creation ?? pricing.input) / 1_000_000);
    }

    return cost;
}

/**
 * Calculates itemized cost breakdown (input, output, cacheRead, cacheCreation, total)
 * in dollars from token counts and pricing rates.
 */
export function calculateCostBreakdownFromTokens(
    tokens: {
        prompt_tokens?: number;
        input_tokens?: number;
        completion_tokens?: number;
        output_tokens?: number;
        cached_tokens?: number;
        cache_read_input_tokens?: number;
        cache_creation_input_tokens?: number;
        reasoning_tokens?: number;
    },
    pricing: ModelPrice
): {
    inputCost: number;
    outputCost: number;
    cacheReadCost: number;
    cacheCreationCost: number;
    totalCost: number;
} {
    if (!tokens || !pricing) {
        return {
            inputCost: 0,
            outputCost: 0,
            cacheReadCost: 0,
            cacheCreationCost: 0,
            totalCost: 0
        };
    }

    const inputTokens = tokens.prompt_tokens || tokens.input_tokens || 0;
    const cachedTokens = tokens.cached_tokens || tokens.cache_read_input_tokens || 0;
    const cacheCreationTokens = tokens.cache_creation_input_tokens || 0;
    const nonCachedInput = Math.max(0, inputTokens - cachedTokens - cacheCreationTokens);

    const inputCost = nonCachedInput * (pricing.input / 1_000_000);
    const cacheReadCost =
        cachedTokens > 0
            ? cachedTokens * ((pricing.cached ?? pricing.input) / 1_000_000)
            : 0;
    const cacheCreationCost =
        cacheCreationTokens > 0
            ? cacheCreationTokens * ((pricing.cache_creation ?? pricing.input) / 1_000_000)
            : 0;

    const outputTokens = tokens.completion_tokens || tokens.output_tokens || 0;
    const reasoningTokens = tokens.reasoning_tokens || 0;
    let outputCost = outputTokens * (pricing.output / 1_000_000);
    if (reasoningTokens > 0) {
        outputCost += reasoningTokens * ((pricing.reasoning ?? pricing.output) / 1_000_000);
    }

    const totalCost = inputCost + cacheReadCost + cacheCreationCost + outputCost;

    return {
        inputCost,
        outputCost,
        cacheReadCost,
        cacheCreationCost,
        totalCost
    };
}

/**
 * Checks whether a given model supports image generation (and optionally img2img input),
 * querying metadata directly from pricing.jsonc.
 */
export function isImageGenerationSupported(model: string, hasInputImage: boolean = false): boolean {
    if (!model) return false;

    const metadata = getModelMetadata(model);
    if (metadata?.modalities?.output) {
        const outputSupportsImage = metadata.modalities.output.includes("image");
        if (!outputSupportsImage) return false;

        if (hasInputImage && metadata.modalities.input) {
            return metadata.modalities.input.includes("image");
        }
        return true;
    }

    return false;
}

/**
 * Formats cost for display (e.g. "$0.00").
 */
export function formatCost(cost: number): string {
    if (cost === null || cost === undefined || isNaN(cost)) return "$0.00";
    return `$${cost.toFixed(2)}`;
}
