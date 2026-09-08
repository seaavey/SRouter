import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
    ModelPrice,
    ModelsDevModel,
    PricingDataset,
    ProviderModelMap
} from "./types.js";

/**
 * Strips single-line (// ...) and multi-line (/ * ... * /) comments
 * and removes trailing commas from a JSONC string while safely preserving string literals and URLs.
 */
export function stripJsonComments(jsonc: string): string {
    let insideString = false;
    let isEscaped = false;
    let output = "";
    let i = 0;

    while (i < jsonc.length) {
        const char = jsonc[i]!;
        const nextChar = jsonc[i + 1];

        if (insideString) {
            output += char;
            if (isEscaped) {
                isEscaped = false;
            } else if (char === "\\") {
                isEscaped = true;
            } else if (char === '"') {
                insideString = false;
            }
            i++;
            continue;
        }

        if (char === '"') {
            insideString = true;
            output += char;
            i++;
            continue;
        }

        // Single line comment: // ...
        if (char === "/" && nextChar === "/") {
            i += 2;
            while (i < jsonc.length && jsonc[i] !== "\n" && jsonc[i] !== "\r") {
                i++;
            }
            continue;
        }

        // Multi line comment: /* ... */
        if (char === "/" && nextChar === "*") {
            i += 2;
            while (i < jsonc.length && !(jsonc[i] === "*" && jsonc[i + 1] === "/")) {
                i++;
            }
            i += 2;
            continue;
        }

        output += char;
        i++;
    }

    return output.replace(/,(\s*[}\]])/g, "$1");
}

/**
 * Parses a JSONC formatted string into a JavaScript object.
 */
export function parseJsonc<T>(jsonc: string): T {
    const cleanJson = stripJsonComments(jsonc);
    return JSON.parse(cleanJson) as T;
}

/**
 * Flattens models whether they are grouped by provider arrays,
 * nested dictionaries, or flat dictionaries into a canonical Record<string, ModelPrice>.
 */
export function flattenModelPrices(
    models: ProviderModelMap | Record<string, ModelPrice>
): Record<string, ModelPrice> {
    const flat: Record<string, ModelPrice> = {};
    for (const [key, val] of Object.entries(models || {})) {
        if (Array.isArray(val)) {
            for (const item of val) {
                if (item && item.id) {
                    flat[item.id] = item;
                }
            }
        } else if (val && typeof val === "object") {
            if ("input" in val && "output" in val) {
                flat[key] = val as ModelPrice;
            } else {
                for (const [subKey, subVal] of Object.entries(val)) {
                    flat[subKey] = subVal as ModelPrice;
                }
            }
        }
    }
    return flat;
}

/**
 * Finds the models.dev pricing dataset.
 */
export function resolvePricingDataPath(customPath?: string): string {
    if (customPath) return customPath;

    const currentDir = path.dirname(fileURLToPath(import.meta.url));

    const candidates = [
        path.resolve(currentDir, "../pricing.jsonc"),
        path.resolve(currentDir, "../../pricing.jsonc"),
        path.resolve(process.cwd(), "packages/pricing/pricing.jsonc"),
        path.resolve(process.cwd(), "pricing.jsonc")
    ];

    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }

    return candidates[0]!;
}

/**
 * Converts a ModelsDevModel into a ModelPrice if valid cost data is present.
 */
export function modelsDevToModelPrice(model: ModelsDevModel): ModelPrice | undefined {
    if (!model.cost) return undefined;
    const input = model.cost.input ?? 0;
    const output = model.cost.output ?? 0;

    return {
        id: model.id,
        name: model.name,
        input,
        output,
        cached: model.cost.cache_read,
        reasoning: model.cost.reasoning ?? output,
        cache_creation: model.cost.cache_write ?? input
    };
}

/**
 * Loads pricing directly from pricing.jsonc.
 * Populates models map, aliases, and provider-grouped models.
 */
export function loadPricingFromModelsDev(customPath?: string): PricingDataset {
    const modelsData = loadModelsDevData(customPath);
    const models: Record<string, ModelPrice> = {};
    const providerModels: ProviderModelMap = {};
    const aliases: Record<string, string> = {};

    for (const [key, item] of Object.entries(modelsData)) {
        const price = modelsDevToModelPrice(item);
        if (!price) continue;

        // 1. Map by full key e.g. "tencent/hy3" and item.id
        models[key] = price;
        if (item.id && item.id !== key) {
            models[item.id] = price;
        }

        // 2. Map by model name after provider prefix: <provider>/<model> -> <model>
        if (key.includes("/")) {
            const modelName = key.split("/").slice(1).join("/");
            // Jika belum terdefinisi di models, daftarkan alias dan fallback model price
            if (!aliases[modelName]) {
                aliases[modelName] = key;
            }
            if (!models[modelName]) {
                models[modelName] = price;
            }
        }

        // Group into providerModels
        const provider = key.includes("/") ? key.split("/")[0]! : "other";
        if (!providerModels[provider]) {
            providerModels[provider] = [];
        }
        providerModels[provider].push(price);
    }

    return {
        version: "1.0.0",
        updatedAt: new Date().toISOString().split("T")[0],
        defaults: {
            input: 2.0,
            output: 8.0,
            cached: 1.0,
            reasoning: 12.0,
            cache_creation: 2.0
        },
        models,
        providerModels,
        aliases
    };
}

/**
 * Loads and parses the models.dev pricing dataset.
 */
export function loadPricingData(customPath?: string): PricingDataset {
    const filePath = resolvePricingDataPath(customPath);
    if (!fs.existsSync(filePath)) {
        throw new Error(`Pricing dataset file not found at: ${filePath}`);
    }
    return loadPricingFromModelsDev(filePath);
}

/**
 * Finds the pricing.jsonc data file sourced from models.dev.
 */
export function resolveModelsDevDataPath(customPath?: string): string {
    if (customPath) {
        if (path.isAbsolute(customPath)) {
            return customPath;
        }
        return path.resolve(process.cwd(), customPath);
    }

    const currentDir = path.dirname(fileURLToPath(import.meta.url));

    const candidates = [
        path.resolve(currentDir, "../pricing.jsonc"),
        path.resolve(currentDir, "../../pricing.jsonc"),
        path.resolve(process.cwd(), "packages/pricing/pricing.jsonc"),
        path.resolve(process.cwd(), "pricing.jsonc")
    ];

    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }

    return candidates[0]!;
}

/**
 * Loads and parses the models.dev dataset from pricing.jsonc.
 */
export function loadModelsDevData(customPath?: string): Record<string, ModelsDevModel> {
    const filePath = resolveModelsDevDataPath(customPath);
    if (!fs.existsSync(filePath)) {
        return {};
    }
    const content = fs.readFileSync(filePath, "utf-8");
    return parseJsonc<Record<string, ModelsDevModel>>(content);
}
