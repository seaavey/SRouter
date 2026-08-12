import type {
    AIProvider,
    ChatCompletionChunk,
    ChatCompletionRequest,
    ChatCompletionResponse,
    ModelObject,
    ToolDefinition,
} from "@srouter/types";

const RUNTIME_URL = "https://runtime.us-east-1.kiro.dev/generateAssistantResponse";
const CODEWHISPERER_URL = "https://codewhisperer.us-east-1.amazonaws.com/generateAssistantResponse";
const Q_URL = "https://q.us-east-1.amazonaws.com/generateAssistantResponse";
const CODEWHISPERER_TARGET = "AmazonCodeWhispererStreamingService.GenerateAssistantResponse";
const MAX_FRAME_BYTES = 24 * 1024 * 1024;
const MAX_HEADER_BYTES = 128 * 1024;

const DEFAULT_MODELS = [
    "claude-sonnet-4.5",
    "claude-sonnet-4.5-thinking",
    "claude-opus-4.5",
    "claude-opus-4.5-thinking",
    "deepseek-r1",
    "qwen3-coder-30b",
    "gpt-5.6-sol",
    "gpt-5.6-terra",
    "gpt-5.6-luna",
    "simple-task",
];

export interface KiroProviderSpecificData {
    authMethod?: "api_key" | "builder-id" | "social" | "external_idp" | "idc" | string;
    region?: string;
    profileArn?: string;
}

export interface KiroExecutorOptions {
    id?: string;
    name?: string;
    baseUrl?: string;
    apiKey?: string;
    accessToken?: string;
    refreshToken?: string;
    authMethod?: string;
    region?: string;
    profileArn?: string;
    providerSpecificData?: KiroProviderSpecificData;
}

type KiroEvent = {
    headers: Record<string, unknown>;
    payload: unknown;
};

type KiroMessage = {
    userInputMessage?: {
        content: string;
        modelId?: string;
        origin?: string;
        images?: unknown[];
        userInputMessageContext?: Record<string, unknown>;
    };
    assistantResponseMessage?: { content: string; toolUses?: unknown[] };
};

type KiroRequest = {
    conversationState: {
        chatTriggerType: string;
        conversationId: string;
        agentContinuationId: string;
        agentTaskType: string;
        currentMessage: KiroMessage;
        history: KiroMessage[];
    };
    agentMode: string;
    inferenceConfig: Record<string, number>;
    profileArn?: string;
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function crc32(bytes: Uint8Array): number {
    let crc = 0xffffffff;
    for (const byte of bytes) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function bareModel(model: string): string {
    const value = model.startsWith("kiro/") ? model.slice("kiro/".length) : model;
    return value.replace(/-agentic$/, "");
}

function textOf(content: ChatCompletionRequest["messages"][number]["content"]): string {
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    return content.map((part) => part.type === "text" ? part.text ?? "" : "[Image omitted]").join("\n");
}

function asObject(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function normalizeStopReason(value: unknown): "end_turn" | "tool_use" | "max_tokens" | null {
    const reason = String(value ?? "").replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase();
    if (["end_turn", "stop", "stop_sequence"].includes(reason)) return "end_turn";
    if (["tool_use", "tool_calls"].includes(reason)) return "tool_use";
    if (["max_tokens", "length"].includes(reason)) return "max_tokens";
    return null;
}

function parseEventFrame(data: Uint8Array): KiroEvent {
    if (data.byteLength < 16) throw new Error("AWS EventStream frame is shorter than 16 bytes");
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const totalLength = view.getUint32(0, false);
    const headersLength = view.getUint32(4, false);
    if (totalLength !== data.byteLength || totalLength < 16 || totalLength > MAX_FRAME_BYTES || headersLength > MAX_HEADER_BYTES || headersLength > totalLength - 16) {
        throw new Error("AWS EventStream frame bounds are invalid");
    }
    if (view.getUint32(8, false) !== crc32(data.subarray(0, 8))) throw new Error("AWS EventStream prelude CRC mismatch");
    if (view.getUint32(totalLength - 4, false) !== crc32(data.subarray(0, totalLength - 4))) throw new Error("AWS EventStream message CRC mismatch");

    const headers: Record<string, unknown> = {};
    const names = new Set<string>();
    let offset = 12;
    const headerEnd = offset + headersLength;
    const need = (count: number): void => {
        if (offset + count > headerEnd) throw new Error("AWS EventStream header exceeds its declared bounds");
    };
    while (offset < headerEnd) {
        need(1);
        const nameLength = data[offset++];
        need(nameLength + 1);
        const name = decoder.decode(data.subarray(offset, offset + nameLength));
        offset += nameLength;
        if (names.has(name)) throw new Error(`AWS EventStream contains duplicate header: ${name}`);
        names.add(name);
        const type = data[offset++];
        if (type === 0 || type === 1) headers[name] = type === 0;
        else if (type === 2) { need(1); headers[name] = view.getInt8(offset); offset += 1; }
        else if (type === 3) { need(2); headers[name] = view.getInt16(offset, false); offset += 2; }
        else if (type === 4) { need(4); headers[name] = view.getInt32(offset, false); offset += 4; }
        else if (type === 5 || type === 8) { need(8); offset += 8; }
        else if (type === 6 || type === 7) {
            need(2);
            const length = view.getUint16(offset, false);
            offset += 2;
            need(length);
            const value = data.subarray(offset, offset + length);
            headers[name] = type === 7 ? decoder.decode(value) : value;
            offset += length;
        } else if (type === 9) { need(16); offset += 16; }
        else throw new Error(`AWS EventStream header ${name} has unknown type ${type}`);
    }

    const payloadBytes = data.subarray(headerEnd, totalLength - 4);
    if (payloadBytes.length === 0) return { headers, payload: null };
    const payloadText = decoder.decode(payloadBytes);
    try { return { headers, payload: JSON.parse(payloadText) }; }
    catch (error) { throw new Error(`AWS EventStream payload is not valid JSON (${String(error)})`); }
}

function parseFrames(bytes: Uint8Array): KiroEvent[] {
    const events: KiroEvent[] = [];
    let offset = 0;
    while (offset < bytes.length) {
        if (bytes.length - offset < 12) throw new Error("Kiro EventStream ended with a truncated frame");
        const view = new DataView(bytes.buffer, bytes.byteOffset + offset, bytes.length - offset);
        const totalLength = view.getUint32(0, false);
        if (totalLength < 16 || totalLength > MAX_FRAME_BYTES || offset + totalLength > bytes.length) throw new Error("Kiro EventStream ended with a truncated frame");
        events.push(parseEventFrame(bytes.subarray(offset, offset + totalLength)));
        offset += totalLength;
    }
    return events;
}

async function* streamFrames(body: ReadableStream<Uint8Array>): AsyncGenerator<KiroEvent, void, void> {
    const reader = body.getReader();
    let buffer = new Uint8Array(0);
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (value?.length) {
                const combined = new Uint8Array(buffer.length + value.length);
                combined.set(buffer);
                combined.set(value, buffer.length);
                buffer = combined;
            }
            let offset = 0;
            while (buffer.length - offset >= 12) {
                const view = new DataView(buffer.buffer, buffer.byteOffset + offset, buffer.length - offset);
                const totalLength = view.getUint32(0, false);
                if (totalLength < 16 || totalLength > MAX_FRAME_BYTES) throw new Error("AWS EventStream frame bounds are invalid");
                if (buffer.length - offset < totalLength) break;
                yield parseEventFrame(buffer.subarray(offset, offset + totalLength));
                offset += totalLength;
            }
            if (offset > 0) buffer = buffer.slice(offset);
            if (done) break;
            if (buffer.length > MAX_FRAME_BYTES) throw new Error("AWS EventStream frame exceeds maximum size");
        }
        if (buffer.length !== 0) throw new Error("Kiro EventStream ended with a truncated frame");
    } finally {
        reader.releaseLock();
    }
}

function chunk(id: string, model: string, delta: ChatCompletionChunk["choices"][number]["delta"], finishReason: ChatCompletionChunk["choices"][number]["finish_reason"] = null): ChatCompletionChunk {
    return { id, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, delta, finish_reason: finishReason }] };
}

export class KiroExecutor implements AIProvider {
    id: string;
    name: string;
    category = "api_key" as const;
    protocol = "custom" as const;
    private baseUrl?: string;
    private apiKey: string;
    private accessToken: string;
    private refreshToken?: string;
    private providerSpecificData: KiroProviderSpecificData;

    constructor(options: KiroExecutorOptions = {}) {
        this.id = options.id ?? "kiro";
        this.name = options.name ?? "Kiro";
        this.baseUrl = options.baseUrl?.replace(/\/$/, "");
        this.apiKey = options.apiKey ?? process.env.KIRO_API_KEY ?? "";
        this.accessToken = options.accessToken ?? process.env.KIRO_ACCESS_TOKEN ?? "";
        this.refreshToken = options.refreshToken;
        this.providerSpecificData = {
            authMethod: options.authMethod ?? options.providerSpecificData?.authMethod ?? (options.apiKey ? "api_key" : "builder-id"),
            region: options.region ?? options.providerSpecificData?.region ?? "us-east-1",
            profileArn: options.profileArn ?? options.providerSpecificData?.profileArn,
        };
    }

    updateToken(accessToken: string, refreshToken?: string): void {
        if (accessToken) this.accessToken = accessToken;
        if (refreshToken) this.refreshToken = refreshToken;
    }

    getOrderedBaseUrls(): string[] {
        if (this.baseUrl) return [this.baseUrl];
        const region = this.providerSpecificData.region?.trim() || "us-east-1";
        const regionalize = (url: string): string => region === "us-east-1" ? url : url.replace(/([a-z]+)\.us-east-1\.amazonaws\.com/, `$1.${region}.amazonaws.com`);
        const aws = [Q_URL, CODEWHISPERER_URL].map(regionalize);
        const auth = this.providerSpecificData.authMethod;
        return auth === "api_key" || auth === "external_idp" || auth === "idc"
            ? [...(auth === "api_key" ? [aws[0], aws[1]] : [aws[1], aws[0]]), RUNTIME_URL]
            : [RUNTIME_URL, aws[1], aws[0]];
    }

    buildRequest(req: ChatCompletionRequest): KiroRequest {
        const model = bareModel(req.model);
        const messages: KiroMessage[] = [];
        let currentIndex = -1;
        for (const message of req.messages) {
            if (message.role === "system") {
                messages.push({ userInputMessage: { content: `<instructions>\n${textOf(message.content)}\n</instructions>`, modelId: model } });
            } else if (message.role === "assistant") {
                messages.push({ assistantResponseMessage: { content: textOf(message.content) } });
            } else {
                const context: Record<string, unknown> = {};
                if (message.role === "tool" && message.tool_call_id) {
                    context.toolResults = [{ toolUseId: message.tool_call_id, status: "success", content: [{ text: textOf(message.content) }] }];
                }
                const userMessage: KiroMessage = { userInputMessage: { content: textOf(message.content) || "continue", modelId: model } };
                if (Object.keys(context).length > 0) userMessage.userInputMessage!.userInputMessageContext = context;
                messages.push(userMessage);
                currentIndex = messages.length - 1;
            }
        }
        const current = currentIndex >= 0 ? messages.splice(currentIndex, 1)[0]! : { userInputMessage: { content: "continue", modelId: model } };
        const tools = (req.tools ?? []).map((tool: ToolDefinition) => ({
            toolSpecification: {
                name: tool.function.name,
                description: tool.function.description ?? "",
                inputSchema: { json: tool.function.parameters ?? { type: "object", properties: {} } },
            },
        }));
        if (tools.length > 0) current.userInputMessage!.userInputMessageContext = {
            ...(current.userInputMessage!.userInputMessageContext ?? {}), tools,
        };
        const payload: KiroRequest = {
            conversationState: {
                chatTriggerType: "MANUAL",
                conversationId: crypto.randomUUID(),
                agentContinuationId: crypto.randomUUID(),
                agentTaskType: "vibe",
                currentMessage: current,
                history: messages,
            },
            agentMode: "vibe",
            inferenceConfig: { maxTokens: req.max_tokens ?? 32000, ...(req.temperature === undefined ? {} : { temperature: req.temperature }), ...(req.top_p === undefined ? {} : { topP: req.top_p }) },
        };
        const authMethod = this.providerSpecificData.authMethod;
        if (this.providerSpecificData.profileArn && authMethod !== "api_key" && authMethod !== "idc" && authMethod !== "external_idp") payload.profileArn = this.providerSpecificData.profileArn;
        return payload;
    }

    private headers(url: string): Record<string, string> {
        const token = this.accessToken || this.apiKey;
        const headers: Record<string, string> = {
            "Content-Type": "application/json",
            "Amz-Sdk-Request": "attempt=1; max=3",
            "Amz-Sdk-Invocation-Id": crypto.randomUUID(),
        };
        if (url.includes("codewhisperer.")) headers["X-Amz-Target"] = CODEWHISPERER_TARGET;
        if (token) headers.Authorization = `Bearer ${token}`;
        if (this.providerSpecificData.authMethod === "api_key") headers.TokenType = "API_KEY";
        else if (this.providerSpecificData.authMethod === "external_idp") headers.TokenType = "EXTERNAL_IDP";
        return headers;
    }

    async listModels(): Promise<ModelObject[]> {
        if (!(this.accessToken || this.apiKey)) return [];
        return DEFAULT_MODELS.map((id) => ({ id, object: "model" as const, created: Math.floor(Date.now() / 1000), owned_by: "kiro" }));
    }

    async chatCompletion(req: ChatCompletionRequest): Promise<ChatCompletionResponse> {
        const chunks: ChatCompletionChunk[] = [];
        for await (const value of this.chatCompletionStream(req)) chunks.push(value);
        const text = chunks.map((value) => value.choices[0]?.delta.content ?? "").join("");
        const toolCalls = chunks.flatMap((value) => value.choices[0]?.delta.tool_calls ?? []);
        return {
            id: chunks[0]?.id ?? `chatcmpl-${Date.now()}`,
            object: "chat.completion",
            created: chunks[0]?.created ?? Math.floor(Date.now() / 1000),
            model: req.model,
            choices: [{ index: 0, message: { role: "assistant", content: text || null, ...(toolCalls.length ? { tool_calls: toolCalls.map((call) => ({ id: call.id ?? crypto.randomUUID(), type: "function" as const, function: { name: call.function?.name ?? "", arguments: call.function?.arguments ?? "" } })) } : {}) }, finish_reason: toolCalls.length ? "tool_calls" : "stop" }],
        };
    }

    async *chatCompletionStream(req: ChatCompletionRequest): AsyncGenerator<ChatCompletionChunk, void, void> {
        const body = this.buildRequest(req);
        const model = bareModel(req.model);
        let response: Response | undefined;
        let lastError = "";
        for (const url of this.getOrderedBaseUrls()) {
            try {
                response = await fetch(url, { method: "POST", headers: this.headers(url), body: JSON.stringify(body) });
                if (response.ok || ![401, 403, 404, 429, 500, 502, 503, 504].includes(response.status)) break;
                lastError = await response.text();
            } catch (error) {
                lastError = String(error);
            }
        }
        if (!response?.ok) throw new Error(`Kiro Provider Error (${response?.status ?? 502}): ${lastError}`);
        if (!response.body) throw new Error("Kiro Provider Error (502): response body is missing");
        const responseId = `chatcmpl-${Date.now()}`;
        let first = true;
        let hadTool = false;
        const tools = new Map<string, { name: string; input: string }>();
        let stop: "end_turn" | "tool_use" | "max_tokens" | null = null;
        for await (const event of streamFrames(response.body)) {
            const type = String(event.headers[":event-type"] ?? "");
            const payload = asObject(event.payload);
            if (type === "assistantResponseEvent" || type === "codeEvent") {
                const content = String(payload.content ?? "");
                if (content) { yield chunk(responseId, req.model, { ...(first ? { role: "assistant" as const } : {}), content }); first = false; }
            } else if (type === "reasoningContentEvent") {
                const value = payload.reasoningContentEvent ?? payload;
                const valueObject = asObject(value);
                const content = typeof value === "string" ? value : String(valueObject.text ?? valueObject.content ?? "");
                if (content) { yield chunk(responseId, req.model, { ...(first ? { role: "assistant" as const } : {}), reasoning_content: content }); first = false; }
            } else if (type === "toolUseEvent") {
                const values = Array.isArray(event.payload) ? event.payload : [event.payload];
                for (const rawValue of values) {
                    const value = asObject(rawValue);
                    const id = String(value.toolUseId ?? `call_${Date.now()}_${tools.size + 1}`);
                    const previous = tools.get(id);
                    const fragment = typeof value.input === "string" ? value.input : value.input === undefined ? "" : JSON.stringify(value.input);
                    tools.set(id, {
                        name: String(value.name ?? previous?.name ?? ""),
                        input: `${previous?.input ?? ""}${fragment}`,
                    });
                }
                hadTool = true;
            } else if (type === "messageStopEvent" || type === "metadataEvent" || type === "MetadataEvent") {
                const metadata = asObject(payload.metadata);
                stop = normalizeStopReason(payload.stopReason ?? payload.stop_reason ?? metadata.stopReason) ?? stop;
            }
        }
        for (const [id, value] of tools) {
            yield chunk(responseId, req.model, { ...(first ? { role: "assistant" as const } : {}), tool_calls: [{ index: 0, id, type: "function", function: { name: value.name, arguments: value.input } }] });
            first = false;
        }
        yield chunk(responseId, req.model, {}, hadTool || stop === "tool_use" ? "tool_calls" : stop === "max_tokens" ? "length" : "stop");
    }
}

export { parseEventFrame, parseFrames };
