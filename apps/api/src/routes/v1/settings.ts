import { Hono } from "hono";
import { SettingsController } from "@/controllers/settings.controller.js";
import { TokenSaverController } from "@/controllers/tokenSaver.controller.js";
import { FallbacksController } from "@/controllers/fallbacks.controller.js";
import { requireAdmin } from "@/middleware/adminAuth.js";
import { apiKeyAuth } from "@/middleware/apiKeyAuth.js";

export const settingsRoute = new Hono();

// GET routes accept either an API key or an active admin session
settingsRoute.get("/settings", apiKeyAuth, SettingsController.getSettings);
settingsRoute.get("/settings/token-saver", apiKeyAuth, TokenSaverController.getSettings);
settingsRoute.get("/settings/fallbacks", apiKeyAuth, FallbacksController.getFallbacks);

// Mutations require an authenticated admin session
settingsRoute.patch("/settings", requireAdmin, SettingsController.updateSettings);
settingsRoute.post("/settings", requireAdmin, SettingsController.updateSettings);
settingsRoute.patch("/settings/token-saver", requireAdmin, TokenSaverController.updateSettings);
settingsRoute.put("/settings/token-saver", requireAdmin, TokenSaverController.updateSettings);
settingsRoute.post("/settings/token-saver/test", requireAdmin, TokenSaverController.preview);
settingsRoute.post("/settings/fallbacks", requireAdmin, FallbacksController.createFallback);
settingsRoute.put("/settings/fallbacks/:id", requireAdmin, FallbacksController.updateFallback);
settingsRoute.patch("/settings/fallbacks/:id", requireAdmin, FallbacksController.updateFallback);
settingsRoute.delete("/settings/fallbacks/:id", requireAdmin, FallbacksController.deleteFallback);
