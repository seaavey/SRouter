import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
    ModelPrice,
    ModelsDevModel,
    PricingDataset,
    ProviderModelMap,
    RawPricingDataset
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
 * Finds the path to pricing.jsonc or pricing.json data file.
 */
export function resolvePricingDataPath(customPath?: string): string {
    if (customPath) return customPath;

    const currentDir = path.dirname(fileURLToPath(import.meta.url));

    const candidates = [
        path.resolve(currentDir, "../data/pricing.jsonc"),
        path.resolve(currentDir, "../data/pricing.json"),
        path.resolve(currentDir, "../../data/pricing.jsonc"),
        path.resolve(currentDir, "../../data/pricing.json"),
        path.resolve(process.cwd(), "packages/pricing/data/pricing.jsonc"),
        path.resolve(process.cwd(), "packages/pricing/data/pricing.json"),
        path.resolve(process.cwd(), "data/pricing.jsonc"),
        path.resolve(process.cwd(), "data/pricing.json")
    ];

    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }

    return candidates[0]!;
}

/**
 * Loads and parses the pricing dataset from pricing.jsonc / pricing.json file.
 */
export function loadPricingData(customPath?: string): PricingDataset {
    const filePath = resolvePricingDataPath(customPath);
    if (!fs.existsSync(filePath)) {
        throw new Error(`Pricing dataset file not found at: ${filePath}`);
    }
    const content = fs.readFileSync(filePath, "utf-8");
    const raw = parseJsonc<RawPricingDataset>(content);
    const flatModels = flattenModelPrices(raw.models);
    const isGroupedArray =
        raw.models &&
        Object.values(raw.models).length > 0 &&
        Array.isArray(Object.values(raw.models)[0]);

    return {
        version: raw.version,
        updatedAt: raw.updatedAt,
        defaults: raw.defaults,
        models: flatModels,
        providerModels: isGroupedArray ? (raw.models as ProviderModelMap) : undefined,
        aliases: raw.aliases || {}
    };
}

/**
 * Finds the path to models.jsonc data file sourced from models.dev.
 */
export function resolveModelsDevDataPath(customPath?: string): string {
    if (customPath) return customPath;

    const currentDir = path.dirname(fileURLToPath(import.meta.url));

    const candidates = [
        path.resolve(currentDir, "../models.jsonc"),
        path.resolve(currentDir, "../models.json"),
        path.resolve(currentDir, "../../models.jsonc"),
        path.resolve(currentDir, "../../models.json"),
        path.resolve(process.cwd(), "packages/pricing/models.jsonc"),
        path.resolve(process.cwd(), "packages/pricing/models.json"),
        path.resolve(process.cwd(), "models.jsonc"),
        path.resolve(process.cwd(), "models.json")
    ];

    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }

    return candidates[0]!;
}

/**
 * Loads and parses the models.dev dataset from models.jsonc.
 */
export function loadModelsDevData(customPath?: string): Record<string, ModelsDevModel> {
    const filePath = resolveModelsDevDataPath(customPath);
    if (!fs.existsSync(filePath)) {
        return {};
    }
    const content = fs.readFileSync(filePath, "utf-8");
    return parseJsonc<Record<string, ModelsDevModel>>(content);
}
