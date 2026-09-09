import { Hono } from "hono";
import { ProvidersController } from "@/controllers/providers.controller.js";
import { RequireAdmin } from "@/middleware/AdminAuth.js";
import { ApiKeyAuth } from "@/middleware/ApiKeyAuth.js";
import { FavoritesController } from "@/controllers/favorites.controller.js";

export const ProvidersRouter = new Hono();

ProvidersRouter.get("/favorites", ApiKeyAuth, FavoritesController.List);
ProvidersRouter.post("/favorites", RequireAdmin, FavoritesController.Add);
ProvidersRouter.delete("/favorites/:modelId{.+}", RequireAdmin, FavoritesController.Remove);

ProvidersRouter.get("/providers", ApiKeyAuth, ProvidersController.ListProviders);
ProvidersRouter.get("/providers/catalog", ApiKeyAuth, ProvidersController.GetCatalog);
ProvidersRouter.get("/providers/:providerId", ApiKeyAuth, ProvidersController.GetProvider);

// Mutation endpoints require Admin Auth
ProvidersRouter.post("/providers/verify", RequireAdmin, ProvidersController.VerifyProvider);
ProvidersRouter.post("/providers", RequireAdmin, ProvidersController.AddProvider);
ProvidersRouter.delete("/providers/:id", RequireAdmin, ProvidersController.DeleteProvider);

// Custom (user-added) models per provider driver
ProvidersRouter.post(
    "/providers/:providerId/models",
    RequireAdmin,
    ProvidersController.AddCustomModel
);
ProvidersRouter.delete(
    "/providers/:providerId/models/:modelId{.+}",
    RequireAdmin,
    ProvidersController.DeleteCustomModel
);

// Round-robin load balancing toggle
ProvidersRouter.patch(
    "/providers/:providerId/round-robin",
    RequireAdmin,
    ProvidersController.ToggleRoundRobin
);

ProvidersRouter.get("/providers/:providerId/hidden-models", ApiKeyAuth, ProvidersController.ListHiddenModels);
ProvidersRouter.post("/providers/:providerId/hidden-models", RequireAdmin, ProvidersController.HideModel);
ProvidersRouter.delete(
    "/providers/:providerId/hidden-models/:modelId{.+}",
    RequireAdmin,
    ProvidersController.RestoreModel
);
