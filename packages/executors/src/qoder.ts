import crypto, { randomUUID } from "node:crypto";
import {
    QODER_CHAT_BASE,
    QODER_CHAT_BASE_ALT,
    QODER_CHAT_SIG_PATH,
    QODER_CLIENT_TYPE,
    QODER_DATA_POLICY,
    QODER_IDE_VERSION,
    QODER_JOB_TOKEN_EXCHANGE_URL,
    QODER_LOGIN_VERSION,
    QODER_MACHINE_OS,
    QODER_MACHINE_TYPE,
    QODER_MODELS,
    QODER_MODEL_ALIASES,
    QODER_RSA_PUBLIC_KEY,
    QODER_USERINFO_URL
} from "@srouter/constants";
import type {
    AIProvider,
    ChatCompletionChunk,
    ChatCompletionRequest,
    ChatCompletionResponse,
    ModelObject
} from "@srouter/types";
import { parseDataLine, streamLines } from "./base.js";

/**
 * ============================================================================
 * SRouter Qoder Executor
 *
 * Inspired by & ported from OmniRoute (open-sse/executors/qoder & services/qoder*)
 * Upstream Reference: https://github.com/diegosouzapw/OmniRoute
 *
 * Key Capabilities:
 * - WAF-Bypass Body Encoding (Custom alphabet transposition)
 * - COSY Request Signing (1024-bit RSA + AES-128-CBC handshake)
 * - Dual Authentication (Device Code OAuth PKCE & Personal Access Token)
 * - SSE Envelope Unwrapping ({ statusCodeValue, body })
 * - Thinking/Reasoning tool_choice compatibility sanitizer
 * ============================================================================
 */

export interface QoderProviderSpecificData {
    authMethod?: "pat" | "device" | string;
    userId?: string;
    machineId?: string;
    organizationId?: string;
    name?: string;
    email?: string;
}

export interface QoderExecutorOptions {
    id?: string;
    name?: string;
    baseUrl?: string;
    apiKey?: string;
    accessToken?: string;
    refreshToken?: string;
    providerSpecificData?: QoderProviderSpecificData;
}

/**
 * Detects if Qwen / Qoder reasoning (thinking) is active on a request.
 */
export function isQwenThinkingActive(
    req: ChatCompletionRequest,
    modelConfig?: Record<string, unknown>
): boolean {
    const raw = req as unknown as Record<string, unknown>;
    const thinking = raw.thinking;
    if (thinking === true || raw.enable_thinking === true) return true;
    if (typeof thinking === "object" && thinking !== null && !Array.isArray(thinking)) {
        if ((thinking as Record<string, unknown>).type === "enabled") return true;
    }
    return Boolean(modelConfig?.is_reasoning);
}

/**
 * Strips incompatible tool_choice parameter when thinking/reasoning is active on Qwen/Qoder
 * to avoid upstream DashScope 400 Bad Request errors.
 */
export function sanitizeQwenThinkingToolChoice(
    payload: Record<string, unknown>,
    isThinking: boolean
): void {
    if (isThinking && "tool_choice" in payload) {
        delete payload.tool_choice;
    }
}

// ─── WAF-Bypass Body Encoding ───

const QODER_STD_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const QODER_CUSTOM_ALPHABET = "_doRTgHZBKcGVjlvpC,@aFSx#DPuNJme&i*MzLOEn)sUrthbf%Y^w.(kIQyXqWA!";

const QODER_S2C = (() => {
    const table = new Int16Array(128).fill(-1);
    for (let i = 0; i < 64; i++) {
        table[QODER_STD_ALPHABET.charCodeAt(i)] = QODER_CUSTOM_ALPHABET.charCodeAt(i);
    }
    table["=".charCodeAt(0)] = "$".charCodeAt(0);
    return table;
})();

export function qoderEncodeBody(plaintext: Buffer | Uint8Array | string): string {
    const buf = Buffer.isBuffer(plaintext)
        ? plaintext
        : typeof plaintext === "string"
          ? Buffer.from(plaintext, "utf8")
          : Buffer.from(plaintext);

    const std = buf.toString("base64");
    const n = std.length;
    const a = Math.floor(n / 3);
    // [tail][mid][head]
    const rearranged = std.slice(n - a) + std.slice(a, n - a) + std.slice(0, a);

    const out = Buffer.alloc(n);
    for (let i = 0; i < n; i++) {
        const c = rearranged.charCodeAt(i);
        if (c < 128 && QODER_S2C[c] >= 0) {
            out[i] = QODER_S2C[c];
        } else {
            out[i] = c;
        }
    }
    return out.toString("latin1");
}

// ─── COSY Signing Implementation ───

function generateAesKey(): string {
    return randomUUID().slice(0, 16);
}

function pkcs7Pad(data: Buffer, blockSize: number): Buffer {
    const padding = blockSize - (data.length % blockSize);
    const padded = Buffer.alloc(data.length + padding, padding);
    data.copy(padded, 0);
    return padded;
}

function aesEncryptCbcBase64(plaintext: string, keyStr: string): string {
    const keyBytes = Buffer.from(keyStr, "utf8");
    const iv = keyBytes.subarray(0, 16);
    const cipher = crypto.createCipheriv("aes-128-cbc", keyBytes, iv);
    cipher.setAutoPadding(false);
    const padded = pkcs7Pad(Buffer.from(plaintext, "utf8"), 16);
    const encrypted = Buffer.concat([cipher.update(padded), cipher.final()]);
    return encrypted.toString("base64");
}

function rsaEncryptBase64(data: string): string {
    const encrypted = crypto.publicEncrypt(
        { key: QODER_RSA_PUBLIC_KEY, padding: crypto.constants.RSA_PKCS1_PADDING },
        Buffer.from(data, "utf8")
    );
    return encrypted.toString("base64");
}

function encryptUserInfo(userInfo: Record<string, string>): { cosyKey: string; info: string } {
    const aesKey = generateAesKey();
    const plaintext = JSON.stringify(userInfo);
    const infoB64 = aesEncryptCbcBase64(plaintext, aesKey);
    const cosyKeyB64 = rsaEncryptBase64(aesKey);
    return { cosyKey: cosyKeyB64, info: infoB64 };
}

function md5Hex(input: Buffer | string): string {
    return crypto.createHash("md5").update(input).digest("hex");
}

function computeSigPath(requestUrl: string): string {
    try {
        const pathname = new URL(requestUrl).pathname || "";
        if (pathname.startsWith("/algo")) {
            return pathname.slice("/algo".length);
        }
        return pathname;
    } catch {
        return "";
    }
}

export interface CosyCredentials {
    userId: string;
    authToken: string;
    name?: string;
    email?: string;
    machineId?: string;
}

export function buildCosyHeaders(
    body: Buffer | Uint8Array | string,
    requestUrl: string,
    creds: CosyCredentials
): Record<string, string> {
    if (!creds?.userId) throw new Error("cosy: user id is empty");
    if (!creds?.authToken) throw new Error("cosy: auth token is empty");

    const bodyBuf = Buffer.isBuffer(body)
        ? body
        : typeof body === "string"
          ? Buffer.from(body, "latin1")
          : Buffer.from(body || []);

    const { cosyKey, info } = encryptUserInfo({
        uid: creds.userId,
        security_oauth_token: creds.authToken,
        name: creds.name || "",
        aid: "",
        email: creds.email || ""
    });

    const timestamp = String(Math.floor(Date.now() / 1000));
    const requestId = randomUUID();

    const payloadJson = JSON.stringify({
        version: "v1",
        requestId,
        info,
        cosyVersion: QODER_IDE_VERSION,
        ideVersion: ""
    });
    const payloadB64 = Buffer.from(payloadJson, "utf8").toString("base64");

    const sigPath = computeSigPath(requestUrl);
    const sigInput = `${payloadB64}\n${cosyKey}\n${timestamp}\n${bodyBuf.toString("latin1")}\n${sigPath}`;
    const sig = md5Hex(Buffer.from(sigInput, "latin1"));

    const machineId = creds.machineId || randomUUID();
    const bodyHash = md5Hex(bodyBuf);
    const bodyLength = String(bodyBuf.length);

    return {
        Authorization: `Bearer COSY.${payloadB64}.${sig}`,
        "Cosy-Key": cosyKey,
        "Cosy-User": creds.userId,
        "Cosy-Date": timestamp,
        "Cosy-Version": QODER_IDE_VERSION,
        "Cosy-Machineid": machineId,
        "Cosy-Machinetoken": machineId,
        "Cosy-Machinetype": QODER_MACHINE_TYPE,
        "Cosy-Machineos": QODER_MACHINE_OS,
        "Cosy-Clienttype": QODER_CLIENT_TYPE,
        "Cosy-Clientip": "127.0.0.1",
        "Cosy-Bodyhash": bodyHash,
        "Cosy-Bodylength": bodyLength,
        "Cosy-Sigpath": sigPath,
        "Cosy-Data-Policy": QODER_DATA_POLICY,
        "Cosy-Organization-Id": "",
        "Cosy-Organization-Tags": "",
        "Login-Version": QODER_LOGIN_VERSION,
        "X-Request-Id": randomUUID()
    };
}

// ─── PAT Exchange Cache & Helpers ───

const patJobCache = new Map<string, { accessToken: string; userId: string; expiresAt: number }>();
const PAT_REFRESH_BUFFER_MS = 5 * 60 * 1000;
const PAT_DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

export function isQoderPat(token?: string): boolean {
    return typeof token === "string" && token.startsWith("pt-");
}

export async function exchangeJobToken(
    pat: string
): Promise<{ jobToken: string; expiresAt: number }> {
    const res = await fetch(QODER_JOB_TOKEN_EXCHANGE_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            "User-Agent": "qodercli/1.0.0",
            "Cosy-Version": QODER_IDE_VERSION,
            "Cosy-ClientType": QODER_CLIENT_TYPE
        },
        body: JSON.stringify({ personal_token: pat })
    });

    if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Qoder PAT exchange failed: ${res.status} ${text.slice(0, 200)}`);
    }

    const data = (await res.json()) as {
        token?: string;
        expires_at?: string;
        expires_in?: number;
    };
    if (!data.token) throw new Error("Qoder PAT exchange returned no job token");

    let expiresAt = Date.now() + PAT_DEFAULT_TTL_MS;
    if (data.expires_at) {
        const parsed = Date.parse(data.expires_at);
        if (!Number.isNaN(parsed)) expiresAt = parsed;
    } else if (typeof data.expires_in === "number" && data.expires_in > 0) {
        expiresAt = Date.now() + data.expires_in * 1000;
    }

    return { jobToken: data.token, expiresAt };
}

export async function fetchUserIdForJobToken(jobToken: string): Promise<string> {
    try {
        const res = await fetch(QODER_USERINFO_URL, {
            method: "GET",
            headers: {
                Authorization: `Bearer ${jobToken}`,
                Accept: "application/json",
                "User-Agent": "qodercli/1.0.0"
            }
        });
        if (!res.ok) return "";
        const data = (await res.json()) as { id?: string; userId?: string; user_id?: string };
        return data.id || data.userId || data.user_id || "";
    } catch {
        return "";
    }
}

export async function resolvePatCredential(
    pat: string
): Promise<{ accessToken: string; userId: string; expiresAt: number }> {
    const cached = patJobCache.get(pat);
    if (cached && cached.expiresAt - Date.now() > PAT_REFRESH_BUFFER_MS) {
        return cached;
    }

    const { jobToken, expiresAt } = await exchangeJobToken(pat);
    const userId = await fetchUserIdForJobToken(jobToken);
    const resolved = { accessToken: jobToken, userId, expiresAt };
    patJobCache.set(pat, resolved);
    return resolved;
}

function extractText(content: unknown): string {
    if (typeof content === "string") return content;
    if (content == null) return "";
    if (Array.isArray(content)) {
        const parts: string[] = [];
        for (const item of content) {
            if (item && typeof item === "object") {
                if ("text" in item && typeof (item as { text?: unknown }).text === "string") {
                    parts.push((item as { text: string }).text);
                }
            }
        }
        return parts.join("\n");
    }
    return String(content);
}

function normalizeMessages(messages: ChatCompletionRequest["messages"]): {
    messages: unknown[];
    systemText: string;
} {
    if (!Array.isArray(messages) || messages.length === 0) {
        return { messages: [], systemText: "" };
    }
    const systemParts: string[] = [];
    const out: unknown[] = [];
    for (const msg of messages) {
        if (!msg || typeof msg !== "object") continue;
        const text = extractText(msg.content);
        if (msg.role === "system") {
            if (text) systemParts.push(text);
            continue;
        }
        out.push({ ...msg, content: text });
    }
    return { messages: out, systemText: systemParts.join("\n\n") };
}

function lastUserText(messages: unknown[]): string {
    for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i] as { role?: string; content?: string } | undefined;
        if (m?.role === "user" && typeof m.content === "string") {
            return m.content;
        }
    }
    return "";
}

function stableHash(prefix: string, ...parts: unknown[]): string {
    const h = crypto.createHash("sha256");
    h.update(prefix);
    for (const p of parts) {
        h.update("\0");
        h.update(String(p ?? ""));
    }
    return h.digest("hex").slice(0, 16);
}

// ─── Qoder Executor Class ───

export class QoderExecutor implements AIProvider {
    id: string;
    name: string;
    category?: "oauth" = "oauth";
    protocol?: "openai" = "openai";

    private baseUrl: string;
    private apiKey: string;
    private accessToken: string;
    private refreshToken?: string;
    private providerSpecificData: QoderProviderSpecificData;
    private rawConfigs: Map<string, Record<string, unknown>> = new Map();

    constructor(options: QoderExecutorOptions = {}) {
        this.id = options.id ?? "qoder";
        this.name = options.name ?? "Qoder Provider";
        this.baseUrl = options.baseUrl ?? "";
        this.apiKey = options.apiKey ?? "";
        this.accessToken = options.accessToken ?? "";
        this.refreshToken = options.refreshToken;
        this.providerSpecificData = options.providerSpecificData ?? {};
    }

    updateToken(accessToken: string, refreshToken?: string): void {
        if (accessToken) this.accessToken = accessToken;
        if (refreshToken) this.refreshToken = refreshToken;
    }

    private async resolveCredentials(): Promise<{
        accessToken: string;
        userId: string;
        machineId: string;
        name: string;
        email: string;
        isJobToken: boolean;
    }> {
        const rawToken = this.accessToken || this.apiKey;
        let activeToken = rawToken;
        let userId = this.providerSpecificData.userId || "";
        const machineId = this.providerSpecificData.machineId || randomUUID();
        const name = this.providerSpecificData.name || "";
        const email = this.providerSpecificData.email || "";

        let isJobToken = activeToken.startsWith("jt-");

        if (isQoderPat(rawToken)) {
            const resolved = await resolvePatCredential(rawToken);
            activeToken = resolved.accessToken;
            if (!userId) userId = resolved.userId;
            isJobToken = true;
        }

        if (!userId && activeToken) {
            userId = await fetchUserIdForJobToken(activeToken);
            if (userId) this.providerSpecificData.userId = userId;
        }

        if (!userId) {
            // Default fallback userId if none resolved
            userId = stableHash("qoder-user", activeToken);
        }

        return {
            accessToken: activeToken,
            userId,
            machineId,
            name,
            email,
            isJobToken
        };
    }

    private getInferenceUrl(isJobToken: boolean): string {
        if (this.baseUrl) {
            const url = this.baseUrl.replace(/\/$/, "");
            return url.includes("?") ? `${url}&Encode=1` : `${url}?Encode=1`;
        }
        const host = isJobToken ? QODER_CHAT_BASE_ALT : QODER_CHAT_BASE;
        return `${host}/algo${QODER_CHAT_SIG_PATH}?FetchKeys=llm_model_result&AgentId=agent_common&Encode=1`;
    }

    private getModelListUrl(isJobToken: boolean): string {
        const host = isJobToken ? QODER_CHAT_BASE_ALT : QODER_CHAT_BASE;
        return `${host}/algo/api/v2/model/list`;
    }

    async listModels(): Promise<ModelObject[]> {
        const baseId = this.id.split("_")[0]?.split("-")[0] ?? this.id;
        const modelMap = new Map<string, ModelObject>();

        // 1. Add all standard known Qoder models as base catalog
        for (const def of QODER_MODELS) {
            modelMap.set(`${baseId}/${def.id}`, {
                id: `${baseId}/${def.id}`,
                object: "model",
                owned_by: baseId
            });
        }

        // 2. Fetch dynamic models from upstream if credentials are valid
        try {
            const creds = await this.resolveCredentials();
            if (creds.accessToken) {
                const url = this.getModelListUrl(creds.isJobToken);
                const headers = {
                    Accept: "application/json",
                    "Accept-Encoding": "identity",
                    ...buildCosyHeaders(Buffer.alloc(0), url, {
                        userId: creds.userId,
                        authToken: creds.accessToken,
                        name: creds.name,
                        email: creds.email,
                        machineId: creds.machineId
                    })
                };

                const res = await fetch(url, { method: "GET", headers });
                if (res.ok) {
                    const data = (await res.json()) as { chat?: Array<Record<string, unknown>> };
                    if (data.chat && Array.isArray(data.chat)) {
                        for (const item of data.chat) {
                            const key = item.key as string | undefined;
                            if (!key) continue;
                            this.rawConfigs.set(key, item);
                            modelMap.set(`${baseId}/${key}`, {
                                id: `${baseId}/${key}`,
                                object: "model",
                                owned_by: baseId
                            });
                        }
                    }
                }
            }
        } catch {
            // fallback to static models
        }

        return Array.from(modelMap.values());
    }

    private stripModelPrefix(model: string): string {
        const slash = model.indexOf("/");
        return slash >= 0 ? model.slice(slash + 1) : model;
    }

    private async buildPayload(
        req: ChatCompletionRequest,
        creds: { userId: string; machineId: string }
    ): Promise<{
        qoderKey: string;
        payload: Record<string, unknown>;
        modelConfig: Record<string, unknown>;
    }> {
        const rawKey = this.stripModelPrefix(req.model);
        const mappedKey = QODER_MODEL_ALIASES[rawKey.toLowerCase()] || rawKey;
        const qoderKey = this.rawConfigs.has(rawKey) ? rawKey : mappedKey;
        let modelConfig = this.rawConfigs.get(qoderKey);
        if (!modelConfig) {
            modelConfig = {
                key: qoderKey,
                is_reasoning:
                    qoderKey.includes("reasoning") ||
                    qoderKey.includes("preview") ||
                    qoderKey === "ultimate" ||
                    qoderKey.includes("model"),
                source: "system"
            };
        }

        const { messages, systemText } = normalizeMessages(req.messages || []);
        const isReasoning = !!modelConfig.is_reasoning;
        const maxOutputTokens = Number(modelConfig.max_output_tokens) || 0;

        let maxTokens = 32_768;
        if (maxOutputTokens > 0) maxTokens = maxOutputTokens;
        if (
            typeof req.max_tokens === "number" &&
            req.max_tokens > 0 &&
            req.max_tokens < maxTokens
        ) {
            maxTokens = req.max_tokens;
        }

        const lastUser = lastUserText(messages);
        const sessionId = stableHash("qoder-session", creds.userId, qoderKey);
        const recordId = stableHash("qoder-record", qoderKey, req.messages?.length || 0, maxTokens);

        const payload: Record<string, unknown> = {
            request_id: randomUUID(),
            request_set_id: recordId,
            chat_record_id: recordId,
            session_id: sessionId,
            stream: true,
            chat_task: "FREE_INPUT",
            is_reply: true,
            is_retry: false,
            source: 1,
            version: "3",
            session_type: "qodercli",
            agent_id: "agent_common",
            task_id: "common",
            code_language: "",
            chat_prompt: "",
            image_urls: null,
            aliyun_user_type: "",
            system: systemText,
            messages,
            tools: Array.isArray(req.tools) ? req.tools : [],
            ...(req.tool_choice ? { tool_choice: req.tool_choice } : {}),
            parameters: { max_tokens: maxTokens },
            chat_context: {
                chatPrompt: "",
                imageUrls: null,
                extra: {
                    context: [],
                    modelConfig: { key: qoderKey, is_reasoning: isReasoning },
                    originalContent: lastUser
                },
                features: [],
                text: lastUser
            },
            model_config: modelConfig,
            business: {
                product: "cli",
                version: "1.0.0",
                type: "agent",
                stage: "start",
                id: randomUUID(),
                name: lastUser.slice(0, 30),
                begin_at: Date.now()
            }
        };

        sanitizeQwenThinkingToolChoice(payload, isReasoning);

        return { qoderKey, payload, modelConfig };
    }

    async *chatCompletionStream(
        req: ChatCompletionRequest
    ): AsyncGenerator<ChatCompletionChunk, void, void> {
        const creds = await this.resolveCredentials();
        if (!creds.accessToken) {
            throw new Error("Qoder provider error: missing access token or PAT");
        }

        const url = this.getInferenceUrl(creds.isJobToken);
        const { qoderKey, payload, modelConfig } = await this.buildPayload(req, creds);

        const plainBody = Buffer.from(JSON.stringify(payload), "utf8");
        const encodedBodyStr = qoderEncodeBody(plainBody);
        const encodedBodyBuf = Buffer.from(encodedBodyStr, "latin1");

        const cosyHeaders = buildCosyHeaders(encodedBodyBuf, url, {
            userId: creds.userId,
            authToken: creds.accessToken,
            name: creds.name,
            email: creds.email,
            machineId: creds.machineId
        });

        const headers = {
            "Content-Type": "application/json",
            Accept: "text/event-stream",
            "Cache-Control": "no-cache",
            "X-Model-Key": qoderKey,
            "X-Model-Source": (modelConfig.source as string) || "system",
            "Accept-Encoding": "identity",
            ...cosyHeaders
        };

        const res = await fetch(url, {
            method: "POST",
            headers,
            body: encodedBodyBuf
        });

        if (!res.ok) {
            const errorText = await res.text();
            throw new Error(`Qoder Provider Stream Error (${res.status}): ${errorText}`);
        }

        if (!res.body) {
            throw new Error("No response body received from Qoder stream");
        }

        for await (const line of streamLines(res.body)) {
            const dataStr = parseDataLine(line);
            if (dataStr === null) continue;

            let envelope: { statusCodeValue?: number; body?: string };
            try {
                envelope = JSON.parse(dataStr) as { statusCodeValue?: number; body?: string };
            } catch {
                continue;
            }

            const statusVal = envelope.statusCodeValue ?? 200;
            const inner = envelope.body ?? "";

            if (statusVal !== 200) {
                let formattedMsg = inner || `upstream error (${statusVal})`;
                try {
                    const parsedErr = JSON.parse(inner) as { code?: string; message?: string };
                    if (parsedErr.code === "112") {
                        formattedMsg =
                            "Quota / plan limit reached (Code 112). Your Qoder account has exhausted its free quota or requires a subscription for this model (visit https://qoder.com/pricing).";
                    } else if (parsedErr.message) {
                        formattedMsg = parsedErr.message;
                    }
                } catch {
                    // Fall back to raw string
                }
                throw new Error(`Qoder upstream error ${statusVal}: ${formattedMsg}`);
            }

            if (!inner || inner === "[DONE]") {
                continue;
            }

            try {
                const chunk = JSON.parse(inner) as ChatCompletionChunk;
                yield chunk;
            } catch {
                // Ignore malformed inner JSON
            }
        }
    }

    async chatCompletion(req: ChatCompletionRequest): Promise<ChatCompletionResponse> {
        let content = "";
        let role = "assistant";
        let model = req.model;
        let id = `chatcmpl-${randomUUID()}`;
        const toolCalls: NonNullable<
            ChatCompletionResponse["choices"][number]["message"]["tool_calls"]
        > = [];

        for await (const chunk of this.chatCompletionStream(req)) {
            if (chunk.id) id = chunk.id;
            if (chunk.model) model = chunk.model;
            const choice = chunk.choices?.[0];
            if (!choice) continue;

            if (choice.delta?.role) {
                role = choice.delta.role;
            }
            if (choice.delta?.content) {
                content += choice.delta.content;
            }
            if (choice.delta?.tool_calls) {
                for (const tc of choice.delta.tool_calls) {
                    const idx = tc.index ?? 0;
                    if (!toolCalls[idx]) {
                        toolCalls[idx] = {
                            id: tc.id || `call_${randomUUID()}`,
                            type: "function",
                            function: {
                                name: tc.function?.name || "",
                                arguments: tc.function?.arguments || ""
                            }
                        };
                    } else {
                        if (tc.function?.name) {
                            toolCalls[idx].function.name += tc.function.name;
                        }
                        if (tc.function?.arguments) {
                            toolCalls[idx].function.arguments += tc.function.arguments;
                        }
                    }
                }
            }
        }

        return {
            id,
            object: "chat.completion",
            created: Math.floor(Date.now() / 1000),
            model,
            choices: [
                {
                    index: 0,
                    message: {
                        role: role as "assistant",
                        content: content || null,
                        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {})
                    },
                    finish_reason: toolCalls.length > 0 ? "tool_calls" : "stop"
                }
            ]
        };
    }
}
