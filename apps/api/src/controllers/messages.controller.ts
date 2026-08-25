import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import {
    anthropicToOpenAIRequest,
    openAIToAnthropicResponse,
    openAIToAnthropicStream
} from "@srouter/translator";
import type { AnthropicMessageRequest } from "@srouter/types";
import { ChatLogic } from "@/logic/chat.logic.js";

export class MessagesController {
    public static async CreateMessage(c: Context): Promise<Response> {
        const startTime = Date.now();
        let body: AnthropicMessageRequest;
        try {
            body = await c.req.json<AnthropicMessageRequest>();
        } catch {
            return c.json(
                {
                    type: "error",
                    error: {
                        type: "invalid_request_error",
                        message: "Invalid JSON request body"
                    }
                },
                400
            );
        }

        if (!body.model) {
            return c.json(
                {
                    type: "error",
                    error: {
                        type: "invalid_request_error",
                        message: "Missing required field 'model'"
                    }
                },
                400
            );
        }

        const openAIReq = anthropicToOpenAIRequest(body);

        const isThinkingEnabled = Boolean(
            body.thinking && (body.thinking as { type?: string }).type === "enabled"
        );

        if (body.stream) {
            c.header("Content-Type", "text/event-stream");
            c.header("Cache-Control", "no-cache");
            c.header("Connection", "keep-alive");

            return streamSSE(c, async (stream) => {
                try {
                    const chunkGenerator = ChatLogic.processStreamingCompletion(
                        openAIReq,
                        startTime
                    );
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
                        data: JSON.stringify({
                            type: "error",
                            error: {
                                type: "api_error",
                                message: errorMessage
                            }
                        })
                    });
                }
            });
        }

        try {
            const openAIRes = await ChatLogic.processNonStreamingCompletion(openAIReq, startTime);
            const anthropicRes = openAIToAnthropicResponse(openAIRes, body.model, {
                allowThinking: isThinkingEnabled
            });
            return c.json(anthropicRes);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "Internal server error";
            return c.json(
                {
                    type: "error",
                    error: {
                        type: "api_error",
                        message: errorMessage
                    }
                },
                500
            );
        }
    }

    public static createMessage = MessagesController.CreateMessage;
}
