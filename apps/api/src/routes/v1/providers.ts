import { Hono } from "hono";
import { ProvidersController } from "@/controllers/providers.controller.js";
import { RequireAdmin } from "@/middleware/AdminAuth.js";
import { ApiKeyAuth } from "@/middleware/ApiKeyAuth.js";

export const providersRoute = new Hono();

providersRoute.get("/providers", ApiKeyAuth, ProvidersController.ListProviders);
providersRoute.get("/providers/catalog", ApiKeyAuth, ProvidersController.GetCatalog);
providersRoute.get("/providers/:providerId", ApiKeyAuth, ProvidersController.GetProvider);

// Mutation endpoints require Admin Auth
providersRoute.post("/providers/verify", RequireAdmin, ProvidersController.VerifyProvider);
providersRoute.post("/providers", RequireAdmin, ProvidersController.AddProvider);
providersRoute.delete("/providers/:id", RequireAdmin, ProvidersController.DeleteProvider);

// Custom (user-added) models per provider driver
providersRoute.post(
    "/providers/:providerId/models",
    RequireAdmin,
    ProvidersController.AddCustomModel
);
providersRoute.delete(
    "/providers/:providerId/models/:modelId{.+}",
    RequireAdmin,
    ProvidersController.DeleteCustomModel
);
