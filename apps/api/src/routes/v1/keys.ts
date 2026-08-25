import { Hono } from "hono";
import { KeysController } from "@/controllers/keys.controller.js";
import { RequireAdmin } from "@/middleware/AdminAuth.js";
import { ApiKeyAuth } from "@/middleware/ApiKeyAuth.js";

export const keysRoute = new Hono();

keysRoute.get("/keys", ApiKeyAuth, KeysController.ListKeys);

// Mutation endpoints require Admin Auth
keysRoute.post("/keys", RequireAdmin, KeysController.CreateKey);
keysRoute.delete("/keys/:id", RequireAdmin, KeysController.DeleteKey);
