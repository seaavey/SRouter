import type {
    ChatCompletionChunk,
    ChatCompletionRequest,
    ChatMessage,
    ChatRole,
    FinishReason,
    JSONObject,
    JSONValue,
    ToolDefinition,
    UsageInfo
} from "@srouter/types";

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
    "tool_search"
]);

export interface ResponsesContentPart {
    type: string;
    text?: string;
    image_url?: string | { url: string };
    detail?: string;
}

export interface ResponsesInputItem {
    type?: string;
    role?: string;
    content?: ResponsesContentPart[];
    id?: string;
    name?: string;
    call_id?: string;
    arguments?: string;
    output?: JSONValue;
}

export interface ResponsesToolDefinition {
    type: string;
    name?: string;
    description?: string;
    parameters?: JSONObject;
}

export interface ResponsesRequestBody {
    model: string;
    input?: string | ResponsesInputItem[];
    instructions?: string;
    tools?: Array<ResponsesToolDefinition | JSONObject>;
    tool_choice?: unknown;
    stream?: boolean;
    store?: boolean;
    reasoning?: { effort?: string; summary?: string };
    include?: string[];
    prompt_cache_key?: string;
    [key: string]: JSONValue | unknown;
}

export interface ResponsesStreamState {
    started: boolean;
    chatId: string;
    created: number;
    toolCallIndex: number;
    currentToolCallId: string | null;
    usage?: UsageInfo;
    finishReasonSent: boolean;
    model: string;
}

function buildChunk(
    model: string,
    delta: ChatCompletionChunk["choices"][0]["delta"],
    finishReason: FinishReason = null
): ChatCompletionChunk {
    return {
        id: `chatcmpl-${Date.now()}`,
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [
            {
                index: 0,
                delta,
                finish_reason: finishReason
            }
        ]
    };
}

function fallbackToolCallId(): string {
    return `call_${Math.random().toString(36).slice(2, 12)}`;
}

function computeFinishReason(state: ResponsesStreamState): FinishReason {
    return state.toolCallIndex > 0 ? "tool_calls" : "stop";
}

function buildUsage(
    prompt_tokens: number,
    completion_tokens: number,
    total_tokens: number,
    cachedTokens?: number
): UsageInfo {
    return {
        prompt_tokens,
        completion_tokens,
        total_tokens,
        ...(cachedTokens ? { prompt_tokens_details: { cached_tokens: cachedTokens } } : {})
    };
}

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

function mapMessageToInputItems(msg: ChatMessage): ResponsesInputItem[] {
    const role = msg.role;

    if (role === "system") {
        return [{
            type: "message",
            role: "developer",
            content: [{ type: "input_text", text: flattenText(msg.content) }]
        }];
    }

    if (role === "user") {
        const parts: ResponsesContentPart[] = Array.isArray(msg.content)
            ? msg.content.map((c) => {
                  if (c.type === "image_url" && c.image_url) {
                      const url = typeof c.image_url === "string" ? c.image_url : c.image_url.url;
                      return {
                          type: "input_image",
                          image_url: url,
                          detail: c.image_url?.detail ?? "auto"
                      };
                  }
                  if (c.type === "text") return { type: "input_text", text: c.text ?? "" };
                  return { type: "input_text", text: flattenText(c as unknown as ChatMessage["content"]) };
              })
            : [{ type: "input_text", text: flattenText(msg.content) }];
        return [{ type: "message", role: "user", content: parts }];
    }

    if (role === "assistant") {
        if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
            return msg.tool_calls.map((tc) => ({
                type: "function_call",
                call_id: tc.id,
                name: tc.function.name,
                arguments: tc.function.arguments || ""
            }));
        }
        const text = flattenText(msg.content);
        return text ? [{ type: "message", role: "assistant", content: [{ type: "output_text", text }] }] : [];
    }

    if (role === "tool") {
        return [{
            type: "function_call_output",
            call_id: msg.tool_call_id || "",
            output: flattenText(msg.content)
        }];
    }

    return [];
}

function mapResponsesTools(tools?: ToolDefinition[]): Array<ResponsesToolDefinition | JSONObject> | undefined {
    if (!Array.isArray(tools) || tools.length === 0) return undefined;
    const result: Array<ResponsesToolDefinition | JSONObject> = [];
    for (const tool of tools) {
        if (!tool || typeof tool !== "object") continue;
        const type = (tool as { type?: string }).type ?? "";
        if (type === "function") {
            const fn = tool.function || { name: "" };
            const name = (fn.name || "").trim();
            if (!name) continue;
            result.push({
                type: "function",
                name: name.slice(0, 128),
                description: fn.description || "",
                parameters: (fn.parameters as unknown as JSONObject) || { type: "object", properties: {} }
            });
        } else if (type === "namespace" || !type || type === "custom" || HOSTED_TOOL_TYPES.has(type)) {
            result.push(tool as unknown as JSONObject);
        }
    }
    return result.length > 0 ? result : undefined;
}

export function normalizeReasoningEffort(value?: string): string {
    const supported = ["none", "minimal", "low", "medium", "high", "xhigh"];
    if (value && supported.includes(value)) return value;
    return "low";
}

export function chatToResponsesBody(req: ChatCompletionRequest): ResponsesRequestBody {
    const input: ResponsesInputItem[] = [];
    for (const msg of req.messages) {
        if (msg) input.push(...mapMessageToInputItems(msg));
    }

    if (input.length === 0) {
        input.push({
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "..." }]
        });
    }

    const tools = mapResponsesTools(req.tools);
    const body: ResponsesRequestBody = {
        model: req.model,
        input,
        stream: true,
        store: false
    };

    const sysMsg = req.messages.find((m) => m.role === "system");
    if (sysMsg) body.instructions = flattenText(sysMsg.content);

    if (tools) body.tools = tools;

    const reasoningEffort = req.reasoning_effort || req.reasoning?.effort;
    if (reasoningEffort) {
        body.reasoning = {
            effort: normalizeReasoningEffort(reasoningEffort),
            summary: "auto"
        };
    }

    return body;
}

export function responsesEventToChunk(
    eventType: string,
    data: Record<string, unknown>,
    state: ResponsesStreamState
): ChatCompletionChunk | null {
    if (!state.started) {
        state.started = true;
        state.chatId = `chatcmpl-${Date.now()}`;
        state.created = Math.floor(Date.now() / 1000),
        state.toolCallIndex = 0;
        state.currentToolCallId = null;
    }

    if (eventType === "response.output_text.delta") {
        const delta = (data.delta as string) || "";
        return delta ? buildChunk(state.model, { content: delta }) : null;
    }

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
                        function: { name: item.name || "", arguments: "" }
                    }
                ]
            });
        }
        return null;
    }

    if (
        eventType === "response.function_call_arguments.delta" ||
        eventType === "response.custom_tool_call_input.delta"
    ) {
        const argsDelta = (data.delta as string) || "";
        return argsDelta
            ? buildChunk(state.model, {
                  tool_calls: [{ index: state.toolCallIndex, function: { arguments: argsDelta } }]
              })
            : null;
    }

    if (eventType === "response.output_item.done") {
        const item = data.item as { type?: string } | undefined;
        if (item && (item.type === "function_call" || item.type === "custom_tool_call")) {
            state.toolCallIndex++;
        }
        return null;
    }

    if (eventType === "response.completed" || eventType === "response.done") {
        const responseUsage = data.response as
            | {
                  usage?: {
                      input_tokens?: number;
                      prompt_tokens?: number;
                      output_tokens?: number;
                      completion_tokens?: number;
                      input_tokens_details?: { cached_tokens?: number };
                      cache_read_input_tokens?: number;
                  };
              }
            | undefined;
        if (responseUsage?.usage) {
            const u = responseUsage.usage;
            const prompt_tokens = u.input_tokens || u.prompt_tokens || 0;
            const completion_tokens = u.output_tokens || u.completion_tokens || 0;
            const cachedTokens =
                u.input_tokens_details?.cached_tokens || u.cache_read_input_tokens || 0;
            state.usage = buildUsage(
                prompt_tokens,
                completion_tokens,
                prompt_tokens + completion_tokens,
                cachedTokens
            );
        }

        if (!state.finishReasonSent) {
            state.finishReasonSent = true;
            const chunk = buildChunk(state.model, {}, computeFinishReason(state));
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
        model
    };
}

export function normalizeResponsesInput(
    input: string | ResponsesInputItem[] | undefined
): ResponsesInputItem[] | null {
    if (typeof input === "string") {
        const text = input.trim() === "" ? "..." : input;
        return [{ type: "message", role: "user", content: [{ type: "input_text", text }] }];
    }
    if (Array.isArray(input)) {
        return input.length === 0
            ? [{ type: "message", role: "user", content: [{ type: "input_text", text: "..." }] }]
            : input;
    }
    return null;
}

export function convertResponsesApiFormat(body: ResponsesRequestBody): Record<string, unknown> {
    if (!body.input) return body as unknown as Record<string, unknown>;

    const messages: ChatMessage[] = [];
    if (body.instructions) {
        messages.push({ role: "system", content: body.instructions });
    }

    let currentAssistantMsg: ChatMessage | null = null;
    const pendingToolResults: ChatMessage[] = [];

    const inputItems = normalizeResponsesInput(body.input);
    if (!inputItems) return body as unknown as Record<string, unknown>;

    for (const item of inputItems) {
        const itemType = item.type || (item.role ? "message" : null);

        if (itemType === "message") {
            if (currentAssistantMsg) {
                messages.push(currentAssistantMsg);
                currentAssistantMsg = null;
            }
            messages.push(...pendingToolResults);
            pendingToolResults.length = 0;

            const content = Array.isArray(item.content)
                ? item.content.map((c) => {
                      if (c.type === "input_text" || c.type === "output_text")
                          return { type: "text", text: c.text ?? "" };
                      if (c.type === "input_image") {
                          const url =
                              typeof c.image_url === "string"
                                  ? c.image_url
                                  : c.image_url?.url || "";
                          return {
                              type: "image_url",
                              image_url: { url, detail: c.detail || "auto" }
                          };
                      }
                      return c;
                  })
                : item.content;
            messages.push({
                role: (item.role as ChatRole) || "user",
                content: content as ChatMessage["content"]
            });
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
                    arguments:
                        typeof item.arguments === "string"
                            ? item.arguments
                            : JSON.stringify(item.arguments ?? "")
                }
            });
        } else if (itemType === "function_call_output") {
            if (currentAssistantMsg) {
                messages.push(currentAssistantMsg);
                currentAssistantMsg = null;
            }
            pendingToolResults.push({
                role: "tool",
                tool_call_id: item.call_id || "",
                content:
                    typeof item.output === "string"
                        ? item.output
                        : JSON.stringify(item.output ?? "")
            });
        }
    }

    if (currentAssistantMsg) messages.push(currentAssistantMsg);
    messages.push(...pendingToolResults);

    const result: Record<string, unknown> = { ...body, messages };
    delete result.input;
    delete result.instructions;
    delete result.include;
    delete result.prompt_cache_key;
    delete result.store;
    delete result.reasoning;

    return result;
}
