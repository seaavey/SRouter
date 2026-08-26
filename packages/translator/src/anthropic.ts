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

function mapSystemPrompt(system: AnthropicMessageRequest["system"]): ChatMessage | null {
    if (!system) return null;
    if (typeof system === "string") {
        return { role: "system", content: system };
    }
    if (Array.isArray(system)) {
        const text = system
            .map((b) => (b.type === "text" ? b.text || "" : ""))
            .filter(Boolean)
            .join("\n\n");
        return text ? { role: "system", content: text } : null;
    }
    return null;
}

function extractAnthropicBlocks(blocks: AnthropicContentBlock[]): {
    parts: ChatMessageContentPart[];
    toolCalls: ToolCall[];
    toolResults: AnthropicContentBlock[];
} {
    const parts: ChatMessageContentPart[] = [];
    const toolCalls: ToolCall[] = [];
    const toolResults: AnthropicContentBlock[] = [];

    for (const block of blocks) {
        switch (block.type) {
            case "text":
                if (block.text) parts.push({ type: "text", text: block.text });
                break;
            case "image":
                if (block.source) {
                    parts.push({
                        type: "image_url",
                        image_url: {
                            url: `data:${block.source.media_type};base64,${block.source.data}`
                        }
                    });
                }
                break;
            case "tool_use":
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
                break;
            case "tool_result":
                toolResults.push(block);
                break;
        }
    }

    return { parts, toolCalls, toolResults };
}

function formatToolResultContent(content: AnthropicContentBlock["content"]): string {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
        return content
            .map((b) => (b.type === "text" ? b.text || "" : JSON.stringify(b)))
            .join("\n");
    }
    return "";
}

function mapAnthropicMessage(msg: AnthropicMessage): ChatMessage[] {
    if (typeof msg.content === "string") {
        return [{ role: msg.role, content: msg.content }];
    }
    if (!Array.isArray(msg.content)) return [];

    const { parts, toolCalls, toolResults } = extractAnthropicBlocks(msg.content);
    const messages: ChatMessage[] = [];

    if (msg.role === "assistant") {
        const textContent = parts
            .filter((p): p is { type: "text"; text: string } => p.type === "text")
            .map((p) => p.text)
            .join("\n");

        messages.push({
            role: "assistant",
            content: textContent || (toolCalls.length > 0 ? null : ""),
            tool_calls: toolCalls.length > 0 ? toolCalls : undefined
        });
        return messages;
    }

    for (const result of toolResults) {
        messages.push({
            role: "tool",
            tool_call_id: result.tool_use_id || "",
            content: formatToolResultContent(result.content)
        });
    }

    if (parts.length === 1 && parts[0]?.type === "text") {
        messages.push({ role: "user", content: parts[0].text || "" });
    } else if (parts.length > 0) {
        messages.push({ role: "user", content: parts });
    }

    return messages;
}

function mapAnthropicTools(
    tools?: AnthropicTool[] | ToolDefinition[]
): ToolDefinition[] | undefined {
    if (!Array.isArray(tools) || tools.length === 0) return undefined;

    return tools.map((t) => {
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

function mapAnthropicToolChoice(
    choice?: AnthropicMessageRequest["tool_choice"]
): ChatCompletionRequest["tool_choice"] {
    if (!choice) return undefined;
    if (choice.type === "auto") return "auto";
    if (choice.type === "any") return "required";
    if (choice.type === "tool" && choice.name) {
        return {
            type: "function",
            function: { name: choice.name }
        };
    }
    return undefined;
}

export function AnthropicToOpenAIRequest(req: AnthropicMessageRequest): ChatCompletionRequest {
    const messages: ChatMessage[] = [];

    const systemMessage = mapSystemPrompt(req.system);
    if (systemMessage) messages.push(systemMessage);

    for (const msg of req.messages || []) {
        messages.push(...mapAnthropicMessage(msg));
    }

    return {
        model: req.model,
        messages,
        max_tokens: req.max_tokens,
        temperature: req.temperature,
        top_p: req.top_p,
        stop: req.stop_sequences,
        tools: mapAnthropicTools(req.tools),
        tool_choice: mapAnthropicToolChoice(req.tool_choice),
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
    return "end_turn";
}

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

        if (reasoning && options.allowThinking) {
            contentBlocks.push({
                type: "thinking",
                thinking: reasoning
            });
        }

        if (typeof msg.content === "string") {
            contentBlocks.push({
                type: "text",
                text: msg.content
            });
        } else if (Array.isArray(msg.content)) {
            const text = msg.content
                .filter((p): p is { type: "text"; text: string } => p.type === "text")
                .map((p) => p.text)
                .join("\n");
            if (text) {
                contentBlocks.push({
                    type: "text",
                    text
                });
            }
        }

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

    if (currentBlockType !== null) {
        yield {
            type: "content_block_stop",
            index: currentBlockIndex
        };
    }

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

    yield {
        type: "message_stop"
    };
}
