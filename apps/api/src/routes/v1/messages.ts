import { Hono } from "hono";
import { MessagesController } from "@/controllers/messages.controller.js";
import { ApiKeyAuth } from "@/middleware/ApiKeyAuth.js";

export const messagesRoute = new Hono();

messagesRoute.post("/messages", ApiKeyAuth, MessagesController.CreateMessage);
