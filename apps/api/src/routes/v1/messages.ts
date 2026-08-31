import { Hono } from "hono";
import { MessagesController } from "@/controllers/messages.controller.js";
import { ApiKeyAuth } from "@/middleware/ApiKeyAuth.js";
import { EnforceRateLimit } from "@/middleware/RateLimit.js";

export const MessagesRouter = new Hono();

MessagesRouter.post("/messages", ApiKeyAuth, EnforceRateLimit, MessagesController.CreateMessage);
