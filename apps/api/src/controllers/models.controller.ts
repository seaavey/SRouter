import type { Context } from "hono";
import type { ModelListResponse } from "@srouter/types";
import { ModelsLogic } from "@/logic/models.logic.js";
import { Err, Ok } from "@/utils/response.js";

export class ModelsController {
    public static async listModels(c: Context): Promise<Response> {
        const refreshParam = c.req.query("refresh") || c.req.query("force");
        const cacheControlReq = c.req.header("cache-control");
        const explicitRefresh = refreshParam === "true" || refreshParam === "1";
        const revalidate =
            cacheControlReq?.includes("no-cache") || cacheControlReq?.includes("no-store");

        if (revalidate && !explicitRefresh) {
            void ModelsLogic.refreshModels(true).catch(() => undefined);
        }

        const models = await ModelsLogic.getAllModels(undefined, explicitRefresh);
        const response: ModelListResponse = {
            object: "list",
            data: models
        };
        c.header("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
        return Ok(c, response);
    }

    public static async getModelById(c: Context): Promise<Response> {
        const rawModelId = c.req.param("model") || c.req.param("*");
        const modelId = rawModelId ? decodeURIComponent(rawModelId) : undefined;
        if (!modelId) {
            return Err(c, "Model ID parameter is required", 400);
        }

        const refreshParam = c.req.query("refresh") || c.req.query("force");
        const forceRefresh = refreshParam === "true" || refreshParam === "1";

        const model = await ModelsLogic.getModelById(modelId, forceRefresh);
        if (model) {
            c.header("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
            return Ok(c, model);
        }

        return Err(c, `Model '${modelId}' not found`, 404, {
            code: "model_not_found"
        });
    }
}
