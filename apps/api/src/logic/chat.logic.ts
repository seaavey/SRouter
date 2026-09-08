import { getTokenSaverSettingsDB, logRequestDB, incrementAPIKeyUsageDB } from "@srouter/db";
import { applyTokenSaver, estimateCostForUsage, extractUsageBreakdown } from "@srouter/translator";
import { providerTypeForAlias } from "@srouter/constants";
import type {
    ChatCompletionChunk,
    ChatCompletionRequest,
    ChatCompletionResponse,
    ChatMessage,
    JSONValue,
    ToolCall,
    RequestAttemptBudget,
    UsageInfo
} from "@srouter/types";
import { CreateRequestAttemptBudget } from "@srouter/types";
import { registry } from "@/services/registry.js";
import { executeInterceptedSearch, shouldInterceptToolCall } from "@/services/toolInterceptor.js";
import { type AttemptTracker, RunCandidateAttempts } from "./fallbackRunner.js";
import { type ErrorWithStatus, ExtractStatusCode } from "./fallback.policy.js";

const MAX_INTERCEPT_DEPTH = 3;

interface AssembledStreamingToolCall {
    id: string;
    name: string;
    arguments: string;
}

interface RequestContext {
    startTime: number;
    depth: number;
    apiKeyId?: string;
    ipAddress?: string;
    userAgent?: string;
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
        ipAddress?: string;
        userAgent?: string;
    }
): Promise<void> {
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
        ipAddress: options.ipAddress,
        userAgent: options.userAgent,
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

function LogFailure(originalModel: string, ctx: RequestContext, tracker: AttemptTracker): void {
    const provider = originalModel.split("/")[0] || "default";
    const errorStatusCode = ExtractStatusCode(tracker.lastError) ?? 500;
    LogCompletion(provider, originalModel, ctx.startTime, {
        statusCode: errorStatusCode,
        fallbackOccurred: tracker.fallbackOccurred,
        fallbackPath: tracker.fallbackPath,
        fallbackReason: tracker.fallbackReason,
        apiKeyId: ctx.apiKeyId,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent
    });
}

async function BuildFollowUpSearchMessages(
    baseMessages: ChatMessage[],
    assistantMessage: ChatMessage,
    toolCalls: Array<{ id: string; name: string; arguments: string }>,
    clientTools?: ChatCompletionRequest["tools"]
): Promise<ChatMessage[]> {
    const updatedMessages: ChatMessage[] = [...baseMessages, assistantMessage];
    for (const tc of toolCalls) {
        if (shouldInterceptToolCall(tc.name, clientTools)) {
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
    return updatedMessages;
}

export class ChatLogic {
    public static async ProcessNonStreamingCompletion(
        body: ChatCompletionRequest,
        startTime: number,
        depth = 0,
        apiKeyId?: string,
        ipAddress?: string,
        userAgent?: string,
        budget?: RequestAttemptBudget
    ): Promise<ChatCompletionResponse> {
        const requestBudget = budget ?? CreateRequestAttemptBudget();
        const ctx: RequestContext = { startTime, depth, apiKeyId, ipAddress, userAgent };
        const effectiveBody =
            depth === 0 ? applyTokenSaver(body, await getTokenSaverSettingsDB()).request : body;
        const originalModel = effectiveBody.model;
        const tracker: AttemptTracker = {
            fallbackPath: [originalModel],
            fallbackOccurred: false,
            fallbackReason: undefined,
            lastError: null
        };
        for await (const attempt of RunCandidateAttempts(originalModel, tracker)) {
            const { currentModel, isFallbackAttempt, providerId } = attempt;
            const currentReq: ChatCompletionRequest = { ...effectiveBody, model: currentModel };

            try {
                const response = await registry.chatCompletion(currentReq, requestBudget);

                if (isFallbackAttempt) {
                    tracker.fallbackOccurred = true;
                    tracker.fallbackPath.push(currentModel);
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
                    const searchCalls = toolCalls.map((tc) => ({
                        id: tc.id,
                        name: tc.function.name,
                        arguments: tc.function.arguments
                    }));
                    const updatedMessages = await BuildFollowUpSearchMessages(
                        effectiveBody.messages,
                        choice.message,
                        searchCalls,
                        effectiveBody.tools
                    );
                    const followUpRequest: ChatCompletionRequest = {
                        ...currentReq,
                        messages: updatedMessages
                    };
                    return await this.ProcessNonStreamingCompletion(
                        followUpRequest,
                        startTime,
                        depth + 1,
                        apiKeyId,
                        ipAddress,
                        userAgent,
                        requestBudget
                    );
                }

                await LogCompletion(providerId, currentModel, startTime, {
                    statusCode: 200,
                    usage: response.usage,
                    fallbackOccurred: tracker.fallbackOccurred,
                    fallbackPath: tracker.fallbackPath,
                    fallbackReason: tracker.fallbackReason,
                    apiKeyId,
                    ipAddress,
                    userAgent
                });

                return response;
            } catch (err) {
                tracker.lastError = err instanceof Error ? err : (err as ErrorWithStatus);
                if (!tracker.fallbackReason) {
                    tracker.fallbackReason = err instanceof Error ? err.message : String(err);
                }
            }
        }

        LogFailure(originalModel, ctx, tracker);
        throw tracker.lastError;
    }

    public static processNonStreamingCompletion = ChatLogic.ProcessNonStreamingCompletion;

    public static async *ProcessStreamingCompletion(
        body: ChatCompletionRequest,
        startTime: number,
        depth = 0,
        apiKeyId?: string,
        ipAddress?: string,
        userAgent?: string,
        budget?: RequestAttemptBudget
    ): AsyncGenerator<ChatCompletionChunk, void, void> {
        const requestBudget = budget ?? CreateRequestAttemptBudget();
        const ctx: RequestContext = { startTime, depth, apiKeyId, ipAddress, userAgent };
        const effectiveBody =
            depth === 0 ? applyTokenSaver(body, await getTokenSaverSettingsDB()).request : body;
        const originalModel = effectiveBody.model;
        const tracker: AttemptTracker = {
            fallbackPath: [originalModel],
            fallbackOccurred: false,
            fallbackReason: undefined,
            lastError: null
        };

        for await (const attempt of RunCandidateAttempts(originalModel, tracker)) {
            const { currentModel, isFallbackAttempt, providerId } = attempt;
            const currentReq: ChatCompletionRequest = { ...effectiveBody, model: currentModel };

            let yieldedAny = false;
            let usage: UsageInfo | undefined = undefined;

            try {
                const generator = registry.chatCompletionStream(currentReq, requestBudget);

                const bufferedChunks: ChatCompletionChunk[] = [];
                const toolCallsMap = new Map<number, AssembledStreamingToolCall>();
                let hasToolCalls = false;
                let assistantContent = "";

                for await (const chunk of generator) {
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
                        if (!yieldedAny) {
                            yieldedAny = true;
                            if (isFallbackAttempt) {
                                tracker.fallbackOccurred = true;
                                tracker.fallbackPath.push(currentModel);
                            }
                        }
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

                    const updatedMessages = await BuildFollowUpSearchMessages(
                        effectiveBody.messages,
                        assistantMessage,
                        assembledToolCalls,
                        effectiveBody.tools
                    );

                    const followUpRequest: ChatCompletionRequest = {
                        ...currentReq,
                        messages: updatedMessages
                    };
                    yield* this.ProcessStreamingCompletion(
                        followUpRequest,
                        startTime,
                        depth + 1,
                        apiKeyId,
                        ipAddress,
                        userAgent,
                        requestBudget
                    );
                    return;
                }

                for (const chunk of bufferedChunks) {
                    yield chunk;
                }

                LogCompletion(providerId, currentModel, startTime, {
                    statusCode: 200,
                    usage,
                    fallbackOccurred: tracker.fallbackOccurred,
                    fallbackPath: tracker.fallbackPath,
                    fallbackReason: tracker.fallbackReason,
                    apiKeyId,
                    ipAddress,
                    userAgent
                });

                return;
            } catch (err) {
                tracker.lastError = err instanceof Error ? err : (err as ErrorWithStatus);
                if (!tracker.fallbackReason) {
                    tracker.fallbackReason = err instanceof Error ? err.message : String(err);
                }

                if (yieldedAny) {
                    const provider = currentModel.split("/")[0] || "default";
                    const errorStatusCode =
                        ExtractStatusCode(err instanceof Error ? err : (err as ErrorWithStatus)) ??
                        500;
                    LogCompletion(provider, currentModel, startTime, {
                        statusCode: errorStatusCode,
                        fallbackOccurred: tracker.fallbackOccurred,
                        fallbackPath: tracker.fallbackPath,
                        fallbackReason: tracker.fallbackReason,
                        apiKeyId,
                        ipAddress,
                        userAgent
                    });
                    throw err;
                }
            }
        }

        if (tracker.lastError) throw tracker.lastError;
    }

    public static processStreamingCompletion = ChatLogic.ProcessStreamingCompletion;
}
