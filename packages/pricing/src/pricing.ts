import { loadPricingData } from "./parser.js";
import { findCanonicalModelKey, normalizeModelName } from "./matcher.js";
import type { ModelPrice, PricingDataset } from "./types.js";

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
 * Canonical model pricing table loaded from pricing.jsonc / pricing.json.
 */
export const MODEL_PRICING: Record<string, ModelPrice> = loadedDataset.models;

/**
 * Provider-grouped model pricing list loaded from pricing.jsonc / pricing.json.
 */
export const PROVIDER_MODELS = loadedDataset.providerModels;

/**
 * Model aliases map loaded from pricing.jsonc / pricing.json.
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
 * Formats cost for display (e.g. "$0.00").
 */
export function formatCost(cost: number): string {
    if (cost === null || cost === undefined || isNaN(cost)) return "$0.00";
    return `$${cost.toFixed(2)}`;
}
