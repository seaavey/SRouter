import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import type { ChatCompletionRequest } from "@srouter/types";
import { ChatLogic } from "@/logic/chat.logic.js";
import { Err, FormatErrorPayload, Ok } from "@/utils/response.js";

export class ChatController {
    public static async CreateCompletion(c: Context): Promise<Response> {
        const startTime = Date.now();
        const body = c.req.valid("json" as never) as ChatCompletionRequest;

        if (body.stream) {
            return streamSSE(c, async (stream) => {
                try {
                    const generator = ChatLogic.processStreamingCompletion(body, startTime);
                    for await (const chunk of generator) {
                        await stream.writeSSE({
                            data: JSON.stringify(chunk)
                        });
                    }
                    await stream.writeSSE({
                        data: "[DONE]"
                    });
                } catch (error) {
                    const errorMessage =
                        error instanceof Error ? error.message : "Error occurred during streaming";
                    await stream.writeSSE({
                        data: JSON.stringify(FormatErrorPayload(errorMessage, 500))
                    });
                }
            });
        }

        try {
            const response = await ChatLogic.processNonStreamingCompletion(body, startTime);
            return Ok(c, response);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "Internal server error";
            return Err(c, errorMessage, 500);
        }
    }

    public static createCompletion = ChatController.CreateCompletion;
}
