import type {
    ChatCompletionChunk,
    ChatCompletionRequest,
    ChatCompletionResponse,
    ChatMessage,
    FinishReason,
    ToolCall,
} from "@srouter/types";

// --- OpenAI Responses API translation helpers (port of 9router openai-responses) ---

// Responses API allowlist — anything else is stripped to avoid upstream "routing_unsupported"
const RESPONSES_BODY_ALLOWLIST = new Set([
    "model",
    "input",
    "instructions",
    "tools",
    "tool_choice",
    "stream",
    "store",
    "reasoning",
    "service_tier",
    "include",
    "prompt_cache_key",
    "client_metadata",
    "text",
]);

// Hosted tool types that Codex/OpenAI Responses executes server-side
const HOSTED_TOOL_TYPES = new Set([
    "image_generation",
    "web_search",
    "web_search_preview",
    "file_search",
    "computer",
    "computer_use_preview",
    "code_interpreter",
    "mcp",
    "local_shell",
    "tool_search",
]);

const SERVER_ID_PATTERN = /^(rs|fc|resp|msg)_/;

export interface ResponsesInputItem {
    type?: string;
    role?: string;
    content?: Array<{ type: string; text?: string; image_url?: string | { url: string }; detail?: string }>;
    id?: string;
    name?: string;
    call_id?: string;
    arguments?: string;
    output?: unknown;
}

export interface ResponsesRequestBody {
    model: string;
    input?: string | ResponsesInputItem[];
    instructions?: string;
    tools?: unknown[];
    tool_choice?: unknown;
    stream?: boolean;
    store?: boolean;
    reasoning?: { effort?: string; summary?: string };
    include?: string[];
    prompt_cache_key?: string;
    [key: string]: unknown;
}

export interface ResponsesStreamState {
    started: boolean;
    chatId: string;
    created: number;
    toolCallIndex: number;
    currentToolCallId: string | null;
    usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number; prompt_tokens_details?: { cached_tokens?: number } };
    finishReasonSent: boolean;
    model: string;
}

function buildChunk(model: string, delta: Record<string, unknown>, finishReason: FinishReason = null): ChatCompletionChunk {
    return {
        id: `chatcmpl-${Date.now()}`,
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [
            {
                index: 0,
                delta: delta as ChatCompletionChunk["choices"][0]["delta"],
                finish_reason: finishReason,
            },
        ],
    };
}

function fallbackToolCallId(): string {
    return `call_${Math.random().toString(36).slice(2, 12)}`;
}

function computeFinishReason(state: ResponsesStreamState): FinishReason {
    if (state.toolCallIndex > 0) return "tool_calls";
    return "stop";
}

function buildUsage(promptTokens: number, completionTokens: number, totalTokens: number, cachedTokens?: number) {
    return {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: totalTokens,
        ...(cachedTokens ? { prompt_tokens_details: { cached_tokens: cachedTokens } } : {}),
    };
}

function flattenText(content: unknown): string {
    if (content == null) return "";
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
        const parts: string[] = [];
        for (const p of content) {
            if (typeof p === "string") parts.push(p);
            else if (p && typeof p === "object" && typeof (p as { text?: unknown }).text === "string") parts.push((p as { text: string }).text);
        }
        return parts.join("\n");
    }
    return String(content);
}

/**
 * Convert a ChatCompletionRequest into a Responses API body suitable for Codex.
 * Handles: messages → input items, system → developer role, tool flattening,
 * reasoning effort mapping, unsupported param stripping.
 */
export function chatToResponsesBody(req: ChatCompletionRequest): ResponsesRequestBody {
    const input: ResponsesInputItem[] = [];
    const tools: unknown[] = [];

    // Convert messages to Responses input items
    for (const msg of req.messages) {
        if (!msg || typeof msg !== "object") continue;
        const role = msg.role;

        if (role === "system") {
            input.push({
                type: "message",
                role: "developer",
                content: [{ type: "input_text", text: flattenText(msg.content) }],
            });
            continue;
        }

        if (role === "user") {
            const parts = Array.isArray(msg.content)
                ? msg.content.map((c) => {
                    if (c.type === "image_url" && c.image_url) {
                        const url = typeof c.image_url === "string" ? c.image_url : c.image_url.url;
                        return { type: "input_image", image_url: url, detail: c.image_url?.detail ?? "auto" };
                    }
                    if (c.type === "text") return { type: "input_text", text: c.text ?? "" };
                    return { type: "input_text", text: flattenText(c) };
                })
                : [{ type: "input_text", text: flattenText(msg.content) }];
            input.push({ type: "message", role: "user", content: parts });
            continue;
        }

        if (role === "assistant") {
            // Assistant message with tool_calls
            if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
                for (const tc of msg.tool_calls) {
                    input.push({
                        type: "function_call",
                        call_id: tc.id,
                        name: tc.function.name,
                        arguments: tc.function.arguments || "",
                    });
                }
                continue;
            }
            const text = flattenText(msg.content);
            if (text) {
                input.push({
                    type: "message",
                    role: "assistant",
                    content: [{ type: "output_text", text }],
                });
            }
            continue;
        }

        if (role === "tool") {
            input.push({
                type: "function_call_output",
                call_id: msg.tool_call_id || "",
                output: flattenText(msg.content),
            });
            continue;
        }
    }

    // Empty input fallback (Codex rejects empty input)
    if (input.length === 0) {
        input.push({
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "..." }],
        });
    }

    // Convert tools to Responses flat format
    if (Array.isArray(req.tools)) {
        const validNames = new Set<string>();
        for (const tool of req.tools) {
            if (!tool || typeof tool !== "object") continue;
            const type = (tool as { type?: string }).type ?? "";
            if (type === "function") {
                const fn = (tool as { function?: { name?: string; description?: string; parameters?: unknown } }).function ?? {};
                const name = (fn.name || "").trim();
                if (!name) continue;
                validNames.add(name);
                tools.push({
                    type: "function",
                    name: name.slice(0, 128),
                    description: fn.description || "",
                    parameters: fn.parameters || { type: "object", properties: {} },
                });
            } else if (type === "namespace") {
                tools.push(tool); // passthrough namespace (contains nested tools)
            } else if (!type || type === "custom") {
                tools.push(tool); // passthrough custom
            } else if (HOSTED_TOOL_TYPES.has(type)) {
                tools.push(tool); // hosted tool passthrough
            }
        }
        if (tools.length === 0) delete (tools as unknown as { length?: number })?.length;
    }

    const body: ResponsesRequestBody = {
        model: req.model,
        input,
        stream: true,
        store: false,
    };

    // Extract instructions from system message (we converted to developer above, but
    // keep explicit instructions if the request carries top-level text)
    if (req.messages.some((m) => m.role === "system")) {
        const sys = req.messages.find((m) => m.role === "system");
        if (sys) body.instructions = flattenText(sys.content);
    }

    if (tools.length > 0) body.tools = tools;

    // Reasoning effort mapping (ChatCompletion has no native reasoning field, but
    // some clients send it via extension or temperature=0 reasoning style)
    const reasoningEffort = (req as unknown as { reasoning_effort?: string }).reasoning_effort;
    if (reasoningEffort) {
        body.reasoning = { effort: normalizeReasoningEffort(req.model, reasoningEffort), summary: "auto" };
    } else if ((req as unknown as { reasoning?: { effort?: string } }).reasoning) {
        body.reasoning = { effort: normalizeReasoningEffort(req.model, (req as unknown as { reasoning: { effort?: string } }).reasoning.effort), summary: "auto" };
    }

    return body;
}

function normalizeReasoningEffort(model: string, value?: string): string {
    const supported = ["none", "minimal", "low", "medium", "high", "xhigh"];
    if (value && supported.includes(value)) return value;
    // Codex default is low/medium — map unknown to low (matches 9router default)
    return "low";
}

/**
 * Convert a single Responses API SSE event into an OpenAI ChatCompletionChunk.
 * Returns null for events that produce no output.
 */
export function responsesEventToChunk(
    eventType: string,
    data: Record<string, unknown>,
    state: ResponsesStreamState,
): ChatCompletionChunk | null {
    if (!state.started) {
        state.started = true;
        state.chatId = `chatcmpl-${Date.now()}`;
        state.created = Math.floor(Date.now() / 1000);
        state.toolCallIndex = 0;
        state.currentToolCallId = null;
    }

    // Text content delta
    if (eventType === "response.output_text.delta") {
        const delta = (data.delta as string) || "";
        if (!delta) return null;
        return buildChunk(state.model, { content: delta });
    }

    // Function call started
    if (eventType === "response.output_item.added") {
        const item = data.item as { type?: string; call_id?: string; name?: string } | undefined;
        if (item && (item.type === "function_call" || item.type === "custom_tool_call")) {
            state.currentToolCallId = item.call_id || fallbackToolCallId();
            return buildChunk(state.model, {
                tool_calls: [
                    {
                        index: state.toolCallIndex,
                        id: state.currentToolCallId,
                        type: "function",
                        function: { name: item.name || "", arguments: "" },
                    },
                ],
            });
        }
        return null;
    }

    // Function call arguments delta
    if (eventType === "response.function_call_arguments.delta" || eventType === "response.custom_tool_call_input.delta") {
        const argsDelta = (data.delta as string) || "";
        if (!argsDelta) return null;
        return buildChunk(state.model, {
            tool_calls: [{ index: state.toolCallIndex, function: { arguments: argsDelta } }],
        });
    }

    // Function call done
    if (eventType === "response.output_item.done") {
        const item = data.item as { type?: string } | undefined;
        if (item && (item.type === "function_call" || item.type === "custom_tool_call")) {
            state.toolCallIndex++;
        }
        return null;
    }

    // Response completed — emit usage + finish
    if (eventType === "response.completed" || eventType === "response.done") {
        const responseUsage = data.response as {
            usage?: {
                input_tokens?: number;
                prompt_tokens?: number;
                output_tokens?: number;
                completion_tokens?: number;
                input_tokens_details?: { cached_tokens?: number };
                cache_read_input_tokens?: number;
            };
        } | undefined;
        if (responseUsage?.usage && typeof responseUsage.usage === "object") {
            const u = responseUsage.usage;
            const inputTokens = u.input_tokens || u.prompt_tokens || 0;
            const outputTokens = u.output_tokens || u.completion_tokens || 0;
            const cachedTokens = u.input_tokens_details?.cached_tokens || u.cache_read_input_tokens || 0;
            state.usage = buildUsage(inputTokens, outputTokens, inputTokens + outputTokens, cachedTokens);
        }

        if (!state.finishReasonSent) {
            state.finishReasonSent = true;
            const finishReason = computeFinishReason(state);
            const chunk = buildChunk(state.model, {}, finishReason);
            if (state.usage) chunk.usage = state.usage;
            return chunk;
        }
        return null;
    }

    return null;
}

export function createResponsesStreamState(model: string): ResponsesStreamState {
    return {
        started: false,
        chatId: "",
        created: 0,
        toolCallIndex: 0,
        currentToolCallId: null,
        finishReasonSent: false,
        model,
    };
}

// Accumulate streamed OpenAI chunks into a single non-streaming ChatCompletionResponse.
export function accumulateResponsesChunks(chunks: ChatCompletionChunk[], model: string): ChatCompletionResponse {
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
            function: { name: entry.name, arguments: entry.args },
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
                    ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
                },
                finish_reason: finishReason,
            },
        ],
        ...(usage ? { usage } : {}),
    };
}

// --- Input normalization helpers (port of 9router responsesApi.js) ---

/**
 * Normalize Responses API input to array format.
 * Accepts string or array; returns array of message items.
 * Empty array → placeholder (providers reject empty input).
 */
export function normalizeResponsesInput(input: string | ResponsesInputItem[] | undefined): ResponsesInputItem[] | null {
    if (typeof input === "string") {
        const text = input.trim() === "" ? "..." : input;
        return [{ type: "message", role: "user", content: [{ type: "input_text", text }] }];
    }
    if (Array.isArray(input)) {
        if (input.length === 0) {
            return [{ type: "message", role: "user", content: [{ type: "input_text", text: "..." }] }];
        }
        return input;
    }
    return null;
}

/**
 * Convert Responses API format back to chat completion format (for non-streaming fallback).
 */
export function convertResponsesApiFormat(body: ResponsesRequestBody): Record<string, unknown> {
    if (!body.input) return body as unknown as Record<string, unknown>;

    const result: Record<string, unknown> = { ...body, messages: [] as ChatMessage[] };
    const messages: ChatMessage[] = [];

    if (body.instructions) {
        messages.push({ role: "system", content: body.instructions });
    }

    let currentAssistantMsg: ChatMessage | null = null;
    let pendingToolResults: ChatMessage[] = [];

    const inputItems = normalizeResponsesInput(body.input);
    if (!inputItems) return body as unknown as Record<string, unknown>;

    for (const item of inputItems) {
        const itemType = item.type || (item.role ? "message" : null);

        if (itemType === "message") {
            if (currentAssistantMsg) {
                messages.push(currentAssistantMsg);
                currentAssistantMsg = null;
            }
            for (const tr of pendingToolResults) messages.push(tr);
            pendingToolResults = [];

            const content = Array.isArray(item.content)
                ? item.content.map((c) => {
                    if (c.type === "input_text" || c.type === "output_text") return { type: "text", text: c.text ?? "" };
                    if (c.type === "input_image") {
                        const url = typeof c.image_url === "string" ? c.image_url : c.image_url?.url || "";
                        return { type: "image_url", image_url: { url, detail: c.detail || "auto" } };
                    }
                    return c;
                })
                : item.content;
            messages.push({ role: (item.role as ChatMessage["role"]) || "user", content: content as ChatMessage["content"] });
        } else if (itemType === "function_call") {
            if (!currentAssistantMsg) {
                currentAssistantMsg = { role: "assistant", content: null, tool_calls: [] };
            }
            if (!item.name || typeof item.name !== "string" || item.name.trim() === "") continue;
            currentAssistantMsg.tool_calls?.push({
                id: item.call_id || "",
                type: "function",
                function: {
                    name: item.name,
                    arguments: typeof item.arguments === "string" ? item.arguments : JSON.stringify(item.arguments ?? ""),
                },
            });
        } else if (itemType === "function_call_output") {
            if (currentAssistantMsg) {
                messages.push(currentAssistantMsg);
                currentAssistantMsg = null;
            }
            pendingToolResults.push({
                role: "tool",
                tool_call_id: item.call_id || "",
                content: typeof item.output === "string" ? item.output : JSON.stringify(item.output ?? ""),
            });
        }
        // reasoning items skipped
    }

    if (currentAssistantMsg) messages.push(currentAssistantMsg);
    for (const tr of pendingToolResults) messages.push(tr);

    result.messages = messages;
    delete result.input;
    delete result.instructions;
    delete result.include;
    delete result.prompt_cache_key;
    delete result.store;
    delete result.reasoning;

    return result;
}
