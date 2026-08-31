import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import type { ChatCompletionRequest, APIKeyZod } from "@srouter/types";
import { ChatLogic } from "@/logic/chat.logic.js";
import { Err, FormatErrorPayload, Ok } from "@/utils/response.js";

function NormalizeDeveloperRole(Body: ChatCompletionRequest): ChatCompletionRequest {
    for (const msg of Body.messages) {
        if (msg.role === "developer") msg.role = "system";
    }
    return Body;
}

export class ChatController {
    public static async CreateCompletion(c: Context): Promise<Response> {
        const StartTime = Date.now();
        const Body = NormalizeDeveloperRole(
            c.req.valid("json" as never) as ChatCompletionRequest
        );
        const ApiKeyRow = c.get("apiKeyRow") as APIKeyZod | undefined;
        const ApiKeyId = ApiKeyRow?.id;

        if (Body.stream) {
            return streamSSE(c, async (stream) => {
                try {
                    const Generator = ChatLogic.ProcessStreamingCompletion(
                        Body,
                        StartTime,
                        0,
                        ApiKeyId
                    );
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
            const ResponseData = await ChatLogic.ProcessNonStreamingCompletion(
                Body,
                StartTime,
                0,
                ApiKeyId
            );
            return Ok(c, ResponseData);
        } catch (error) {
            const ErrorMessage = error instanceof Error ? error.message : "Internal server error";
            return Err(c, ErrorMessage, 500);
        }
    }
}
