import {
    findMatchingFallbackRulesDB,
    getTokenSaverSettingsDB,
    logRequestDB,
    incrementAPIKeyUsageDB
} from "@srouter/db";
import { applyTokenSaver, estimateCostForUsage, extractUsageBreakdown } from "@srouter/translator";
import { providerTypeForAlias } from "@srouter/constants";
import type {
    ChatCompletionChunk,
    ChatCompletionRequest,
    ChatCompletionResponse,
    ChatMessage,
    FallbackRule,
    JSONValue,
    ToolCall,
    UsageInfo
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

interface CandidateModel {
    model: string;
    rule?: FallbackRule;
}

interface ErrorWithStatus {
    status?: number;
    statusCode?: number;
    message?: string;
}

function ExtractStatusCode(
    err: Error | ErrorWithStatus | string | null | undefined
): number | undefined {
    if (!err) return undefined;
    if (typeof err === "object") {
        if ("status" in err && typeof err.status === "number") {
            return err.status;
        }
        if ("statusCode" in err && typeof err.statusCode === "number") {
            return err.statusCode;
        }
    }
    const msg = typeof err === "string" ? err : err.message || String(err);
    const match = msg.match(/\b(429|403|500|502|503|504|400|401|402|422)\b/);
    if (match) return parseInt(match[1]!, 10);
    return undefined;
}

function ShouldTriggerFallback(
    rule: FallbackRule,
    err: Error | ErrorWithStatus | string | null | undefined
): boolean {
    if (!rule.enabled) return false;
    if (!rule.triggerOnStatus || rule.triggerOnStatus.length === 0) return true;
    const status = ExtractStatusCode(err);
    if (status && rule.triggerOnStatus.includes(status)) return true;
    const msg = typeof err === "string" ? err : err ? err.message || String(err) : "";
    if (
        /rate\s*limit|too\s+many\s+requests|quota|exhausted|capacity|high\s+traffic|overloaded|no active provider connection|not found|unknown model|invalid model|no provider found|insufficient tokens|insufficient_quota|billing_error/i.test(
            msg
        )
    ) {
        return true;
    }
    return status === undefined;
}

async function ResolveCandidates(originalModel: string): Promise<CandidateModel[]> {
    const matchingRules = await findMatchingFallbackRulesDB(originalModel);
    const candidates: CandidateModel[] = [{ model: originalModel }];
    const visitedModels = new Set<string>([originalModel]);

    for (const rule of matchingRules) {
        if (!visitedModels.has(rule.targetModel)) {
            visitedModels.add(rule.targetModel);
            candidates.push({ model: rule.targetModel, rule });
        }
    }
    return candidates;
}

async function LogCompletion(
    providerId: string,
    model: string,
    startTime: number,
    options: {
        statusCode: number;
        usage?: UsageInfo;
        fallbackOccurred?: boolean;
        fallbackPath?: string[];
        fallbackReason?: string;
        apiKeyId?: string;
    }
): Promise<void> {
    // Normalize alias/bare provider id to the registered base id so quota
    // attribution matches. e.g. "zen" / "opencode" -> "opencode_zen".
    const normalizedProviderId = providerTypeForAlias(providerId) ?? providerId;
    const breakdown = extractUsageBreakdown(
        normalizedProviderId,
        options.usage as JSONValue | undefined
    );
    const effectiveModel = model;
    const effectiveProvider = effectiveModel.includes("/")
        ? effectiveModel.split("/")[0]!
        : providerId;
    const estimatedCost =
        options.statusCode === 200
            ? estimateCostForUsage(effectiveProvider, effectiveModel, breakdown)
            : undefined;

    if (options.statusCode === 200 && options.apiKeyId && breakdown.total_tokens > 0) {
        incrementAPIKeyUsageDB(options.apiKeyId, breakdown.total_tokens, estimatedCost ?? 0);
    }

    logRequestDB({
        apiKeyId: options.apiKeyId,
        providerId: normalizedProviderId,
        model,
        promptTokens: options.statusCode === 200 ? breakdown.prompt_tokens : 0,
        completionTokens: options.statusCode === 200 ? breakdown.completion_tokens : 0,
        totalTokens: options.statusCode === 200 ? breakdown.total_tokens : 0,
        cachedTokens: options.statusCode === 200 ? breakdown.cached_tokens : undefined,
        cacheCreationTokens:
            options.statusCode === 200 ? breakdown.cache_creation_tokens : undefined,
        reasoningTokens: options.statusCode === 200 ? breakdown.reasoning_tokens : undefined,
        estimatedCost,
        fallbackOccurred: options.fallbackOccurred,
        fallbackPath: options.fallbackOccurred ? options.fallbackPath?.join(" -> ") : undefined,
        fallbackReason: options.fallbackReason,
        statusCode: options.statusCode,
        latencyMs: Date.now() - startTime
    });
}

export class ChatLogic {
    public static async ProcessNonStreamingCompletion(
        body: ChatCompletionRequest,
        startTime: number,
        depth = 0,
        apiKeyId?: string
    ): Promise<ChatCompletionResponse> {
        const effectiveBody =
            depth === 0 ? applyTokenSaver(body, await getTokenSaverSettingsDB()).request : body;
        const originalModel = effectiveBody.model;
        const candidates = await ResolveCandidates(originalModel);

        let lastError: Error | ErrorWithStatus | string | null = null;
        const fallbackPath: string[] = [originalModel];
        let fallbackOccurred = false;
        let fallbackReason: string | undefined;

        for (let i = 0; i < candidates.length; i++) {
            const candidate = candidates[i]!;
            const isFallbackAttempt = i > 0;

            if (isFallbackAttempt && candidate.rule && lastError) {
                if (!ShouldTriggerFallback(candidate.rule, lastError)) {
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
                    return await this.ProcessNonStreamingCompletion(
                        followUpRequest,
                        startTime,
                        depth + 1,
                        apiKeyId
                    );
                }

                await LogCompletion(providerId, currentModel, startTime, {
                    statusCode: 200,
                    usage: response.usage,
                    fallbackOccurred,
                    fallbackPath,
                    fallbackReason,
                    apiKeyId
                });

                return response;
            } catch (err) {
                lastError = err instanceof Error ? err : (err as ErrorWithStatus);
                if (!fallbackReason) {
                    fallbackReason = err instanceof Error ? err.message : String(err);
                }

                if (i < candidates.length - 1) {
                    continue;
                }
            }
        }

        const provider = originalModel.split("/")[0] || "default";
        LogCompletion(provider, originalModel, startTime, {
            statusCode: 500,
            fallbackOccurred,
            fallbackPath,
            fallbackReason,
            apiKeyId
        });

        throw lastError;
    }

    public static processNonStreamingCompletion = ChatLogic.ProcessNonStreamingCompletion;

    public static async *ProcessStreamingCompletion(
        body: ChatCompletionRequest,
        startTime: number,
        depth = 0,
        apiKeyId?: string
    ): AsyncGenerator<ChatCompletionChunk, void, void> {
        const effectiveBody =
            depth === 0 ? applyTokenSaver(body, await getTokenSaverSettingsDB()).request : body;
        const originalModel = effectiveBody.model;
        const candidates = await ResolveCandidates(originalModel);

        let lastError: Error | ErrorWithStatus | string | null = null;
        const fallbackPath: string[] = [originalModel];
        let fallbackOccurred = false;
        let fallbackReason: string | undefined;

        for (let i = 0; i < candidates.length; i++) {
            const candidate = candidates[i]!;
            const isFallbackAttempt = i > 0;

            if (isFallbackAttempt && candidate.rule && lastError) {
                if (!ShouldTriggerFallback(candidate.rule, lastError)) {
                    continue;
                }
            }

            const currentModel = candidate.model;
            const currentReq: ChatCompletionRequest = { ...effectiveBody, model: currentModel };
            const providerId = currentModel.split("/")[0] || "default";

            let yieldedAny = false;
            let usage: UsageInfo | undefined = undefined;

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
                    yield* this.ProcessStreamingCompletion(
                        followUpRequest,
                        startTime,
                        depth + 1,
                        apiKeyId
                    );
                    return;
                }

                for (const chunk of bufferedChunks) {
                    yield chunk;
                }

                LogCompletion(providerId, currentModel, startTime, {
                    statusCode: 200,
                    usage,
                    fallbackOccurred,
                    fallbackPath,
                    fallbackReason,
                    apiKeyId
                });

                return;
            } catch (err) {
                lastError = err instanceof Error ? err : (err as ErrorWithStatus);
                if (!fallbackReason) {
                    fallbackReason = err instanceof Error ? err.message : String(err);
                }

                if (!yieldedAny && i < candidates.length - 1) {
                    continue;
                }

                const provider = currentModel.split("/")[0] || "default";
                LogCompletion(provider, currentModel, startTime, {
                    statusCode: 500,
                    fallbackOccurred,
                    fallbackPath,
                    fallbackReason,
                    apiKeyId
                });
                throw err;
            }
        }

        if (lastError) throw lastError;
    }

    public static processStreamingCompletion = ChatLogic.ProcessStreamingCompletion;
}
