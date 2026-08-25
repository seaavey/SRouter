import { Hono } from "hono";
import { KeysController } from "@/controllers/keys.controller.js";
import { RequireAdmin } from "@/middleware/AdminAuth.js";
import { apiKeyAuth } from "@/middleware/apiKeyAuth.js";

export const keysRoute = new Hono();

// List API keys
keysRoute.get("/keys", apiKeyAuth, KeysController.ListKeys);

// Mutation endpoints require Admin Auth
keysRoute.post("/keys", RequireAdmin, KeysController.CreateKey);
keysRoute.delete("/keys/:id", RequireAdmin, KeysController.DeleteKey);
