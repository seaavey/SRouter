import { Hono } from "hono";
import { FallbacksController } from "@/controllers/fallbacks.controller.js";
import { SettingsController } from "@/controllers/settings.controller.js";
import { TokenSaverController } from "@/controllers/tokenSaver.controller.js";
import { adminAuth } from "@/middleware/adminAuth.js";

export const settingsRoute = new Hono();
settingsRoute.use("/*", adminAuth);

// GET /v1/settings
settingsRoute.get("/settings", SettingsController.getSettings);

// PATCH /v1/settings and POST /v1/settings
settingsRoute.patch("/settings", SettingsController.updateSettings);
settingsRoute.post("/settings", SettingsController.updateSettings);

// Token Saver Endpoints
settingsRoute.get("/settings/token-saver", TokenSaverController.getSettings);
settingsRoute.patch("/settings/token-saver", TokenSaverController.updateSettings);
settingsRoute.put("/settings/token-saver", TokenSaverController.updateSettings);
settingsRoute.post("/settings/token-saver/test", TokenSaverController.preview);

// Fallback Rules Configuration Endpoints
settingsRoute.get("/settings/fallbacks", FallbacksController.getFallbacks);
settingsRoute.post("/settings/fallbacks", FallbacksController.createFallback);
settingsRoute.put("/settings/fallbacks/:id", FallbacksController.updateFallback);
settingsRoute.patch("/settings/fallbacks/:id", FallbacksController.updateFallback);
settingsRoute.delete("/settings/fallbacks/:id", FallbacksController.deleteFallback);
