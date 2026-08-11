import { logRequestDB } from "@srouter/db";
import { extractUsageBreakdown, estimateCostForUsage } from "@srouter/translator";
import type { ChatCompletionChunk, ChatCompletionRequest, ChatCompletionResponse } from "@srouter/types";
import { registry } from "@/services/registry.js";
import { ensureFreshToken } from "@/services/tokenRefresh.js";

export class ChatLogic {
    public static async processNonStreamingCompletion(body: ChatCompletionRequest, startTime: number): Promise<ChatCompletionResponse> {
        try {
            // Lazy token refresh: ensure the target provider's token is fresh before dispatch
            const providerId = body.model.split("/")[0] || "default";
            await ensureFreshToken(providerId);

            const response = await registry.chatCompletion(body);
            const latencyMs = Date.now() - startTime;
            const provider = body.model.split("/")[0] || "default";
            const breakdown = extractUsageBreakdown(provider, response.usage);

            logRequestDB({
                providerId: provider,
                model: body.model,
                promptTokens: breakdown.promptTokens,
                completionTokens: breakdown.completionTokens,
                totalTokens: breakdown.totalTokens,
                cachedTokens: breakdown.cachedTokens,
                cacheCreationTokens: breakdown.cacheCreationTokens,
                reasoningTokens: breakdown.reasoningTokens,
                estimatedCost: estimateCostForUsage(provider, body.model, breakdown),
                statusCode: 200,
                latencyMs,
            });

            return response;
        } catch (err) {
            logRequestDB({
                providerId: body.model.split("/")[0] || "default",
                model: body.model,
                promptTokens: 0,
                completionTokens: 0,
                totalTokens: 0,
                statusCode: 500,
                latencyMs: Date.now() - startTime,
            });
            throw err;
        }
    }

    public static async *processStreamingCompletion(body: ChatCompletionRequest, startTime: number): AsyncGenerator<ChatCompletionChunk, void, void> {
        const provider = body.model.split("/")[0] || "default";
        let usage: unknown = null;
        try {
            // Lazy token refresh also applies to streaming requests
            await ensureFreshToken(provider);

            const generator = registry.chatCompletionStream(body);
            for await (const chunk of generator) {
                if (chunk.usage) {
                    usage = chunk.usage;
                }
                yield chunk;
            }

            const breakdown = extractUsageBreakdown(provider, usage);
            logRequestDB({
                providerId: provider,
                model: body.model,
                promptTokens: breakdown.promptTokens,
                completionTokens: breakdown.completionTokens,
                totalTokens: breakdown.totalTokens,
                cachedTokens: breakdown.cachedTokens,
                cacheCreationTokens: breakdown.cacheCreationTokens,
                reasoningTokens: breakdown.reasoningTokens,
                estimatedCost: estimateCostForUsage(provider, body.model, breakdown),
                statusCode: 200,
                latencyMs: Date.now() - startTime,
            });
        } catch (err) {
            logRequestDB({
                providerId: provider,
                model: body.model,
                promptTokens: 0,
                completionTokens: 0,
                totalTokens: 0,
                statusCode: 500,
                latencyMs: Date.now() - startTime,
            });
            throw err;
        }
    }
}
