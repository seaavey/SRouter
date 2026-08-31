import { Hono } from "hono";
import { ChatCompletionRequestSchema } from "@srouter/types";
import { ChatController } from "@/controllers/chat.controller.js";
import { ValidateJson } from "@/middleware/Validation.js";
import { ApiKeyAuth } from "@/middleware/ApiKeyAuth.js";
import { EnforceModelAccess } from "@/middleware/ModelAccess.js";
import { EnforceRateLimit } from "@/middleware/RateLimit.js";

export const ChatRouter = new Hono();

ChatRouter.post(
    "/chat/completions",
    ApiKeyAuth,
    EnforceRateLimit,
    ValidateJson(ChatCompletionRequestSchema),
    EnforceModelAccess(),
    ChatController.CreateCompletion
);
ChatRouter.post(
    "/chat/completion",
    ApiKeyAuth,
    EnforceRateLimit,
    ValidateJson(ChatCompletionRequestSchema),
    EnforceModelAccess(),
    ChatController.CreateCompletion
);
