import { Hono } from "hono";
import { MessagesController } from "@/controllers/messages.controller.js";
import { apiKeyAuth } from "@/middleware/apiKeyAuth.js";

export const messagesRoute = new Hono();

// POST /v1/messages (and /messages) with apiKeyAuth
messagesRoute.post("/messages", apiKeyAuth, MessagesController.CreateMessage);
