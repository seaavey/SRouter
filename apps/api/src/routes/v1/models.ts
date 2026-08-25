import { Hono } from "hono";
import { ModelsController } from "@/controllers/models.controller.js";
import { ApiKeyAuth } from "@/middleware/ApiKeyAuth.js";

export const modelsRoute = new Hono();

modelsRoute.get("/models", ApiKeyAuth, ModelsController.ListModels);
modelsRoute.get("/models/:model{.+}", ApiKeyAuth, ModelsController.GetModelById);
