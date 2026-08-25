import { Hono } from "hono";
import { ModelsController } from "@/controllers/models.controller.js";
import { apiKeyAuth } from "@/middleware/apiKeyAuth.js";

export const modelsRoute = new Hono();

// GET /v1/models — apiKeyAuth applied per-route, not as a catch-all use("/*").
// This route is also mounted at "/" for clients using a bare base URL, where
// a catch-all would swallow the dashboard root and every unmatched path.
modelsRoute.get("/models", apiKeyAuth, ModelsController.ListModels);

// GET /v1/models/:model (supports slashes in namespaced model IDs)
modelsRoute.get("/models/:model{.+}", apiKeyAuth, ModelsController.GetModelById);
