import type { Context } from "hono";
import type { ModelListResponse } from "@srouter/types";
import { ModelsLogic } from "@/logic/models.logic.js";
import { Err, Ok } from "@/utils/response.js";

const MODEL_CACHE_CONTROL = "public, max-age=60, stale-while-revalidate=300";

export class ModelsController {
    public static async ListModels(c: Context): Promise<Response> {
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
        c.header("Cache-Control", MODEL_CACHE_CONTROL);
        return Ok(c, response);
    }

    public static async GetModelById(c: Context): Promise<Response> {
        const rawModelId = c.req.param("model") || c.req.param("*");
        const modelId = rawModelId ? decodeURIComponent(rawModelId) : undefined;
        if (!modelId) return Err(c, "Model ID parameter is required", 400);

        const refreshParam = c.req.query("refresh") || c.req.query("force");
        const forceRefresh = refreshParam === "true" || refreshParam === "1";

        const model = await ModelsLogic.getModelById(modelId, forceRefresh);
        if (model) {
            c.header("Cache-Control", MODEL_CACHE_CONTROL);
            return Ok(c, model);
        }

        return Err(c, `Model '${modelId}' not found`, 404, {
            code: "model_not_found"
        });
    }

    public static listModels = ModelsController.ListModels;
    public static getModelById = ModelsController.GetModelById;
}
