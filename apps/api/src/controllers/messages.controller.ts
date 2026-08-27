import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import {
    AnthropicToOpenAIRequest,
    OpenAIToAnthropicResponse,
    OpenAIToAnthropicStream
} from "@srouter/translator";
import { AnthropicMessageRequestSchema, type AnthropicMessageRequest } from "@srouter/types";
import { ChatLogic } from "@/logic/chat.logic.js";
import { AnthropicErr, FormatAnthropicErrorPayload, Ok } from "@/utils/response.js";
import { GetApiKeyRow, IsModelAllowed } from "@/middleware/ModelAccess.js";

export class MessagesController {
    public static async CreateMessage(c: Context): Promise<Response> {
        const startTime = Date.now();
        const rawBody = await c.req.json().catch(() => null);
        if (!rawBody || typeof rawBody !== "object") {
            return AnthropicErr(c, "Invalid JSON request body", 400);
        }

        const parsed = AnthropicMessageRequestSchema.safeParse(rawBody);
        if (!parsed.success) {
            return AnthropicErr(c, parsed.error.issues[0]?.message || "Validation failed", 400);
        }

        const body = parsed.data as AnthropicMessageRequest;

        const ApiKeyRow = GetApiKeyRow(c);
        const AllowedModels = ApiKeyRow?.allowed_models;
        if (!IsModelAllowed(AllowedModels, body.model)) {
            return AnthropicErr(
                c,
                `Model '${body.model}' is not allowed for this API key`,
                403,
                "permission_error"
            );
        }

        const ApiKeyId = ApiKeyRow?.id;
        const OpenAIReq = AnthropicToOpenAIRequest(body);
        const isThinkingEnabled = Boolean(body.thinking?.type === "enabled");

        if (body.stream) {
            c.header("Content-Type", "text/event-stream");
            c.header("Cache-Control", "no-cache");
            c.header("Connection", "keep-alive");

            return streamSSE(c, async (stream) => {
                try {
                    const chunkGenerator = ChatLogic.ProcessStreamingCompletion(
                        OpenAIReq,
                        startTime,
                        0,
                        ApiKeyId
                    );
                    const AnthropicStream = OpenAIToAnthropicStream(chunkGenerator, body.model, {
                        allowThinking: isThinkingEnabled
                    });

                    for await (const event of AnthropicStream) {
                        await stream.writeSSE({
                            event: event.type,
                            data: JSON.stringify(event)
                        });
                    }
                } catch (error) {
                    const errorMessage =
                        error instanceof Error ? error.message : "Error occurred during streaming";
                    await stream.writeSSE({
                        event: "error",
                        data: JSON.stringify(FormatAnthropicErrorPayload(errorMessage, 500))
                    });
                }
            });
        }

        try {
            const OpenAIRes = await ChatLogic.ProcessNonStreamingCompletion(
                OpenAIReq,
                startTime,
                0,
                ApiKeyId
            );
            const AnthropicRes = OpenAIToAnthropicResponse(OpenAIRes, body.model, {
                allowThinking: isThinkingEnabled
            });
            return Ok(c, AnthropicRes);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "Internal server error";
            return AnthropicErr(c, errorMessage, 500);
        }
    }
}
