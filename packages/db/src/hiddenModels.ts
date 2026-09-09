import { db, isPostgres } from "./db.js";
import { num, str } from "./row-utils.js";

export interface HiddenModelRow {
    providerId: string;
    modelId: string;
    createdAt: number;
}

interface HiddenModelDBShape {
    provider_id: string;
    model_id: string;
    created_at: number;
}

export async function getHiddenModelsByProviderDB(providerId: string): Promise<HiddenModelRow[]> {
    const Rows = (await db
        .prepare("SELECT * FROM hidden_models WHERE provider_id = ? ORDER BY created_at ASC")
        .all(providerId)) as unknown as HiddenModelDBShape[];
    return Rows.map(mapHiddenModelRow);
}

export async function addHiddenModelDB(providerId: string, modelId: string): Promise<HiddenModelRow> {
    const CreatedAt = Date.now();
    const Sql = isPostgres()
        ? `INSERT INTO hidden_models (provider_id, model_id, created_at)
           VALUES (?, ?, ?)
           ON CONFLICT (provider_id, model_id) DO NOTHING`
        : `INSERT OR IGNORE INTO hidden_models (provider_id, model_id, created_at)
           VALUES (?, ?, ?)`;
    await db.prepare(Sql).run(providerId, modelId, CreatedAt);
    return { providerId, modelId, createdAt: CreatedAt };
}

export async function deleteHiddenModelDB(providerId: string, modelId: string): Promise<boolean> {
    const Result = await db
        .prepare("DELETE FROM hidden_models WHERE provider_id = ? AND model_id = ?")
        .run(providerId, modelId);
    return num(Result.changes) > 0;
}

function mapHiddenModelRow(row: HiddenModelDBShape): HiddenModelRow {
    return {
        providerId: str(row.provider_id),
        modelId: str(row.model_id),
        createdAt: num(row.created_at)
    };
}
