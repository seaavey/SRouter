import type { Context } from "hono";
import { addFavoriteModelDB, deleteFavoriteModelDB, getFavoriteModelsDB } from "@srouter/db";
import { AddCustomModelSchema } from "@srouter/types";
import { Err, Ok } from "@/utils/response.js";

export class FavoritesController {
    public static async List(c: Context): Promise<Response> {
        return Ok(c, { models: await getFavoriteModelsDB() });
    }

    public static async Add(c: Context): Promise<Response> {
        const Parsed = AddCustomModelSchema.safeParse(await c.req.json().catch(() => null));
        if (!Parsed.success) return Err(c, "Invalid model payload", 400);
        await addFavoriteModelDB(Parsed.data.model_id);
        return Ok(c, { message: "Model added to favorites" }, 201);
    }

    public static async Remove(c: Context): Promise<Response> {
        const ModelId = c.req.param("modelId");
        if (!ModelId) return Err(c, "Model ID is required", 400);
        if (!(await deleteFavoriteModelDB(decodeURIComponent(ModelId)))) {
            return Err(c, "Favorite model not found", 404);
        }
        return Ok(c, { message: "Model removed from favorites" });
    }
}
