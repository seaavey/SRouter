import type { Context } from "hono";
import type { ModelListResponse } from "@srouter/types";
import { ModelsLogic } from "@/logic/models.logic.js";
import { Err, Ok } from "@/utils/response.js";
import { GetApiKeyRow, IsModelAllowed } from "@/middleware/ModelAccess.js";

const MODEL_CACHE_CONTROL = "public, max-age=60, stale-while-revalidate=300";

export class ModelsController {
    public static async ListModels(c: Context): Promise<Response> {
        const RefreshParam = c.req.query("refresh") || c.req.query("force");
        const CacheControlReq = c.req.header("cache-control");
        const ExplicitRefresh = RefreshParam === "true" || RefreshParam === "1";
        const Revalidate =
            CacheControlReq?.includes("no-cache") || CacheControlReq?.includes("no-store");

        if (Revalidate && !ExplicitRefresh) {
            void ModelsLogic.RefreshModels(true).catch(() => undefined);
        }

        const Models = await ModelsLogic.GetAllModels(undefined, ExplicitRefresh);
        const AllowedModels = GetApiKeyRow(c)?.allowed_models;
        const VisibleModels =
            AllowedModels && AllowedModels.length > 0
                ? Models.filter((Model) => IsModelAllowed(AllowedModels, Model.id))
                : Models;

        const ResponseData: ModelListResponse = {
            object: "list",
            data: VisibleModels
        };
        c.header("Cache-Control", MODEL_CACHE_CONTROL);
        return Ok(c, ResponseData);
    }

    public static async GetModelById(c: Context): Promise<Response> {
        const RawModelId = c.req.param("model") || c.req.param("*");
        const ModelId = RawModelId ? decodeURIComponent(RawModelId) : undefined;
        if (!ModelId) return Err(c, "Model ID parameter is required", 400);

        const AllowedModels = GetApiKeyRow(c)?.allowed_models;
        if (!IsModelAllowed(AllowedModels, ModelId)) {
            return Err(c, `Model '${ModelId}' is not allowed for this API key`, 403, {
                code: "model_not_allowed"
            });
        }

        const RefreshParam = c.req.query("refresh") || c.req.query("force");
        const ForceRefresh = RefreshParam === "true" || RefreshParam === "1";

        const Model = await ModelsLogic.GetModelById(ModelId, ForceRefresh);
        if (Model) {
            c.header("Cache-Control", MODEL_CACHE_CONTROL);
            return Ok(c, Model);
        }

        return Err(c, `Model '${ModelId}' not found`, 404, {
            code: "model_not_found"
        });
    }
}
