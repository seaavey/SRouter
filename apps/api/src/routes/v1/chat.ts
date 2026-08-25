import { Hono } from "hono";
import { ChatCompletionRequestSchema } from "@srouter/types";
import { ChatController } from "@/controllers/chat.controller.js";
import { ValidateJson } from "@/middleware/Validation.js";
import { ApiKeyAuth } from "@/middleware/ApiKeyAuth.js";

export const chatRoute = new Hono();

chatRoute.post(
    "/chat/completions",
    ApiKeyAuth,
    ValidateJson(ChatCompletionRequestSchema),
    ChatController.CreateCompletion
);
chatRoute.post(
    "/chat/completion",
    ApiKeyAuth,
    ValidateJson(ChatCompletionRequestSchema),
    ChatController.CreateCompletion
);
