import { db } from "./db.js";
import { num, str } from "./row-utils.js";

export interface CustomModelRow {
    providerId: string;
    modelId: string;
    createdAt: number;
}

export function getAllCustomModelsDB(): CustomModelRow[] {
    const rows = db.prepare("SELECT * FROM custom_models ORDER BY created_at ASC").all();

    return rows.map(mapCustomModelRow);
}

export function getCustomModelsByProviderDB(providerId: string): CustomModelRow[] {
    const rows = db
        .prepare("SELECT * FROM custom_models WHERE provider_id = ? ORDER BY created_at ASC")
        .all(providerId);

    return rows.map(mapCustomModelRow);
}

export function addCustomModelDB(providerId: string, modelId: string): CustomModelRow {
    const createdAt = Date.now();
    db.prepare(
        `INSERT OR IGNORE INTO custom_models (provider_id, model_id, created_at)
         VALUES (?, ?, ?)`
    ).run(providerId, modelId, createdAt);

    return { providerId, modelId, createdAt };
}

export function deleteCustomModelDB(providerId: string, modelId: string): boolean {
    const result = db
        .prepare("DELETE FROM custom_models WHERE provider_id = ? AND model_id = ?")
        .run(providerId, modelId);
    return (result.changes ?? 0) > 0;
}

function mapCustomModelRow(row: Record<string, unknown>): CustomModelRow {
    return {
        providerId: str(row.provider_id),
        modelId: str(row.model_id),
        createdAt: num(row.created_at)
    };
}
