import { Hono } from "hono";
import { ProvidersController } from "@/controllers/providers.controller.js";
import { RequireAdmin } from "@/middleware/AdminAuth.js";
import { apiKeyAuth } from "@/middleware/apiKeyAuth.js";

export const providersRoute = new Hono();

// GET /v1/providers - Flat list of all provider definitions
providersRoute.get("/providers", apiKeyAuth, ProvidersController.ListProviders);

// GET /v1/providers/catalog - Grouped by categories
providersRoute.get("/providers/catalog", apiKeyAuth, ProvidersController.GetCatalog);

// GET /v1/providers/:providerId - Get single provider details
providersRoute.get("/providers/:providerId", apiKeyAuth, ProvidersController.GetProvider);

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
