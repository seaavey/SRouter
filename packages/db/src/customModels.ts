import { db } from "./db.js";
import { num, str } from "./row-utils.js";

export interface CustomModelRow {
    providerId: string;
    modelId: string;
    createdAt: number;
}

interface CustomModelDBShape {
    provider_id?: unknown;
    model_id?: unknown;
    created_at?: unknown;
}

export function getAllCustomModelsDB(): CustomModelRow[] {
    const Rows = db.prepare("SELECT * FROM custom_models ORDER BY created_at ASC").all() as CustomModelDBShape[];

    return Rows.map(mapCustomModelRow);
}

export function getCustomModelsByProviderDB(providerId: string): CustomModelRow[] {
    const Rows = db
        .prepare("SELECT * FROM custom_models WHERE provider_id = ? ORDER BY created_at ASC")
        .all(providerId) as CustomModelDBShape[];

    return Rows.map(mapCustomModelRow);
}

export function addCustomModelDB(providerId: string, modelId: string): CustomModelRow {
    const CreatedAt = Date.now();
    db.prepare(
        `INSERT OR IGNORE INTO custom_models (provider_id, model_id, created_at)
         VALUES (?, ?, ?)`
    ).run(providerId, modelId, CreatedAt);

    return { providerId, modelId, createdAt: CreatedAt };
}

export function deleteCustomModelDB(providerId: string, modelId: string): boolean {
    const Result = db
        .prepare("DELETE FROM custom_models WHERE provider_id = ? AND model_id = ?")
        .run(providerId, modelId);
    return num(Result.changes) > 0;
}

function mapCustomModelRow(row: CustomModelDBShape): CustomModelRow {
    return {
        providerId: str(row.provider_id),
        modelId: str(row.model_id),
        createdAt: num(row.created_at)
    };
}
