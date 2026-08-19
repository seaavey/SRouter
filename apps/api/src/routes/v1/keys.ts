import { Hono } from "hono";
import { KeysController } from "@/controllers/keys.controller.js";
import { adminAuth } from "@/middleware/adminAuth.js";
import { apiKeyAuth } from "@/middleware/apiKeyAuth.js";

export const keysRoute = new Hono();

// GET /v1/keys - List all virtual API keys
keysRoute.get("/keys", apiKeyAuth, KeysController.listKeys);

// Mutation endpoints require Admin Auth
keysRoute.post("/keys", adminAuth, KeysController.createKey);
keysRoute.delete("/keys/:id", adminAuth, KeysController.deleteKey);
