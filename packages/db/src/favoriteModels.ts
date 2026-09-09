import { db, isPostgres } from "./db.js";
import { num, str } from "./row-utils.js";

interface FavoriteModelDBShape {
    model_id: string;
    created_at: number;
}

export async function getFavoriteModelsDB(): Promise<string[]> {
    const Rows = (await db.prepare("SELECT model_id FROM favorite_models ORDER BY created_at ASC").all()) as unknown as FavoriteModelDBShape[];
    return Rows.map((Row) => str(Row.model_id));
}

export async function addFavoriteModelDB(modelId: string): Promise<void> {
    const Sql = isPostgres()
        ? "INSERT INTO favorite_models (model_id, created_at) VALUES (?, ?) ON CONFLICT (model_id) DO NOTHING"
        : "INSERT OR IGNORE INTO favorite_models (model_id, created_at) VALUES (?, ?)";
    await db.prepare(Sql).run(modelId, Date.now());
}

export async function deleteFavoriteModelDB(modelId: string): Promise<boolean> {
    const Result = await db.prepare("DELETE FROM favorite_models WHERE model_id = ?").run(modelId);
    return num(Result.changes) > 0;
}
