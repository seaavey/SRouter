import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import type { ChatCompletionRequest, APIKeyZod } from "@srouter/types";
import { ChatLogic } from "@/logic/chat.logic.js";
import { Err, FormatErrorPayload, Ok, ToContentfulStatusCode } from "@/utils/response.js";

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
        const userAgent = c.req.header("user-agent");
        const rawIp =
            c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
            c.req.header("x-real-ip") ||
            c.req.header("cf-connecting-ip") ||
            "127.0.0.1";

        if (Body.stream) {
            c.header("Content-Type", "text/event-stream");
            c.header("Cache-Control", "no-cache, no-transform");
            c.header("Connection", "keep-alive");
            c.header("X-Accel-Buffering", "no");
            return streamSSE(c, async (stream) => {
                try {
                    const Generator = ChatLogic.ProcessStreamingCompletion(
                        Body,
                        StartTime,
                        0,
                        ApiKeyId,
                        rawIp,
                        userAgent
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
                    const status =
                        (error as { status?: number; statusCode?: number })?.status ||
                        (error as { status?: number; statusCode?: number })?.statusCode ||
                        (/no active provider connection|not found/i.test(
                            error instanceof Error ? error.message : String(error)
                        )
                            ? 404
                            : 500);
                    const ErrorMessage =
                        error instanceof Error ? error.message : "Error occurred during streaming";
                    await stream.writeSSE({
                        data: JSON.stringify(FormatErrorPayload(ErrorMessage, status))
                    });
                }
            });
        }

        try {
            const ResponseData = await ChatLogic.ProcessNonStreamingCompletion(
                Body,
                StartTime,
                0,
                ApiKeyId,
                rawIp,
                userAgent
            );
            return Ok(c, ResponseData);
        } catch (error) {
            const status =
                (error as { status?: number; statusCode?: number })?.status ||
                (error as { status?: number; statusCode?: number })?.statusCode ||
                (/no active provider connection|not found/i.test(
                    error instanceof Error ? error.message : String(error)
                )
                    ? 404
                    : 500);
            const ErrorMessage = error instanceof Error ? error.message : "Internal server error";
            return Err(c, ErrorMessage, ToContentfulStatusCode(status));
        }
    }
}
