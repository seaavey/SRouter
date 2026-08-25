import { Hono } from "hono";
import { SettingsController } from "@/controllers/settings.controller.js";
import { TokenSaverController } from "@/controllers/tokenSaver.controller.js";
import { FallbacksController } from "@/controllers/fallbacks.controller.js";
import { RequireAdmin } from "@/middleware/adminAuth.js";
import { apiKeyAuth } from "@/middleware/apiKeyAuth.js";

export const settingsRoute = new Hono();

// GET routes accept either an API key or an active admin session
settingsRoute.get("/settings", apiKeyAuth, SettingsController.GetSettings);
settingsRoute.get("/settings/token-saver", apiKeyAuth, TokenSaverController.GetSettings);
settingsRoute.get("/settings/fallbacks", apiKeyAuth, FallbacksController.GetFallbacks);

// Mutations require an authenticated admin session
settingsRoute.patch("/settings", RequireAdmin, SettingsController.UpdateSettings);
settingsRoute.post("/settings", RequireAdmin, SettingsController.UpdateSettings);
settingsRoute.patch("/settings/token-saver", RequireAdmin, TokenSaverController.UpdateSettings);
settingsRoute.put("/settings/token-saver", RequireAdmin, TokenSaverController.UpdateSettings);
settingsRoute.post("/settings/token-saver/test", RequireAdmin, TokenSaverController.Preview);
settingsRoute.post("/settings/fallbacks", RequireAdmin, FallbacksController.CreateFallback);
settingsRoute.put("/settings/fallbacks/:id", RequireAdmin, FallbacksController.UpdateFallback);
settingsRoute.patch("/settings/fallbacks/:id", RequireAdmin, FallbacksController.UpdateFallback);
settingsRoute.delete("/settings/fallbacks/:id", RequireAdmin, FallbacksController.DeleteFallback);
