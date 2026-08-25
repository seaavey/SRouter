import { randomUUID } from "node:crypto";
import type {
    AnthropicContentBlock,
    AnthropicMessage,
    AnthropicMessageRequest,
    AnthropicMessageResponse,
    AnthropicStreamEvent,
    AnthropicTool,
    ChatCompletionChunk,
    ChatCompletionRequest,
    ChatCompletionResponse,
    ChatMessage,
    ChatMessageContentPart,
    FinishReason,
    ToolCall,
    ToolDefinition
} from "@srouter/types";

/**
 * Converts Anthropic format Messages API request to OpenAI format ChatCompletionRequest.
 */
export function AnthropicToOpenAIRequest(req: AnthropicMessageRequest): ChatCompletionRequest {
    const messages: ChatMessage[] = [];

    // 1. Process system prompt
    if (req.system) {
        if (typeof req.system === "string") {
            messages.push({ role: "system", content: req.system });
        } else if (Array.isArray(req.system)) {
            const systemText = req.system
                .map((b) => (b.type === "text" ? b.text || "" : ""))
                .filter(Boolean)
                .join("\n\n");
            if (systemText) {
                messages.push({ role: "system", content: systemText });
            }
        }
    }

    // 2. Process conversation messages
    for (const msg of req.messages || []) {
        if (typeof msg.content === "string") {
            messages.push({
                role: msg.role,
                content: msg.content
            });
            continue;
        }

        if (!Array.isArray(msg.content)) continue;

        // Group content parts and extract tool calls / tool results
        const textAndImageParts: ChatMessageContentPart[] = [];
        const toolCalls: ToolCall[] = [];
        const toolResults: AnthropicContentBlock[] = [];

        for (const block of msg.content) {
            if (block.type === "text") {
                if (block.text) {
                    textAndImageParts.push({ type: "text", text: block.text });
                }
            } else if (block.type === "image" && block.source) {
                textAndImageParts.push({
                    type: "image_url",
                    image_url: {
                        url: `data:${block.source.media_type};base64,${block.source.data}`
                    }
                });
            } else if (block.type === "tool_use") {
                toolCalls.push({
                    id: block.id || `call_${randomUUID().slice(0, 8)}`,
                    type: "function",
                    function: {
                        name: block.name || "",
                        arguments:
                            typeof block.input === "string"
                                ? block.input
                                : JSON.stringify(block.input || {})
                    }
                });
            } else if (block.type === "tool_result") {
                toolResults.push(block);
            }
        }

        // Assistant with tool calls or text
        if (msg.role === "assistant") {
            let contentStr: string | undefined = undefined;
            if (textAndImageParts.length === 1 && textAndImageParts[0]?.type === "text") {
                contentStr = textAndImageParts[0].text;
            } else if (textAndImageParts.length > 1) {
                contentStr = textAndImageParts
                    .map((p) => (p.type === "text" ? p.text : ""))
                    .join("\n");
            }

            messages.push({
                role: "assistant",
                content: contentStr ?? (toolCalls.length > 0 ? null : ""),
                tool_calls: toolCalls.length > 0 ? toolCalls : undefined
            });
        } else if (msg.role === "user") {
            // Check if this user message contains tool results
            if (toolResults.length > 0) {
                for (const tr of toolResults) {
                    let resultText = "";
                    if (typeof tr.content === "string") {
                        resultText = tr.content;
                    } else if (Array.isArray(tr.content)) {
                        resultText = tr.content
                            .map((b) => (b.type === "text" ? b.text || "" : JSON.stringify(b)))
                            .join("\n");
                    }

                    messages.push({
                        role: "tool",
                        tool_call_id: tr.tool_use_id || "",
                        content: resultText
                    });
                }
            }

            // Normal user message content
            if (textAndImageParts.length === 1 && textAndImageParts[0]?.type === "text") {
                messages.push({
                    role: "user",
                    content: textAndImageParts[0].text || ""
                });
            } else if (textAndImageParts.length > 0) {
                messages.push({
                    role: "user",
                    content: textAndImageParts
                });
            }
        }
    }

    // 3. Process tool definitions
    let tools: ToolDefinition[] | undefined = undefined;
    if (Array.isArray(req.tools) && req.tools.length > 0) {
        tools = req.tools.map((t) => {
            const antTool = t as AnthropicTool;
            if ("input_schema" in antTool) {
                const schema = antTool.input_schema || {};
                return {
                    type: "function",
                    function: {
                        name: antTool.name,
                        description: antTool.description,
                        parameters: {
                            type: "object",
                            ...(typeof schema === "object" ? schema : {})
                        }
                    }
                } as ToolDefinition;
            }
            return t as ToolDefinition;
        });
    }

    // 4. Process tool_choice
    let tool_choice: ChatCompletionRequest["tool_choice"] = undefined;
    if (req.tool_choice) {
        if (req.tool_choice.type === "auto") {
            tool_choice = "auto";
        } else if (req.tool_choice.type === "any") {
            tool_choice = "required";
        } else if (req.tool_choice.type === "tool" && req.tool_choice.name) {
            tool_choice = {
                type: "function",
                function: { name: req.tool_choice.name }
            };
        }
    }

    return {
        model: req.model,
        messages,
        max_tokens: req.max_tokens,
        temperature: req.temperature,
        top_p: req.top_p,
        stop: req.stop_sequences,
        tools,
        tool_choice,
        stream: req.stream ?? false
    };
}

function mapFinishReason(
    finishReason?: FinishReason | null
): "end_turn" | "max_tokens" | "stop_sequence" | "tool_use" {
    if (finishReason === "tool_calls" || (finishReason as string) === "function_call") {
        return "tool_use";
    }
    if (finishReason === "length") {
        return "max_tokens";
    }
    if (finishReason === "stop") {
        return "end_turn";
    }
    return "end_turn";
}

/**
 * Converts standard OpenAI ChatCompletionResponse to Anthropic MessageResponse.
 */
export function OpenAIToAnthropicResponse(
    res: ChatCompletionResponse,
    originalModel: string,
    options: { allowThinking?: boolean } = {}
): AnthropicMessageResponse {
    const choice = res.choices?.[0];
    const contentBlocks: AnthropicContentBlock[] = [];

    if (choice?.message) {
        const msg = choice.message;
        const reasoning = (msg as { reasoning_content?: string }).reasoning_content;

        // Reasoning/thinking content if present and allowed
        if (reasoning && options.allowThinking) {
            contentBlocks.push({
                type: "thinking",
                thinking: reasoning
            });
        }

        // Text content
        if (typeof msg.content === "string") {
            contentBlocks.push({
                type: "text",
                text: msg.content
            });
        } else if (Array.isArray(msg.content)) {
            const text = msg.content.map((p) => (p.type === "text" ? p.text : "")).join("\n");
            if (text) {
                contentBlocks.push({
                    type: "text",
                    text
                });
            }
        }

        // Tool calls
        if (Array.isArray(msg.tool_calls)) {
            for (const tc of msg.tool_calls) {
                let parsedInput: Record<string, unknown> = {};
                try {
                    parsedInput = JSON.parse(tc.function.arguments || "{}") as Record<
                        string,
                        unknown
                    >;
                } catch {
                    parsedInput = { raw: tc.function.arguments };
                }
                contentBlocks.push({
                    type: "tool_use",
                    id: tc.id,
                    name: tc.function.name,
                    input: parsedInput
                });
            }
        }
    }

    return {
        id: res.id ? `msg_${res.id.replace(/^chatcmpl-/, "")}` : `msg_${randomUUID()}`,
        type: "message",
        role: "assistant",
        content: contentBlocks,
        model: originalModel,
        stop_reason: mapFinishReason(choice?.finish_reason),
        stop_sequence: null,
        usage: {
            input_tokens: res.usage?.prompt_tokens ?? 0,
            output_tokens: res.usage?.completion_tokens ?? 0
        }
    };
}

/**
 * Converts OpenAI streaming chunks to Anthropic SSE event stream.
 */
export async function* OpenAIToAnthropicStream(
    stream: AsyncGenerator<ChatCompletionChunk>,
    originalModel: string,
    options: { allowThinking?: boolean } = {}
): AsyncGenerator<AnthropicStreamEvent> {
    const messageId = `msg_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
    let hasStarted = false;
    let currentBlockIndex = -1;
    let currentBlockType: "text" | "thinking" | "tool_use" | null = null;
    let finishReason: FinishReason | null = null;
    let outputTokensCount = 0;

    // Track active tool calls by index from OpenAI chunks
    const toolMap = new Map<number, { anthropicIndex: number; id: string; name: string }>();

    for await (const chunk of stream) {
        if (!hasStarted) {
            hasStarted = true;
            yield {
                type: "message_start",
                message: {
                    id: messageId,
                    type: "message",
                    role: "assistant",
                    model: originalModel,
                    content: [],
                    stop_reason: null,
                    stop_sequence: null,
                    usage: {
                        input_tokens: chunk.usage?.prompt_tokens ?? 0,
                        output_tokens: 1
                    }
                }
            };
        }

        const choice = chunk.choices?.[0];
        if (!choice) continue;

        if (choice.finish_reason) {
            finishReason = choice.finish_reason;
        }

        const delta = choice.delta;
        if (!delta) continue;

        const reasoning = (delta as { reasoning_content?: string }).reasoning_content;

        // 1. Handle reasoning / thinking delta only if allowed
        if (reasoning && options.allowThinking) {
            if (currentBlockType !== "thinking") {
                if (currentBlockType !== null) {
                    yield { type: "content_block_stop", index: currentBlockIndex };
                }
                currentBlockIndex++;
                currentBlockType = "thinking";
                yield {
                    type: "content_block_start",
                    index: currentBlockIndex,
                    content_block: { type: "thinking", thinking: "" }
                };
            }
            outputTokensCount++;
            yield {
                type: "content_block_delta",
                index: currentBlockIndex,
                delta: {
                    type: "thinking_delta",
                    thinking: reasoning
                }
            };
        }

        // 2. Handle text content delta
        if (delta.content) {
            if (currentBlockType !== "text") {
                if (currentBlockType !== null) {
                    yield { type: "content_block_stop", index: currentBlockIndex };
                }
                currentBlockIndex++;
                currentBlockType = "text";
                yield {
                    type: "content_block_start",
                    index: currentBlockIndex,
                    content_block: { type: "text", text: "" }
                };
            }
            outputTokensCount++;
            yield {
                type: "content_block_delta",
                index: currentBlockIndex,
                delta: {
                    type: "text_delta",
                    text: delta.content
                }
            };
        }

        // 3. Handle tool calls delta
        if (Array.isArray(delta.tool_calls)) {
            for (const tc of delta.tool_calls) {
                const chunkIndex = tc.index ?? 0;
                let existingTool = toolMap.get(chunkIndex);

                if (!existingTool && (tc.id || tc.function?.name)) {
                    if (currentBlockType !== null) {
                        yield { type: "content_block_stop", index: currentBlockIndex };
                    }
                    currentBlockIndex++;
                    currentBlockType = "tool_use";
                    existingTool = {
                        anthropicIndex: currentBlockIndex,
                        id: tc.id || `toolu_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
                        name: tc.function?.name || ""
                    };
                    toolMap.set(chunkIndex, existingTool);

                    yield {
                        type: "content_block_start",
                        index: currentBlockIndex,
                        content_block: {
                            type: "tool_use",
                            id: existingTool.id,
                            name: existingTool.name,
                            input: {}
                        }
                    };
                }

                if (existingTool && tc.function?.arguments) {
                    outputTokensCount++;
                    yield {
                        type: "content_block_delta",
                        index: existingTool.anthropicIndex,
                        delta: {
                            type: "input_json_delta",
                            partial_json: tc.function.arguments
                        }
                    };
                }
            }
        }
    }

    // Close any open content block
    if (currentBlockType !== null) {
        yield {
            type: "content_block_stop",
            index: currentBlockIndex
        };
    }

    // Message delta (stop reason)
    yield {
        type: "message_delta",
        delta: {
            stop_reason: mapFinishReason(finishReason),
            stop_sequence: null
        },
        usage: {
            output_tokens: Math.max(outputTokensCount, 1)
        }
    };

    // Message stop
    yield {
        type: "message_stop"
    };
}

export const anthropicToOpenAIRequest = AnthropicToOpenAIRequest;
export const openAIToAnthropicResponse = OpenAIToAnthropicResponse;
export const openAIToAnthropicStream = OpenAIToAnthropicStream;

