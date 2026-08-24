import { Hono } from "hono";
import { SettingsController } from "@/controllers/settings.controller.js";
import { TokenSaverController } from "@/controllers/tokenSaver.controller.js";
import { FallbacksController } from "@/controllers/fallbacks.controller.js";
import { RequireAdmin } from "@/middleware/adminAuth.js";
import { apiKeyAuth } from "@/middleware/apiKeyAuth.js";

export const settingsRoute = new Hono();

// GET routes accept either an API key or an active admin session
settingsRoute.get("/settings", apiKeyAuth, SettingsController.getSettings);
settingsRoute.get("/settings/token-saver", apiKeyAuth, TokenSaverController.getSettings);
settingsRoute.get("/settings/fallbacks", apiKeyAuth, FallbacksController.getFallbacks);

// Mutations require an authenticated admin session
settingsRoute.patch("/settings", RequireAdmin, SettingsController.updateSettings);
settingsRoute.post("/settings", RequireAdmin, SettingsController.updateSettings);
settingsRoute.patch("/settings/token-saver", RequireAdmin, TokenSaverController.updateSettings);
settingsRoute.put("/settings/token-saver", RequireAdmin, TokenSaverController.updateSettings);
settingsRoute.post("/settings/token-saver/test", RequireAdmin, TokenSaverController.preview);
settingsRoute.post("/settings/fallbacks", RequireAdmin, FallbacksController.createFallback);
settingsRoute.put("/settings/fallbacks/:id", RequireAdmin, FallbacksController.updateFallback);
settingsRoute.patch("/settings/fallbacks/:id", RequireAdmin, FallbacksController.updateFallback);
settingsRoute.delete("/settings/fallbacks/:id", RequireAdmin, FallbacksController.deleteFallback);
