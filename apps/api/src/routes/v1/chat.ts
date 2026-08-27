import { Hono } from "hono";
import { ChatCompletionRequestSchema } from "@srouter/types";
import { ChatController } from "@/controllers/chat.controller.js";
import { ValidateJson } from "@/middleware/Validation.js";
import { ApiKeyAuth } from "@/middleware/ApiKeyAuth.js";
import { EnforceModelAccess } from "@/middleware/ModelAccess.js";

export const ChatRouter = new Hono();

ChatRouter.post(
    "/chat/completions",
    ApiKeyAuth,
    ValidateJson(ChatCompletionRequestSchema),
    EnforceModelAccess(),
    ChatController.CreateCompletion
);
ChatRouter.post(
    "/chat/completion",
    ApiKeyAuth,
    ValidateJson(ChatCompletionRequestSchema),
    EnforceModelAccess(),
    ChatController.CreateCompletion
);
