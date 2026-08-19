import { Hono } from "hono";
import { FallbacksController } from "@/controllers/fallbacks.controller.js";
import { SettingsController } from "@/controllers/settings.controller.js";
import { TokenSaverController } from "@/controllers/tokenSaver.controller.js";
import { adminAuth } from "@/middleware/adminAuth.js";
import { apiKeyAuth } from "@/middleware/apiKeyAuth.js";

export const settingsRoute = new Hono();

// Read Endpoints (allow via apiKeyAuth / local auth-free)
settingsRoute.get("/settings", apiKeyAuth, SettingsController.getSettings);
settingsRoute.get("/settings/token-saver", apiKeyAuth, TokenSaverController.getSettings);
settingsRoute.get("/settings/fallbacks", apiKeyAuth, FallbacksController.getFallbacks);

// Mutation Endpoints (require Admin Auth)
settingsRoute.patch("/settings", adminAuth, SettingsController.updateSettings);
settingsRoute.post("/settings", adminAuth, SettingsController.updateSettings);
settingsRoute.patch("/settings/token-saver", adminAuth, TokenSaverController.updateSettings);
settingsRoute.put("/settings/token-saver", adminAuth, TokenSaverController.updateSettings);
settingsRoute.post("/settings/token-saver/test", adminAuth, TokenSaverController.preview);
settingsRoute.post("/settings/fallbacks", adminAuth, FallbacksController.createFallback);
settingsRoute.put("/settings/fallbacks/:id", adminAuth, FallbacksController.updateFallback);
settingsRoute.patch("/settings/fallbacks/:id", adminAuth, FallbacksController.updateFallback);
settingsRoute.delete("/settings/fallbacks/:id", adminAuth, FallbacksController.deleteFallback);
