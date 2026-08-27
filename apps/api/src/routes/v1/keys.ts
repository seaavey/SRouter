import { Hono } from "hono";
import { KeysController } from "@/controllers/keys.controller.js";
import { RequireAdmin } from "@/middleware/AdminAuth.js";
import { ApiKeyAuth } from "@/middleware/ApiKeyAuth.js";

export const KeysRouter = new Hono();

KeysRouter.get("/keys", ApiKeyAuth, KeysController.ListKeys);

// Mutation endpoints require Admin Auth
KeysRouter.post("/keys", RequireAdmin, KeysController.CreateKey);
KeysRouter.post("/keys/:id/credit", RequireAdmin, KeysController.AddCredit);
KeysRouter.delete("/keys/:id", RequireAdmin, KeysController.DeleteKey);
