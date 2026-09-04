import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import {
    AnthropicToOpenAIRequest,
    OpenAIToAnthropicResponse,
    OpenAIToAnthropicStream
} from "@srouter/translator";
import { AnthropicMessageRequestSchema, type AnthropicMessageRequest } from "@srouter/types";
import { ChatLogic } from "@/logic/chat.logic.js";
import {
    AnthropicErr,
    FormatAnthropicErrorPayload,
    Ok,
    ToContentfulStatusCode
} from "@/utils/response.js";
import { GetApiKeyRow, IsModelAllowed } from "@/middleware/ModelAccess.js";
import { MAX_BODY_BYTES } from "@/middleware/BodyLimit.js";

export class MessagesController {
    public static async CreateMessage(c: Context): Promise<Response> {
        const startTime = Date.now();
        const Raw = await c.req.text().catch(() => "");
        if (Buffer.byteLength(Raw) > MAX_BODY_BYTES) {
            return AnthropicErr(c, "Request body too large", 413, "invalid_request_error");
        }
        let rawBody: unknown = null;
        try {
            rawBody = JSON.parse(Raw);
        } catch {
            rawBody = null;
        }
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
        const isThinkingEnabled = body.thinking?.type !== "disabled";
        const rawIp =
            c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
            c.req.header("x-real-ip") ||
            c.req.header("cf-connecting-ip") ||
            "127.0.0.1";

        if (body.stream) {
            c.header("Content-Type", "text/event-stream");
            c.header("Cache-Control", "no-cache, no-transform");
            c.header("Connection", "keep-alive");
            c.header("X-Accel-Buffering", "no");

            return streamSSE(c, async (stream) => {
                try {
                    const chunkGenerator = ChatLogic.ProcessStreamingCompletion(
                        OpenAIReq,
                        startTime,
                        0,
                        ApiKeyId,
                        rawIp
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
                    const status =
                        (error as { status?: number; statusCode?: number })?.status ||
                        (error as { status?: number; statusCode?: number })?.statusCode ||
                        (/no active provider connection|not found/i.test(
                            error instanceof Error ? error.message : String(error)
                        )
                            ? 404
                            : 500);
                    const errorMessage =
                        error instanceof Error ? error.message : "Error occurred during streaming";
                    await stream.writeSSE({
                        event: "error",
                        data: JSON.stringify(FormatAnthropicErrorPayload(errorMessage, status))
                    });
                }
            });
        }

        try {
            const OpenAIRes = await ChatLogic.ProcessNonStreamingCompletion(
                OpenAIReq,
                startTime,
                0,
                ApiKeyId,
                rawIp
            );
            const AnthropicRes = OpenAIToAnthropicResponse(OpenAIRes, body.model, {
                allowThinking: isThinkingEnabled
            });
            return Ok(c, AnthropicRes);
        } catch (error) {
            const status =
                (error as { status?: number; statusCode?: number })?.status ||
                (error as { status?: number; statusCode?: number })?.statusCode ||
                (/no active provider connection|not found/i.test(
                    error instanceof Error ? error.message : String(error)
                )
                    ? 404
                    : 500);
            const errorMessage = error instanceof Error ? error.message : "Internal server error";
            return AnthropicErr(c, errorMessage, ToContentfulStatusCode(status));
        }
    }
}
