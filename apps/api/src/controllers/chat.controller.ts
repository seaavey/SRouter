import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import type { ChatCompletionRequest } from "@srouter/types";
import { ChatLogic } from "@/logic/chat.logic.js";
import { Err, FormatErrorPayload, Ok } from "@/utils/response.js";

export class ChatController {
    public static async CreateCompletion(c: Context): Promise<Response> {
        const StartTime = Date.now();
        const Body = c.req.valid("json" as never) as ChatCompletionRequest;

        if (Body.stream) {
            return streamSSE(c, async (stream) => {
                try {
                    const Generator = ChatLogic.ProcessStreamingCompletion(Body, StartTime);
                    for await (const Chunk of Generator) {
                        await stream.writeSSE({
                            data: JSON.stringify(Chunk)
                        });
                    }
                    await stream.writeSSE({
                        data: "[DONE]"
                    });
                } catch (error) {
                    const ErrorMessage =
                        error instanceof Error ? error.message : "Error occurred during streaming";
                    await stream.writeSSE({
                        data: JSON.stringify(FormatErrorPayload(ErrorMessage, 500))
                    });
                }
            });
        }

        try {
            const ResponseData = await ChatLogic.ProcessNonStreamingCompletion(Body, StartTime);
            return Ok(c, ResponseData);
        } catch (error) {
            const ErrorMessage = error instanceof Error ? error.message : "Internal server error";
            return Err(c, ErrorMessage, 500);
        }
    }
}
