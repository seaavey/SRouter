import type {
    AIProvider,
    ChatCompletionChunk,
    ChatCompletionRequest,
    ChatCompletionResponse,
    ModelObject,
} from "@srouter/types";
import {
    ANTIGRAVITY_IDE_BASE_URL,
    ANTIGRAVITY_IDE_USER_AGENT,
    buildAntigravityEnvelope,
    buildGeminiContents,
    buildGeminiStreamUrl,
    cleanJSONSchemaForAntigravity,
    createGeminiStreamState,
    generateProjectId,
    generateSessionId,
    geminiStreamToOpenAIChunks,
    parseGeminiResponse,
    sanitizeFunctionName,
    type GeminiContent,
} from "@srouter/translator";
import { OpenAIExecutor } from "./openai.js";
import { parseDataLine, streamLines } from "./base.js";

export interface AntigravityExecutorOptions {
    id?: string;
    name?: string;
    baseUrl?: string;
    apiKey?: string;
    accessToken?: string;
    refreshToken?: string;
    projectId?: string;
}

const MAX_RETRY_AFTER_MS = 10000;
const ANTIGRAVITY_TRANSIENT_RETRY_MAX_MS = 15000;
const MAX_ANTIGRAVITY_OUTPUT_TOKENS = 64000;

const ANTIGRAVITY_TRANSIENT_ERROR_PATTERNS = [
    /high\s+traffic/i,
    /agent\s+(execution\s+)?terminated\s+due\s+to\s+error/i,
    /capacity/i,
    /temporarily\s+unavailable/i,
    /timeout/i,
    /stream\s+(ended|closed|terminated|interrupted)/i,
    /empty\s+response/i,
];

const ANTIGRAVITY_TRANSIENT_STATUSES = new Set([500, 502, 503, 504]);

// Fields Google generateContent rejects (Claude/OpenAI/Qwen thinking fields)
const ANTIGRAVITY_REQUEST_BLACKLIST = [
    "output_config",
    "thinking",
    "reasoning_effort",
    "reasoning",
    "enable_thinking",
    "thinking_budget",
    "thinkingConfig",
];

const stripBlacklisted = (obj: Record<string, unknown>): void => {
    for (const key of ANTIGRAVITY_REQUEST_BLACKLIST) delete obj[key];
};

// Image generation model name patterns
const IMAGE_MODEL_PATTERNS = [/image/i, /imagen/i, /image-generation/i];

function isImageModel(model: string): boolean {
    return IMAGE_MODEL_PATTERNS.some((p) => p.test(model));
}

// Parse aspect ratio / resolution from model name suffixes
function parseImageConfig(model: string): Record<string, string> {
    const config: Record<string, string> = { aspectRatio: "1:1" };
    const resMatch = model.match(/(\d+)x(\d+)$/);
    if (resMatch) {
        const w = parseInt(resMatch[1]);
        const h = parseInt(resMatch[2]);
        if (w <= 16 && h <= 16) {
            config.aspectRatio = `${w}:${h}`;
        } else {
            const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
            const d = gcd(w, h);
            config.aspectRatio = `${w / d}:${h / d}`;
        }
    }
    return config;
}

/**
 * Antigravity Executor — Google Antigravity IDE backend (daily-cloudcode-pa).
 * Ported from 9router open-sse/executors/antigravity.js (envelope + native SSE + retry).
 * Falls back to OpenAI-compatible endpoint for local proxy / AIzaSy API keys.
 */
export class AntigravityExecutor implements AIProvider {
    id: string;
    name: string;
    category = "oauth" as const;
    protocol = "openai" as const;
    private baseUrl: string;
    private apiKey: string;
    private accessToken: string;
    private refreshToken?: string;
    private projectId: string;
    private sessionId: string;
    private openaiFallback: OpenAIExecutor;

    constructor(options: AntigravityExecutorOptions = {}) {
        this.id = options.id ?? "antigravity";
        this.name = options.name ?? "Antigravity Provider";
        this.baseUrl = (options.baseUrl ?? process.env.ANTIGRAVITY_BASE_URL ?? ANTIGRAVITY_IDE_BASE_URL).replace(/\/$/, "");
        this.apiKey = options.apiKey ?? process.env.ANTIGRAVITY_API_KEY ?? "";
        this.accessToken = options.accessToken ?? process.env.ANTIGRAVITY_ACCESS_TOKEN ?? "";
        this.refreshToken = options.refreshToken;
        this.projectId = options.projectId ?? process.env.ANTIGRAVITY_PROJECT_ID ?? generateProjectId();
        this.sessionId = generateSessionId();
        this.openaiFallback = new OpenAIExecutor({
            id: this.id,
            name: this.name,
            baseUrl: options.baseUrl || "https://generativelanguage.googleapis.com/v1beta/openai",
            apiKey: options.apiKey,
            accessToken: this.accessToken,
        });
    }

    /**
     * Update tokens after a refresh — called by TokenRefreshService.
     */
    updateToken(accessToken: string, refreshToken?: string): void {
        if (accessToken) {
            this.accessToken = accessToken;
            this.openaiFallback.updateToken(accessToken);
        }
        if (refreshToken) this.refreshToken = refreshToken;
    }

    private getHeaders(extra?: Record<string, string>): Record<string, string> {
        const headers: Record<string, string> = {
            "Content-Type": "application/json",
            "User-Agent": ANTIGRAVITY_IDE_USER_AGENT,
        };
        const token = this.accessToken || this.apiKey;
        if (token) {
            headers["Authorization"] = `Bearer ${token}`;
            if (token.startsWith("AIzaSy")) {
                headers["x-goog-api-key"] = token;
            } else if (token.startsWith("ya29.")) {
                headers["x-goog-api-client"] = "gl-node/18.0.0 gd/1.0.0";
            }
        }
        if (extra) {
            Object.assign(headers, extra);
        }
        return headers;
    }

    private isLocalProxy(): boolean {
        return /^https?:\/\/127\.0\.0\.1(:\d+)?(\/|$)/.test(this.baseUrl) || /^https?:\/\/localhost(:\d+)?(\/|$)/.test(this.baseUrl);
    }

    private isApiKey(): boolean {
        const token = this.accessToken || this.apiKey;
        return token.startsWith("AIzaSy");
    }

    private isYa29(): boolean {
        const token = this.accessToken || this.apiKey;
        return token.startsWith("ya29.");
    }

    private getToken(): string {
        return this.accessToken || this.apiKey;
    }

    async listModels(): Promise<ModelObject[]> {
        const token = this.getToken();
        const isLocalProxy = this.isLocalProxy();
        const isApiKey = this.isApiKey();

        // 1. OpenAI-compatible endpoint (local proxy or AIzaSy key on /openai base)
        if (isLocalProxy || (isApiKey && this.baseUrl.includes("/openai"))) {
            return await this.openaiFallback.listModels();
        }

        // 2. Native Gemini models endpoint
        const cleanBaseUrl = this.baseUrl.replace(/\/openai$/, "");
        const baseId = this.id.split("_")[0]?.split("-")[0] ?? this.id;
        const models: ModelObject[] = [];
        const seenIds = new Set<string>();

        const pushModel = (rawId: string): void => {
            const id = rawId.replace(/^models\//, "");
            if (seenIds.has(id)) return;
            seenIds.add(id);
            models.push({ id, object: "model", created: Math.floor(Date.now() / 1000), owned_by: "antigravity" });
            if (!id.startsWith(`${baseId}/`)) {
                models.push({ id: `${baseId}/${id}`, object: "model", created: Math.floor(Date.now() / 1000), owned_by: "antigravity" });
            }
        };

        try {
            const res = await fetch(`${cleanBaseUrl}/models`, {
                method: "GET",
                headers: this.getHeaders(),
            });
            if (res.ok) {
                const json = (await res.json()) as { models?: Array<{ name?: string }> };
                if (json.models && Array.isArray(json.models)) {
                    for (const m of json.models) {
                        if (m.name) pushModel(m.name);
                    }
                    if (models.length > 0) return models;
                }
            }
        } catch {
            // fall through to CloudCode attempt
        }

        // 3. ya29 OAuth token: CloudCode fetchAvailableModels
        if (token.startsWith("ya29.")) {
            try {
                const res = await fetch("https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels", {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${token}`,
                        "Content-Type": "application/json",
                        "User-Agent": ANTIGRAVITY_IDE_USER_AGENT,
                        "x-goog-api-client": "gl-node/18.0.0 gd/1.0.0",
                    },
                    body: JSON.stringify({}),
                });
                if (res.ok) {
                    const data = (await res.json()) as { models?: Record<string, { displayName?: string }> };
                    if (data.models && Object.keys(data.models).length > 0) {
                        for (const modelId of Object.keys(data.models)) {
                            pushModel(modelId);
                        }
                        return models;
                    }
                }
            } catch {
                // no models available
            }
        }

        // 4. Never return hardcoded models — provider could not verify its model list
        return [];
    }

    private parseModelName(rawModel: string): string {
        // Strip any {alias}/ or {providerId}/ prefix — keep the real model id
        return rawModel.includes("/") ? (rawModel.split("/")[1] ?? rawModel) : rawModel;
    }

    /**
     * Build the Antigravity request envelope + sanitized request body.
     * Port of 9router transformRequest (standard agent request path).
     */
    private buildRequest(model: string, req: ChatCompletionRequest, stream: boolean): { url: string; body: Record<string, unknown> } {
        const cleanBaseUrl = this.baseUrl.replace(/\/openai$/, "");
        const modelName = this.parseModelName(model);

        // Build contents (with tool support)
        const contents = this.buildContentsWithTools(req);

        // ─── Image generation: different request structure ───
        if (isImageModel(modelName)) {
            const imageConfig = parseImageConfig(modelName);
            const cleanModel = modelName.replace(/-\d+x\d+$/, "");
            const request: Record<string, unknown> = {
                contents,
                generationConfig: {
                    temperature: 1.0,
                    topP: 0.95,
                    topK: 40,
                    maxOutputTokens: 8192,
                    imageConfig,
                },
                sessionId: this.sessionId,
            };
            const envelope = buildAntigravityEnvelope({
                projectId: this.projectId,
                model: cleanModel,
                requestType: "image_gen",
                request,
                body: req as unknown as { requestId?: string },
                sessionId: this.sessionId,
            });
            // Image gen MUST use non-streaming generateContent
            const url = `${cleanBaseUrl}/v1internal:generateContent`;
            return { url, body: envelope };
        }

        // ─── Standard request ───
        const tools = this.buildTools(req);

        const request: Record<string, unknown> = {
            contents,
            sessionId: this.sessionId,
            safetySettings: undefined,
        };
        if (tools.length > 0) {
            request.tools = tools;
            request.toolConfig = { functionCallingConfig: { mode: "VALIDATED" } };
        }

        stripBlacklisted(request);

        const envelope = buildAntigravityEnvelope({
            projectId: this.projectId,
            model: modelName,
            requestType: "agent",
            request,
            body: req as unknown as { requestId?: string },
            sessionId: this.sessionId,
        });

        const url = stream
            ? `${cleanBaseUrl}/v1internal:streamGenerateContent?alt=sse`
            : `${cleanBaseUrl}/v1internal:generateContent`;

        return { url, body: envelope };
    }

    /**
     * Build Gemini contents from ChatCompletionRequest messages, mapping tools.
     */
    private buildContentsWithTools(req: ChatCompletionRequest): GeminiContent[] {
        const contents: GeminiContent[] = [];
        for (const m of req.messages) {
            const role = m.role === "assistant" ? "model" : "user";
            const parts: GeminiContent["parts"] = [];

            if (m.role === "assistant" && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
                for (const tc of m.tool_calls) {
                    let args: Record<string, unknown> = {};
                    try {
                        args = JSON.parse(tc.function.arguments || "{}");
                    } catch {
                        args = { raw: tc.function.arguments };
                    }
                    parts.push({
                        text: "",
                        functionCall: { name: tc.function.name, args },
                    });
                }
            } else if (m.role === "tool" && m.tool_call_id) {
                parts.push({
                    text: "",
                    functionResponse: { name: m.tool_call_id, response: { result: typeof m.content === "string" ? m.content : JSON.stringify(m.content) } },
                });
            } else {
                const text = typeof m.content === "string" ? m.content : Array.isArray(m.content) ? m.content.map((c) => (c.type === "text" ? c.text || "" : "")).join("\n") : String(m.content ?? "");
                if (text) parts.push({ text });
            }

            if (parts.length === 0) parts.push({ text: "" });
            contents.push({ role, parts });
        }
        if (contents.length === 0) {
            contents.push({ role: "user", parts: [{ text: "..." }] });
        }
        return contents;
    }

    /**
     * Build Gemini tools array from ChatCompletionRequest tools, sanitizing names + schemas.
     */
    private buildTools(req: ChatCompletionRequest): Array<Record<string, unknown>> {
        if (!Array.isArray(req.tools) || req.tools.length === 0) return [];
        const declarations: Array<Record<string, unknown>> = [];
        const seenNames = new Set<string>();
        for (const tool of req.tools) {
            if (!tool || typeof tool !== "object") continue;
            const type = (tool as { type?: string }).type;
            if (type !== "function") continue;
            const fn = (tool as { function?: { name?: string; description?: string; parameters?: unknown } }).function;
            if (!fn) continue;
            const name = sanitizeFunctionName(fn.name || "");
            if (seenNames.has(name)) continue;
            seenNames.add(name);
            declarations.push({
                name,
                description: fn.description || "",
                parameters: fn.parameters ? cleanJSONSchemaForAntigravity(structuredClone(fn.parameters)) : { type: "object", properties: { reason: { type: "string", description: "Brief explanation" } }, required: ["reason"] },
            });
        }
        return declarations.length > 0 ? [{ functionDeclarations: declarations }] : [];
    }

    /**
     * Build the URL + body for the OpenAI-compatible fallback path (local proxy / AIzaSy).
     */
    private buildFallbackRequest(req: ChatCompletionRequest, stream: boolean): { url: string; body: unknown } {
        const targetModel = req.model.includes("/") ? (req.model.split("/")[1] ?? req.model) : req.model;
        const body = { ...req, model: targetModel, stream };
        return { url: `${this.openaiFallback["baseUrl"]}/chat/completions`, body };
    }

    async chatCompletion(req: ChatCompletionRequest): Promise<ChatCompletionResponse> {
        const token = this.getToken();
        const isLocalProxy = this.isLocalProxy();
        const isApiKey = this.isApiKey();

        // 1. OpenAI-compatible fallback
        if (isLocalProxy || (isApiKey && this.baseUrl.includes("/openai"))) {
            return await this.openaiFallback.chatCompletion(req);
        }

        // 2. Native Antigravity — accumulate stream for non-streaming callers
        const chunks: ChatCompletionChunk[] = [];
        for await (const chunk of this.chatCompletionStream(req)) {
            chunks.push(chunk);
        }
        return accumulateChunksLocal(chunks, req.model);
    }

    async *chatCompletionStream(req: ChatCompletionRequest): AsyncGenerator<ChatCompletionChunk, void, void> {
        const token = this.getToken();
        const isLocalProxy = this.isLocalProxy();
        const isApiKey = this.isApiKey();

        if (isLocalProxy || (isApiKey && this.baseUrl.includes("/openai"))) {
            yield* this.openaiFallback.chatCompletionStream(req);
            return;
        }

        const { url, body } = this.buildRequest(req.model, req, true);
        const streamUrl = url.includes("?") ? url : `${url}?alt=sse`;
        const res = await this.fetchWithRetry(streamUrl, body);

        if (!res.ok) {
            const errorText = await res.text();
            throw new Error(`Antigravity Provider Error (${res.status}): ${errorText}`);
        }

        if (!res.body) {
            throw new Error("No response body received for streaming");
        }

        const state = createGeminiStreamState(req.model);
        for await (const line of streamLines(res.body)) {
            const jsonStr = parseDataLine(line);
            if (jsonStr === null) continue;
            try {
                const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
                const chunks = geminiStreamToOpenAIChunks(parsed, state);
                if (chunks) {
                    for (const chunk of chunks) yield chunk;
                }
            } catch {
                // ignore malformed JSON
            }
        }
    }

    /**
     * Fetch with retry/backoff for transient Antigravity errors.
     * Port of 9router computeRetryDelay: Retry-After header → error message → transient patterns.
     */
    private async fetchWithRetry(url: string, body: Record<string, unknown>): Promise<Response> {
        const maxAttempts = 3;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const res = await fetch(url, {
                method: "POST",
                headers: this.getHeaders(),
                body: JSON.stringify(body),
            });

            if (res.ok) return res;

            const retryMs = await this.computeRetryDelay(res, attempt);
            if (!retryMs) return res;

            await new Promise((r) => setTimeout(r, retryMs));
        }
        // Last attempt returns as-is
        return fetch(url, {
            method: "POST",
            headers: this.getHeaders(),
            body: JSON.stringify(body),
        });
    }

    private parseRetryHeaders(headers: Headers): number | null {
        const retryAfter = headers.get("retry-after");
        if (retryAfter) {
            const seconds = parseInt(retryAfter, 10);
            if (!isNaN(seconds) && seconds > 0) return seconds * 1000;

            const date = new Date(retryAfter);
            if (!isNaN(date.getTime())) {
                const diff = date.getTime() - Date.now();
                return diff > 0 ? diff : null;
            }
        }

        const resetAfter = headers.get("x-ratelimit-reset-after");
        if (resetAfter) {
            const seconds = parseInt(resetAfter, 10);
            if (!isNaN(seconds) && seconds > 0) return seconds * 1000;
        }

        const resetTimestamp = headers.get("x-ratelimit-reset");
        if (resetTimestamp) {
            const ts = parseInt(resetTimestamp, 10) * 1000;
            const diff = ts - Date.now();
            return diff > 0 ? diff : null;
        }

        return null;
    }

    private parseRetryFromErrorMessage(errorMessage: string): number | null {
        if (!errorMessage || typeof errorMessage !== "string") return null;
        const match = errorMessage.match(/reset after (\d+h)?(\d+m)?(\d+s)?/i);
        if (!match) return null;
        let totalMs = 0;
        if (match[1]) totalMs += parseInt(match[1]) * 3600 * 1000;
        if (match[2]) totalMs += parseInt(match[2]) * 60 * 1000;
        if (match[3]) totalMs += parseInt(match[3]) * 1000;
        return totalMs > 0 ? totalMs : null;
    }

    private extractErrorMessage(errorJson: unknown, bodyText = ""): string {
        const parts: string[] = [];
        const err = errorJson as { error?: { message?: unknown }; message?: unknown } | null;
        if (err?.error?.message) parts.push(String(err.error.message));
        if (err?.message) parts.push(String(err.message));
        if (err?.error) parts.push(typeof err.error === "string" ? err.error : JSON.stringify(err.error));
        if (bodyText) parts.push(bodyText);
        return parts.filter(Boolean).join("\n");
    }

    private isTransientAntigravityError(status: number, message: string): boolean {
        if (status === 429) return true;
        if (ANTIGRAVITY_TRANSIENT_STATUSES.has(status)) return true;
        return ANTIGRAVITY_TRANSIENT_ERROR_PATTERNS.some((pattern) => pattern.test(message || ""));
    }

    private async computeRetryDelay(response: Response, attempt: number): Promise<number | null> {
        let bodyText = "";
        let errorJson: unknown = null;
        let retryMs = this.parseRetryHeaders(response.headers);

        try {
            bodyText = await response.clone().text();
            errorJson = bodyText ? JSON.parse(bodyText) : null;
        } catch {
            // ignore parse errors
        }

        const errorMessage = this.extractErrorMessage(errorJson, bodyText);

        if (!retryMs) {
            retryMs = this.parseRetryFromErrorMessage(errorMessage);
        }
        if (retryMs) return retryMs <= MAX_RETRY_AFTER_MS ? retryMs : null;

        if (!this.isTransientAntigravityError(response.status, errorMessage)) return null;

        const cap = response.status === 429 ? MAX_RETRY_AFTER_MS : ANTIGRAVITY_TRANSIENT_RETRY_MAX_MS;
        return Math.min(1000 * (2 ** attempt), cap);
    }
}

// Accumulate streamed chunks into a non-streaming response
function accumulateChunksLocal(chunks: ChatCompletionChunk[], model: string): ChatCompletionResponse {
    let content = "";
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

    const toolCalls = Array.from(toolCallMap.values()).map((entry) => ({
        id: entry.id,
        type: "function" as const,
        function: { name: entry.name, arguments: entry.args },
    }));

    const finishReason = chunks.at(-1)?.choices[0]?.finish_reason ?? "stop";
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
