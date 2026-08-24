import { Hono } from "hono";
import { ProvidersController } from "@/controllers/providers.controller.js";
import { RequireAdmin } from "@/middleware/adminAuth.js";
import { apiKeyAuth } from "@/middleware/apiKeyAuth.js";

export const providersRoute = new Hono();

// GET /v1/providers - Flat list of all provider definitions
providersRoute.get("/providers", apiKeyAuth, ProvidersController.listProviders);

// GET /v1/providers/catalog - Grouped by categories
providersRoute.get("/providers/catalog", apiKeyAuth, ProvidersController.getCatalog);

// GET /v1/providers/:providerId - Get single provider details
providersRoute.get("/providers/:providerId", apiKeyAuth, ProvidersController.getProvider);

// Mutation endpoints require Admin Auth
providersRoute.post("/providers/verify", RequireAdmin, ProvidersController.verifyProvider);
providersRoute.post("/providers", RequireAdmin, ProvidersController.addProvider);
providersRoute.delete("/providers/:id", RequireAdmin, ProvidersController.deleteProvider);

// Custom (user-added) models per provider driver
providersRoute.post("/providers/:providerId/models", RequireAdmin, ProvidersController.addCustomModel);
providersRoute.delete(
    "/providers/:providerId/models/:modelId{.+}",
    RequireAdmin,
    ProvidersController.deleteCustomModel
);
