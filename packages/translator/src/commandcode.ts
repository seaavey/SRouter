import { randomUUID } from "node:crypto";
import type {
    ChatCompletionChunk,
    ChatCompletionChunkDelta,
    ChatCompletionRequest,
    ChatCompletionResponse,
    ChatMessage,
    FinishReason,
    ToolCall,
    ToolFunctionParameters,
    UsageInfo
} from "@srouter/types";

const DEFAULT_MAX_TOKENS = 4096;

export interface CommandCodeToolCallOutput {
    type: "text";
    value: string;
}

export interface CommandCodeContentBlock {
    type: string;
    text?: string;
    toolCallId?: string;
    toolName?: string;
    input?: Record<string, JSONValue> | JSONValue;
    output?: CommandCodeToolCallOutput;
}

export type JSONValue = string | number | boolean | null | { [x: string]: JSONValue } | Array<JSONValue>;

function flattenText(content: ChatMessage["content"]): string {
    if (content == null) return "";
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
        return content
            .map((p) => (typeof p === "string" ? p : p && typeof p === "object" && "text" in p && typeof p.text === "string" ? p.text : ""))
            .filter(Boolean)
            .join("\n");
    }
    return String(content);
}

function toContentBlocks(content: ChatMessage["content"]): Array<{ type: string; text: string }> {
    if (content == null) return [{ type: "text", text: "" }];
    if (typeof content === "string") return [{ type: "text", text: content }];
    if (Array.isArray(content)) {
        const blocks: Array<{ type: string; text: string }> = [];
        for (const part of content) {
            if (typeof part === "string") {
                blocks.push({ type: "text", text: part });
            } else if (part && typeof part === "object") {
                const p = part as { type?: string; text?: string };
                if (p.type === "image_url" || p.type === "image") {
                    blocks.push({ type: "text", text: "[image omitted]" });
                } else if (typeof p.text === "string") {
                    blocks.push({ type: "text", text: p.text });
                }
            }
        }
        return blocks.length ? blocks : [{ type: "text", text: "" }];
    }
    return [{ type: "text", text: String(content) }];
}

function parseJsonArguments(args?: string): Record<string, JSONValue> | JSONValue {
    if (!args) return {};
    try {
        return JSON.parse(args) as Record<string, JSONValue>;
    } catch {
        return {};
    }
}

export interface CommandCodeMessage {
    role: "user" | "assistant" | "tool";
    content: CommandCodeContentBlock[];
}

export interface CommandCodeToolDefinition {
    name: string;
    description?: string;
    input_schema: ToolFunctionParameters | { type: "object" };
}

export interface CommandCodeRequestBody {
    threadId: string;
    memory: string;
    config: {
        workingDir: string;
        date: string;
        environment: string;
        structure: string[];
        isGitRepo: boolean;
        currentBranch: string;
        mainBranch: string;
        gitStatus: string;
        recentCommits: string[];
    };
    params: {
        model: string;
        messages: CommandCodeMessage[];
        stream: boolean;
        max_tokens: number;
        temperature: number;
        system?: string;
        tools?: CommandCodeToolDefinition[];
        top_p?: number;
    };
}

function mapAssistantMessage(m: ChatMessage): CommandCodeMessage {
    const blocks: CommandCodeMessage["content"] = [];
    const text = flattenText(m.content);
    if (text) blocks.push({ type: "text", text });

    if (Array.isArray(m.tool_calls)) {
        for (const tc of m.tool_calls) {
            blocks.push({
                type: "tool-call",
                toolCallId: tc.id || "",
                toolName: tc.function?.name || "",
                input: parseJsonArguments(tc.function?.arguments)
            });
        }
    }

    return {
        role: "assistant",
        content: blocks.length ? blocks : [{ type: "text", text: "" }]
    };
}

function mapToolMessage(m: ChatMessage): CommandCodeMessage {
    const value = typeof m.content === "string" ? m.content : flattenText(m.content);
    return {
        role: "tool",
        content: [
            {
                type: "tool-result",
                toolCallId: m.tool_call_id || "",
                toolName: m.name || "",
                output: { type: "text", value }
            }
        ]
    };
}

function mapMessages(messages: ChatCompletionRequest["messages"]): {
    messages: CommandCodeMessage[];
    system: string;
} {
    const out: CommandCodeMessage[] = [];
    const systemTexts: string[] = [];

    for (const m of messages) {
        if (!m) continue;

        if (m.role === "system") {
            const t = flattenText(m.content);
            if (t) systemTexts.push(t);
            continue;
        }

        if (m.role === "tool") {
            out.push(mapToolMessage(m));
            continue;
        }

        if (m.role === "assistant") {
            out.push(mapAssistantMessage(m));
            continue;
        }

        out.push({ role: "user", content: toContentBlocks(m.content) });
    }

    return { messages: out, system: systemTexts.join("\n\n") };
}

function mapTools(
    tools: ChatCompletionRequest["tools"]
): CommandCodeToolDefinition[] | undefined {
    if (!Array.isArray(tools) || tools.length === 0) return undefined;
    const result: CommandCodeToolDefinition[] = [];
    for (const t of tools) {
        if (!t || t.type !== "function" || !t.function) continue;
        result.push({
            name: t.function.name,
            description: t.function.description,
            input_schema: t.function.parameters || { type: "object" }
        });
    }
    return result.length ? result : undefined;
}

export function buildRequestBody(req: ChatCompletionRequest): CommandCodeRequestBody {
    const { messages, system } = mapMessages(req.messages);
    const model = req.model.includes("/") ? req.model.slice(req.model.indexOf("/") + 1) : req.model;
    const params: CommandCodeRequestBody["params"] = {
        model,
        messages,
        stream: true,
        max_tokens: req.max_tokens ?? DEFAULT_MAX_TOKENS,
        temperature: req.temperature ?? 0.3
    };

    if (system) params.system = system;

    const tools = mapTools(req.tools);
    if (tools) params.tools = tools;
    if (req.top_p != null) params.top_p = req.top_p;

    return {
        threadId: randomUUID(),
        memory: "",
        config: {
            workingDir: process.cwd(),
            date: new Date().toISOString().slice(0, 10),
            environment: process.platform,
            structure: [],
            isGitRepo: false,
            currentBranch: "",
            mainBranch: "",
            gitStatus: "",
            recentCommits: []
        },
        params
    };
}

export interface CommandCodeUsage {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
}

export interface CommandCodeStreamState {
    responseId: string;
    created: number;
    model: string;
    chunkIndex: number;
    toolIndex: number;
    toolIndexById: Map<string, number>;
    openTools: Set<string>;
    finishReason: FinishReason | null;
    usage: CommandCodeUsage | null;
}

export function createCommandCodeStreamState(): CommandCodeStreamState {
    return {
        responseId: "",
        created: 0,
        model: "",
        chunkIndex: 0,
        toolIndex: 0,
        toolIndexById: new Map(),
        openTools: new Set(),
        finishReason: null,
        usage: null
    };
}

function ensureState(state: CommandCodeStreamState, model: string): void {
    if (!state.responseId) {
        state.responseId = `chatcmpl-${Date.now()}`;
        state.created = Math.floor(Date.now() / 1000);
        state.model = model || "commandcode";
        state.chunkIndex = 0;
        state.toolIndex = 0;
        state.toolIndexById = new Map();
        state.openTools = new Set();
        state.finishReason = null;
        state.usage = null;
    }
}

function makeChunk(
    state: CommandCodeStreamState,
    delta: ChatCompletionChunkDelta,
    finishReason: FinishReason = null
): ChatCompletionChunk {
    return {
        id: state.responseId,
        object: "chat.completion.chunk",
        created: state.created,
        model: state.model,
        choices: [{ index: 0, delta, finish_reason: finishReason }]
    };
}

function mapFinishReason(reason?: string | null): FinishReason {
    switch (reason) {
        case "stop":
            return "stop";
        case "length":
            return "length";
        case "tool-calls":
        case "tool_use":
            return "tool_calls";
        case "content-filter":
            return "content_filter";
        case "error":
            return "stop";
        default:
            return (reason as FinishReason) || "stop";
    }
}

function fallbackToolCallId(index: number): string {
    return `call_${index}_${Date.now()}`;
}

export interface CommandCodeEvent {
    type?: string;
    text?: string;
    delta?: string;
    inputTextDelta?: string;
    id?: string;
    toolCallId?: string;
    toolName?: string;
    input?: Record<string, JSONValue> | string;
    finishReason?: string;
    usage?: CommandCodeUsage;
    totalUsage?: CommandCodeUsage;
    model?: string;
    error?: string | Record<string, JSONValue>;
    message?: string | Record<string, JSONValue>;
}

export function commandCodeEventToOpenAIChunk(
    event: CommandCodeEvent,
    state: CommandCodeStreamState
): ChatCompletionChunk[] {
    if (!event || typeof event !== "object" || !event.type) return [];

    ensureState(state, event.model ?? "");
    const out: ChatCompletionChunk[] = [];

    switch (event.type) {
        case "text-delta": {
            const text = event.text || event.delta || "";
            if (!text) break;
            const delta: ChatCompletionChunkDelta =
                state.chunkIndex === 0 ? { role: "assistant", content: text } : { content: text };
            state.chunkIndex++;
            out.push(makeChunk(state, delta));
            break;
        }
        case "reasoning-delta": {
            const text = event.text || "";
            if (!text) break;
            const delta: ChatCompletionChunkDelta =
                state.chunkIndex === 0
                    ? { role: "assistant", reasoning_content: text }
                    : { reasoning_content: text };
            state.chunkIndex++;
            out.push(makeChunk(state, delta));
            break;
        }
        case "tool-input-start": {
            const id = event.id || event.toolCallId || fallbackToolCallId(state.toolIndex);
            let idx = state.toolIndexById.get(id);
            if (idx == null) {
                idx = state.toolIndex++;
                state.toolIndexById.set(id, idx);
            }
            state.openTools.add(id);
            const delta: ChatCompletionChunkDelta = {
                ...(state.chunkIndex === 0 ? { role: "assistant" as const } : {}),
                tool_calls: [
                    {
                        index: idx,
                        id,
                        type: "function",
                        function: { name: event.toolName || "", arguments: "" }
                    }
                ]
            };
            state.chunkIndex++;
            out.push(makeChunk(state, delta));
            break;
        }
        case "tool-input-delta": {
            const id = event.id || event.toolCallId;
            if (!id) break;
            const idx = state.toolIndexById.get(id);
            if (idx == null) break;
            const delta: ChatCompletionChunkDelta = {
                tool_calls: [
                    {
                        index: idx,
                        function: { arguments: event.delta || event.inputTextDelta || "" }
                    }
                ]
            };
            out.push(makeChunk(state, delta));
            break;
        }
        case "tool-call": {
            const id = event.toolCallId;
            if (!id || state.toolIndexById.has(id)) break;
            const idx = state.toolIndex++;
            state.toolIndexById.set(id, idx);
            const argsStr =
                typeof event.input === "string" ? event.input : JSON.stringify(event.input ?? {});
            const delta: ChatCompletionChunkDelta = {
                ...(state.chunkIndex === 0 ? { role: "assistant" as const } : {}),
                tool_calls: [
                    {
                        index: idx,
                        id,
                        type: "function",
                        function: { name: event.toolName || "", arguments: argsStr }
                    }
                ]
            };
            state.chunkIndex++;
            out.push(makeChunk(state, delta));
            break;
        }
        case "finish-step": {
            state.finishReason = mapFinishReason(event.finishReason);
            if (event.usage) state.usage = event.usage;
            break;
        }
        case "finish": {
            const finishReason =
                state.finishReason || mapFinishReason(event.finishReason || "stop");
            const finalChunk = makeChunk(state, {}, finishReason);
            const totalUsage = event.totalUsage || state.usage;
            const usage = mapOpenAIUsage(totalUsage);
            if (usage) finalChunk.usage = usage;
            out.push(finalChunk);
            break;
        }
        case "error": {
            const errVal = event.error ?? event.message ?? "unknown";
            const errStr = typeof errVal === "string" ? errVal : JSON.stringify(errVal);
            out.push(makeChunk(state, { content: `\n\n[CommandCode error: ${errStr}]` }));
            out.push(makeChunk(state, {}, "stop"));
            break;
        }
        default:
            break;
    }

    return out;
}

function mapOpenAIUsage(raw?: CommandCodeUsage | null): UsageInfo | null {
    if (!raw) return null;
    const prompt_tokens = raw.inputTokens ?? 0;
    const completion_tokens = raw.outputTokens ?? 0;
    const total_tokens = raw.totalTokens ?? (prompt_tokens + completion_tokens);
    return { prompt_tokens, completion_tokens, total_tokens };
}

export function accumulateChunks(
    chunks: ChatCompletionChunk[],
    model: string
): ChatCompletionResponse {
    let content = "";
    const toolCalls: ToolCall[] = [];
    const toolCallMap = new Map<number, { id: string; name: string; args: string }>();

    for (const chunk of chunks) {
        const delta = chunk.choices[0]?.delta;
        if (!delta) continue;
        if (typeof delta.content === "string") content += delta.content;
        if (Array.isArray(delta.tool_calls)) {
            for (const tc of delta.tool_calls) {
                const idx = tc.index ?? 0;
                const entry = toolCallMap.get(idx) || { id: "", name: "", args: "" };
                if (tc.id) entry.id = tc.id;
                if (tc.function?.name) entry.name = tc.function.name;
                if (tc.function?.arguments) entry.args += tc.function.arguments;
                toolCallMap.set(idx, entry);
            }
        }
    }

    for (const entry of toolCallMap.values()) {
        toolCalls.push({
            id: entry.id,
            type: "function",
            function: { name: entry.name, arguments: entry.args }
        });
    }

    const finishReason: FinishReason = chunks.at(-1)?.choices[0]?.finish_reason ?? "stop";
    const usage = [...chunks].reverse().find((c) => c.usage)?.usage;

    return {
        id: `chatcmpl-${Date.now()}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [
            {
                index: 0,
                message: {
                    role: "assistant",
                    content: content || null,
                    ...(toolCalls.length ? { tool_calls: toolCalls } : {})
                },
                finish_reason: finishReason
            }
        ],
        ...(usage ? { usage } : {})
    };
}
