import { Hono } from "hono";
import { ChatCompletionRequestSchema } from "@srouter/types";
import { ChatController } from "@/controllers/chat.controller.js";
import { validateJson } from "@/middleware/validator.js";
import { apiKeyAuth } from "@/middleware/apiKeyAuth.js";

export const chatRoute = new Hono();

// POST /v1/chat/completions and /v1/chat/completion with apiKeyAuth and Zod validation
chatRoute.post(
    "/chat/completions",
    apiKeyAuth,
    validateJson(ChatCompletionRequestSchema),
    ChatController.CreateCompletion
);
chatRoute.post(
    "/chat/completion",
    apiKeyAuth,
    validateJson(ChatCompletionRequestSchema),
    ChatController.CreateCompletion
);
