import { Hono } from "hono";
import { ProvidersController } from "@/controllers/providers.controller.js";
import { RequireAdmin } from "@/middleware/AdminAuth.js";
import { ApiKeyAuth } from "@/middleware/ApiKeyAuth.js";

export const ProvidersRouter = new Hono();

ProvidersRouter.get("/providers", ApiKeyAuth, ProvidersController.ListProviders);
ProvidersRouter.get("/providers/catalog", ApiKeyAuth, ProvidersController.GetCatalog);
ProvidersRouter.get("/providers/:providerId", ApiKeyAuth, ProvidersController.GetProvider);

// Mutation endpoints require Admin Auth
ProvidersRouter.post("/providers/verify", RequireAdmin, ProvidersController.VerifyProvider);
ProvidersRouter.post("/providers", RequireAdmin, ProvidersController.AddProvider);
ProvidersRouter.delete("/providers/:id", RequireAdmin, ProvidersController.DeleteProvider);
