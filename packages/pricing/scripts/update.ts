import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MODELS_DEV_URL = "https://models.dev/models.json";

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
    [key: string]: unknown;
}

async function updateModelsDevData() {
    console.log(`[pricing] Fetching latest models from ${MODELS_DEV_URL}...`);
    const response = await fetch(MODELS_DEV_URL, {
        headers: {
            "User-Agent": "SRouter-Pricing-Updater/1.0"
        }
    });

    if (!response.ok) {
        throw new Error(`Failed to fetch models.json: ${response.status} ${response.statusText}`);
    }

    const rawData = (await response.json()) as Record<string, RawModelDevEntry>;
    const totalRaw = Object.keys(rawData).length;
    console.log(`[pricing] Received ${totalRaw} models. Filtering essential fields...`);

    const filtered: Record<string, Record<string, unknown>> = {};

    for (const [key, model] of Object.entries(rawData)) {
        if (!model || typeof model !== "object" || !model.id) continue;

        // Keep only essential, valuable fields (strip heavy benchmarks, raw weights, etc.)
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
    const targetFile = path.resolve(currentDir, "../models.jsonc");

    const header = "// Source by models.dev\n// Source: https://models.dev\n";
    const jsonContent = JSON.stringify(filtered, null, 2);

    fs.writeFileSync(targetFile, header + jsonContent + "\n", "utf-8");
    console.log(`[pricing] ✓ Saved ${Object.keys(filtered).length} models to ${targetFile}`);
}

updateModelsDevData().catch((err) => {
    console.error("[pricing] ✖ Error updating models:", err);
    process.exit(1);
});
