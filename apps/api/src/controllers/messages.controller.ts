import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import {
    anthropicToOpenAIRequest,
    openAIToAnthropicResponse,
    openAIToAnthropicStream
} from "@srouter/translator";
import { AnthropicMessageRequestSchema, type AnthropicMessageRequest } from "@srouter/types";
import { ChatLogic } from "@/logic/chat.logic.js";
import { AnthropicErr, FormatAnthropicErrorPayload, Ok } from "@/utils/response.js";

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
        const openAIReq = anthropicToOpenAIRequest(body);
        const isThinkingEnabled = Boolean(body.thinking?.type === "enabled");

        if (body.stream) {
            c.header("Content-Type", "text/event-stream");
            c.header("Cache-Control", "no-cache");
            c.header("Connection", "keep-alive");

            return streamSSE(c, async (stream) => {
                try {
                    const chunkGenerator = ChatLogic.processStreamingCompletion(openAIReq, startTime);
                    const anthropicStream = openAIToAnthropicStream(chunkGenerator, body.model, {
                        allowThinking: isThinkingEnabled
                    });

                    for await (const event of anthropicStream) {
                        await stream.writeSSE({
                            event: event.type,
                            data: JSON.stringify(event)
                        });
                    }
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : "Error occurred during streaming";
                    await stream.writeSSE({
                        event: "error",
                        data: JSON.stringify(FormatAnthropicErrorPayload(errorMessage, 500))
                    });
                }
            });
        }

        try {
            const openAIRes = await ChatLogic.processNonStreamingCompletion(openAIReq, startTime);
            const anthropicRes = openAIToAnthropicResponse(openAIRes, body.model, {
                allowThinking: isThinkingEnabled
            });
            return Ok(c, anthropicRes);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "Internal server error";
            return AnthropicErr(c, errorMessage, 500);
        }
    }

    public static createMessage = MessagesController.CreateMessage;
}
