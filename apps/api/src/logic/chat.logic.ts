import { findMatchingFallbackRulesDB, getTokenSaverSettingsDB, logRequestDB } from "@srouter/db";
import { applyTokenSaver, estimateCostForUsage, extractUsageBreakdown } from "@srouter/translator";
import type {
    ChatCompletionChunk,
    ChatCompletionRequest,
    ChatCompletionResponse,
    ChatMessage,
    FallbackRule,
    ToolCall
} from "@srouter/types";
import { registry } from "@/services/registry.js";
import { ensureFreshToken } from "@/services/tokenRefresh.js";
import { executeInterceptedSearch, shouldInterceptToolCall } from "@/services/toolInterceptor.js";

const MAX_INTERCEPT_DEPTH = 3;

interface AssembledStreamingToolCall {
    id: string;
    name: string;
    arguments: string;
}

function extractStatusCode(err: unknown): number | undefined {
    if (!err) return undefined;
    if (typeof err === "object") {
        if ("status" in err && typeof (err as { status?: unknown }).status === "number") {
            return (err as { status: number }).status;
        }
        if (
            "statusCode" in err &&
            typeof (err as { statusCode?: unknown }).statusCode === "number"
        ) {
            return (err as { statusCode: number }).statusCode;
        }
    }
    const msg = err instanceof Error ? err.message : String(err);
    const match = msg.match(/\b(429|403|500|502|503|504|400|401)\b/);
    if (match) return parseInt(match[1]!, 10);
    return undefined;
}

function shouldTriggerFallback(rule: FallbackRule, err: unknown): boolean {
    if (!rule.enabled) return false;
    if (!rule.triggerOnStatus || rule.triggerOnStatus.length === 0) return true;
    const status = extractStatusCode(err);
    if (status && rule.triggerOnStatus.includes(status)) return true;
    const msg = err instanceof Error ? err.message : String(err);
    if (/rate\s*limit|too\s+many\s+requests|quota|exhausted|capacity|high\s+traffic/i.test(msg)) {
        return rule.triggerOnStatus.includes(429) || rule.triggerOnStatus.includes(403);
    }
    return false;
}

export class ChatLogic {
    public static async processNonStreamingCompletion(
        body: ChatCompletionRequest,
        startTime: number,
        depth = 0
    ): Promise<ChatCompletionResponse> {
        const effectiveBody =
            depth === 0 ? applyTokenSaver(body, getTokenSaverSettingsDB()).request : body;
        const originalModel = effectiveBody.model;
        const matchingRules = findMatchingFallbackRulesDB(originalModel);

        const candidates: Array<{ model: string; rule?: FallbackRule }> = [
            { model: originalModel }
        ];
        const visitedModels = new Set<string>([originalModel]);

        for (const rule of matchingRules) {
            if (!visitedModels.has(rule.targetModel)) {
                visitedModels.add(rule.targetModel);
                candidates.push({ model: rule.targetModel, rule });
            }
        }

        let lastError: unknown = null;
        const fallbackPath: string[] = [originalModel];
        let fallbackOccurred = false;
        let fallbackReason: string | undefined;

        for (let i = 0; i < candidates.length; i++) {
            const candidate = candidates[i]!;
            const isFallbackAttempt = i > 0;

            if (isFallbackAttempt && candidate.rule && lastError) {
                if (!shouldTriggerFallback(candidate.rule, lastError)) {
                    continue;
                }
            }

            const currentModel = candidate.model;
            const currentReq: ChatCompletionRequest = { ...effectiveBody, model: currentModel };
            const providerId = currentModel.split("/")[0] || "default";

            try {
                await ensureFreshToken(providerId);
                const response = await registry.chatCompletion(currentReq);

                if (isFallbackAttempt) {
                    fallbackOccurred = true;
                    fallbackPath.push(currentModel);
                }

                const choice = response.choices?.[0];
                const toolCalls = choice?.message?.tool_calls;

                // Check if model returned tool calls that should be intercepted server-side
                if (
                    depth < MAX_INTERCEPT_DEPTH &&
                    Array.isArray(toolCalls) &&
                    toolCalls.length > 0 &&
                    toolCalls.some((tc) =>
                        shouldInterceptToolCall(tc.function.name, effectiveBody.tools)
                    )
                ) {
                    const updatedMessages: ChatMessage[] = [
                        ...effectiveBody.messages,
                        choice.message
                    ];

                    for (const tc of toolCalls) {
                        if (shouldInterceptToolCall(tc.function.name, effectiveBody.tools)) {
                            const { toolCallId, result } = await executeInterceptedSearch(tc);
                            updatedMessages.push({
                                role: "tool",
                                tool_call_id: toolCallId,
                                content: JSON.stringify(result)
                            });
                        }
                    }

                    const followUpRequest: ChatCompletionRequest = {
                        ...currentReq,
                        messages: updatedMessages
                    };
                    return await this.processNonStreamingCompletion(
                        followUpRequest,
                        startTime,
                        depth + 1
                    );
                }

                const latencyMs = Date.now() - startTime;
                const breakdown = extractUsageBreakdown(providerId, response.usage);
                const effectiveModel = currentModel;
                const effectiveProvider = effectiveModel.includes("/")
                    ? effectiveModel.split("/")[0]!
                    : providerId;

                logRequestDB({
                    providerId,
                    model: currentModel,
                    promptTokens: breakdown.promptTokens,
                    completionTokens: breakdown.completionTokens,
                    totalTokens: breakdown.totalTokens,
                    cachedTokens: breakdown.cachedTokens,
                    cacheCreationTokens: breakdown.cacheCreationTokens,
                    reasoningTokens: breakdown.reasoningTokens,
                    estimatedCost: estimateCostForUsage(
                        effectiveProvider,
                        effectiveModel,
                        breakdown
                    ),
                    fallbackOccurred,
                    fallbackPath: fallbackOccurred ? fallbackPath.join(" -> ") : undefined,
                    fallbackReason,
                    statusCode: 200,
                    latencyMs
                });

                return response;
            } catch (err) {
                lastError = err;
                if (!fallbackReason) {
                    fallbackReason = err instanceof Error ? err.message : String(err);
                }

                // If this wasn't the last candidate, try next fallback
                if (i < candidates.length - 1) {
                    continue;
                }
            }
        }

        const provider = originalModel.split("/")[0] || "default";
        logRequestDB({
            providerId: provider,
            model: originalModel,
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
            fallbackOccurred,
            fallbackPath: fallbackOccurred ? fallbackPath.join(" -> ") : undefined,
            fallbackReason,
            statusCode: 500,
            latencyMs: Date.now() - startTime
        });

        throw lastError;
    }

    public static async *processStreamingCompletion(
        body: ChatCompletionRequest,
        startTime: number,
        depth = 0
    ): AsyncGenerator<ChatCompletionChunk, void, void> {
        const effectiveBody =
            depth === 0 ? applyTokenSaver(body, getTokenSaverSettingsDB()).request : body;
        const originalModel = effectiveBody.model;
        const matchingRules = findMatchingFallbackRulesDB(originalModel);

        const candidates: Array<{ model: string; rule?: FallbackRule }> = [
            { model: originalModel }
        ];
        const visitedModels = new Set<string>([originalModel]);

        for (const rule of matchingRules) {
            if (!visitedModels.has(rule.targetModel)) {
                visitedModels.add(rule.targetModel);
                candidates.push({ model: rule.targetModel, rule });
            }
        }

        let lastError: unknown = null;
        const fallbackPath: string[] = [originalModel];
        let fallbackOccurred = false;
        let fallbackReason: string | undefined;

        for (let i = 0; i < candidates.length; i++) {
            const candidate = candidates[i]!;
            const isFallbackAttempt = i > 0;

            if (isFallbackAttempt && candidate.rule && lastError) {
                if (!shouldTriggerFallback(candidate.rule, lastError)) {
                    continue;
                }
            }

            const currentModel = candidate.model;
            const currentReq: ChatCompletionRequest = { ...effectiveBody, model: currentModel };
            const providerId = currentModel.split("/")[0] || "default";

            let yieldedAny = false;
            let usage: unknown = null;

            try {
                await ensureFreshToken(providerId);
                const generator = registry.chatCompletionStream(currentReq);

                const bufferedChunks: ChatCompletionChunk[] = [];
                const toolCallsMap = new Map<number, AssembledStreamingToolCall>();
                let hasToolCalls = false;
                let assistantContent = "";

                for await (const chunk of generator) {
                    if (!yieldedAny) {
                        yieldedAny = true;
                        if (isFallbackAttempt) {
                            fallbackOccurred = true;
                            fallbackPath.push(currentModel);
                        }
                    }

                    if (chunk.usage) {
                        usage = chunk.usage;
                    }

                    const choice = chunk.choices?.[0];
                    const delta = choice?.delta;

                    if (delta?.content) {
                        assistantContent += delta.content;
                    }

                    if (Array.isArray(delta?.tool_calls) && delta.tool_calls.length > 0) {
                        hasToolCalls = true;
                        for (const tc of delta.tool_calls) {
                            const idx = tc.index ?? toolCallsMap.size;
                            const existing = toolCallsMap.get(idx) || {
                                id: tc.id || `call_${Date.now()}_${idx}`,
                                name: tc.function?.name || "",
                                arguments: ""
                            };
                            if (tc.id) existing.id = tc.id;
                            if (tc.function?.name) existing.name = tc.function.name;
                            if (tc.function?.arguments) existing.arguments += tc.function.arguments;
                            toolCallsMap.set(idx, existing);
                        }
                    }

                    if (hasToolCalls) {
                        bufferedChunks.push(chunk);
                    } else {
                        yield chunk;
                    }
                }

                const assembledToolCalls = Array.from(toolCallsMap.values());
                const hasInterceptableCall =
                    depth < MAX_INTERCEPT_DEPTH &&
                    assembledToolCalls.some((tc) =>
                        shouldInterceptToolCall(tc.name, effectiveBody.tools)
                    );

                if (hasInterceptableCall) {
                    const assistantToolCalls: ToolCall[] = assembledToolCalls.map((tc) => ({
                        id: tc.id,
                        type: "function",
                        function: {
                            name: tc.name,
                            arguments: tc.arguments
                        }
                    }));

                    const assistantMessage: ChatMessage = {
                        role: "assistant",
                        content: assistantContent || null,
                        tool_calls: assistantToolCalls
                    };

                    const updatedMessages: ChatMessage[] = [
                        ...effectiveBody.messages,
                        assistantMessage
                    ];

                    for (const tc of assembledToolCalls) {
                        if (shouldInterceptToolCall(tc.name, effectiveBody.tools)) {
                            const { toolCallId, result } = await executeInterceptedSearch({
                                id: tc.id,
                                function: { name: tc.name, arguments: tc.arguments }
                            });
                            updatedMessages.push({
                                role: "tool",
                                tool_call_id: toolCallId,
                                content: JSON.stringify(result)
                            });
                        }
                    }

                    const followUpRequest: ChatCompletionRequest = {
                        ...currentReq,
                        messages: updatedMessages
                    };
                    yield* this.processStreamingCompletion(followUpRequest, startTime, depth + 1);
                    return;
                }

                // If not intercepted, flush all buffered tool call chunks to client
                for (const chunk of bufferedChunks) {
                    yield chunk;
                }

                const breakdown = extractUsageBreakdown(providerId, usage);
                const effectiveModel = currentModel;
                const effectiveProvider = effectiveModel.includes("/")
                    ? effectiveModel.split("/")[0]!
                    : providerId;

                logRequestDB({
                    providerId,
                    model: currentModel,
                    promptTokens: breakdown.promptTokens,
                    completionTokens: breakdown.completionTokens,
                    totalTokens: breakdown.totalTokens,
                    cachedTokens: breakdown.cachedTokens,
                    cacheCreationTokens: breakdown.cacheCreationTokens,
                    reasoningTokens: breakdown.reasoningTokens,
                    estimatedCost: estimateCostForUsage(
                        effectiveProvider,
                        effectiveModel,
                        breakdown
                    ),
                    fallbackOccurred,
                    fallbackPath: fallbackOccurred ? fallbackPath.join(" -> ") : undefined,
                    fallbackReason,
                    statusCode: 200,
                    latencyMs: Date.now() - startTime
                });

                return;
            } catch (err) {
                lastError = err;
                if (!fallbackReason) {
                    fallbackReason = err instanceof Error ? err.message : String(err);
                }

                // If we haven't yielded anything yet, we can safely try the next candidate
                if (!yieldedAny && i < candidates.length - 1) {
                    continue;
                }

                // If already yielded or no more candidates, log failure and throw
                const provider = currentModel.split("/")[0] || "default";
                logRequestDB({
                    providerId: provider,
                    model: currentModel,
                    promptTokens: 0,
                    completionTokens: 0,
                    totalTokens: 0,
                    fallbackOccurred,
                    fallbackPath: fallbackOccurred ? fallbackPath.join(" -> ") : undefined,
                    fallbackReason,
                    statusCode: 500,
                    latencyMs: Date.now() - startTime
                });
                throw err;
            }
        }

        if (lastError) throw lastError;
    }
}
