import { nextBrowserHeaders, type BrowserHeaders } from "./profiles.js";
import { parseUpstreamError } from "./errors.js";

export interface FreebuffJsonObject {
    [key: string]: FreebuffJsonValue;
}

export type FreebuffJsonPrimitive = string | number | boolean | null;
export type FreebuffJsonValue = FreebuffJsonPrimitive | FreebuffJsonObject | FreebuffJsonValue[];

export interface FreebuffChatRequest extends FreebuffJsonObject {
    model: string;
    messages: FreebuffJsonObject[];
}

export interface FreebuffChatOptions {
    readonly model?: string;
    readonly runId: string;
    readonly clientId: string;
    readonly instanceId?: string;
}

export interface FreebuffEnvelopeMetadata {
    readonly run_id: string;
    readonly client_id: string;
    readonly freebuff_instance_id?: string;
}

export interface FreebuffUpstreamChatRequest extends FreebuffJsonObject {
    model: string;
    messages: FreebuffJsonObject[];
    stream: true;
    provider: FreebuffJsonObject;
    codebuff_metadata: FreebuffJsonObject;
    stop: FreebuffJsonValue;
}

export interface FreebuffSessionResponse {
    status?: string;
    instanceId?: string;
    expiresAt?: string | number;
    position?: number;
    queueDepth?: number;
    estimatedWaitMs?: number;
    pollAt?: string | number;
    accessTier?: string;
    countryCode?: string;
    countryBlockReason?: string;
}

export interface FreebuffTransportConfig {
    readonly baseUrl: string;
    readonly accessToken: string;
    readonly timeoutMs?: number;
    readonly maxErrorBodyBytes?: number;
    readonly maxRedirects?: number;
    readonly fetchImpl?: typeof fetch;
}

export interface FreebuffRequestOptions {
    readonly signal?: AbortSignal;
    readonly timeoutMs?: number;
}

export interface FreebuffTransportResponse {
    readonly response: Response;
}

export interface FreebuffTransport {
    readonly request: (path: string, init: RequestInit, options?: FreebuffRequestOptions) => Promise<FreebuffTransportResponse>;
}

export interface FreebuffUpstreamClientContract {
    createSession(options?: FreebuffRequestOptions): Promise<FreebuffSessionResponse>;
    getSession(instanceId: string, options?: FreebuffRequestOptions): Promise<FreebuffSessionResponse>;
    endSession(instanceId: string, options?: FreebuffRequestOptions): Promise<void>;
    startRun(agentId: string, options?: FreebuffRequestOptions): Promise<string>;
    finishRun(runId: string, totalSteps: number, options?: FreebuffRequestOptions): Promise<void>;
    chatCompletions(req: FreebuffChatRequest, options: FreebuffChatOptions & FreebuffRequestOptions): Promise<Response>;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_ERROR_BODY_BYTES = 8 * 1024;
const DEFAULT_MAX_REDIRECTS = 3;
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function objectValue(value: FreebuffJsonValue): FreebuffJsonObject {
    if (typeof value === "object" && value !== null && !Array.isArray(value)) return value;
    return {};
}

function cloneJsonValue(value: FreebuffJsonValue): FreebuffJsonValue {
    if (Array.isArray(value)) return value.map(cloneJsonValue);
    if (typeof value === "object" && value !== null) {
        const copy: FreebuffJsonObject = {};
        for (const [key, child] of Object.entries(value)) copy[key] = cloneJsonValue(child);
        return copy;
    }
    return value;
}

function isPlainObject(value: FreebuffJsonValue): value is FreebuffJsonObject {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function buildChatEnvelope(req: FreebuffChatRequest, options: FreebuffChatOptions): FreebuffUpstreamChatRequest {
    const envelope: FreebuffJsonObject = {};
    for (const [key, value] of Object.entries(req)) envelope[key] = cloneJsonValue(value);
    envelope.model = req.model;
    envelope.messages = req.messages.map(cloneJsonValue);
    envelope.codebuff_metadata = {
        run_id: options.runId,
        client_id: options.clientId,
        ...(options.instanceId === undefined ? {} : { freebuff_instance_id: options.instanceId }),
    };
    envelope.provider = { data_collection: "deny" };
    envelope.stream = true;
    if (envelope.stop === undefined) envelope.stop = ["cb_easp"];
    return envelope as FreebuffUpstreamChatRequest;
}

function joinUrl(baseUrl: string, path: string): string {
    return `${baseUrl.replace(/\/$/, "")}${path}`;
}

function validateBaseUrl(baseUrl: string): URL {
    const url = new URL(baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new TypeError("baseUrl must use http or https");
    return url;
}


function headerRecord(headers: Headers): Record<string, string> {
    const output: Record<string, string> = {};
    headers.forEach((value, key) => { output[key] = value; });
    return output;
}

function timeoutError(): Error {
    const error = new Error("FreeBuff upstream request timed out");
    error.name = "TimeoutError";
    return error;
}

function combineSignals(signal: AbortSignal | undefined, timeoutMs: number): { signal: AbortSignal; cleanup: () => void } {
    const controller = new AbortController();
    const abortFromCaller = (): void => controller.abort(signal?.reason);
    if (signal?.aborted) abortFromCaller();
    else signal?.addEventListener("abort", abortFromCaller, { once: true });
    const timer = setTimeout(() => controller.abort(timeoutError()), timeoutMs);
    const cleanup = (): void => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abortFromCaller);
    };
    return { signal: controller.signal, cleanup };
}

async function readBounded(response: Response, maxBytes: number): Promise<string> {
    if (!response.body) return "";
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
        while (total < maxBytes) {
            const item = await reader.read();
            if (item.done) break;
            const remaining = maxBytes - total;
            const chunk = item.value.byteLength > remaining ? item.value.slice(0, remaining) : item.value;
            chunks.push(chunk);
            total += chunk.byteLength;
            if (chunk.byteLength < item.value.byteLength) break;
        }
    } finally {
        await reader.cancel().catch(() => undefined);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return new TextDecoder().decode(bytes);
}

async function assertResponse(response: Response, maxErrorBodyBytes: number): Promise<void> {
    if (response.ok) return;
    const body = await readBounded(response, maxErrorBodyBytes);
    throw parseUpstreamError(response.status, body, headerRecord(response.headers));
}

function parseJsonObject(body: string, operation: string): FreebuffJsonObject {
    const parsed: FreebuffJsonValue = JSON.parse(body) as FreebuffJsonValue;
    if (!isPlainObject(parsed)) throw new Error(`FreeBuff ${operation} response must be a JSON object`);
    return parsed;
}

function responseBodyError(error: Error, signal: AbortSignal): Error {
    if (signal.aborted && error.name === "AbortError") {
        const reason = signal.reason;
        if (reason instanceof Error && reason.name === "TimeoutError") return reason;
    }
    return error;
}

function responseWithCleanup(response: Response, cleanup: () => void): Response {
    if (response.body === null) {
        cleanup();
        return response;
    }
    const reader = response.body.getReader();
    let released = false;
    const release = (): void => {
        if (released) return;
        released = true;
        cleanup();
    };
    const body = new ReadableStream<Uint8Array>({
        async pull(controller): Promise<void> {
            try {
                const item = await reader.read();
                if (item.done) {
                    controller.close();
                    release();
                } else {
                    controller.enqueue(item.value);
                }
            } catch (error) {
                release();
                controller.error(error);
            }
        },
        async cancel(): Promise<void> {
            try {
                await reader.cancel();
            } finally {
                release();
            }
        },
    });
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
}

export function createFreebuffTransport(config: FreebuffTransportConfig): FreebuffTransport {
    const base = validateBaseUrl(config.baseUrl);
    if (config.accessToken.trim() === "") throw new TypeError("accessToken must not be empty");
    const fetchImpl = config.fetchImpl ?? fetch;
    const defaultTimeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxErrorBodyBytes = config.maxErrorBodyBytes ?? DEFAULT_ERROR_BODY_BYTES;
    const maxRedirects = config.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
    if (!Number.isFinite(defaultTimeoutMs) || defaultTimeoutMs <= 0) throw new TypeError("timeoutMs must be positive");
    if (!Number.isInteger(maxRedirects) || maxRedirects < 0) throw new TypeError("maxRedirects must be a non-negative integer");
    if (!Number.isInteger(maxErrorBodyBytes) || maxErrorBodyBytes <= 0) throw new TypeError("maxErrorBodyBytes must be positive");

    const request = async (path: string, init: RequestInit, options: FreebuffRequestOptions = {}): Promise<FreebuffTransportResponse> => {
        const headers = new Headers(init.headers);
        headers.set("Authorization", `Bearer ${config.accessToken}`);
        headers.set("Content-Type", "application/json");
        const browserHeaders: BrowserHeaders = nextBrowserHeaders();
        for (const [name, value] of Object.entries(browserHeaders)) headers.set(name, value);
        const timeout = options.timeoutMs ?? defaultTimeoutMs;
        if (!Number.isFinite(timeout) || timeout <= 0) throw new TypeError("timeoutMs must be positive");
        const combined = combineSignals(options.signal, timeout);
        try {
            const response = await fetchImpl(joinUrl(base.toString().replace(/\/$/, ""), path), {
                ...init,
                headers,
                signal: combined.signal,
                redirect: "manual",
            });
            let current = response;
            for (let redirect = 0; redirect < maxRedirects && current.status >= 300 && current.status < 400; redirect += 1) {
                const location = current.headers.get("location");
                if (location === null) break;
                const method = init.method?.toUpperCase() ?? "GET";
                if (!SAFE_METHODS.has(method)) throw new Error(`FreeBuff redirect refused for ${method} ${path}`);
                const redirectUrl = new URL(location, current.url || base.toString());
                if (redirectUrl.origin !== base.origin) throw new Error(`FreeBuff cross-origin redirect refused for ${path}`);
                await current.body?.cancel();
                current = await fetchImpl(redirectUrl, { ...init, headers, signal: combined.signal, redirect: "manual" });
            }
            if (current.status >= 300 && current.status < 400) throw new Error(`FreeBuff redirect limit exceeded for ${path}`);
            return { response: responseWithCleanup(current, combined.cleanup) };
        } catch (error) {
            combined.cleanup();
            const caught = error instanceof Error ? error : new Error("FreeBuff transport failed");
            throw responseBodyError(caught, combined.signal);
        }
    };
    return { request };
}

export class FreebuffUpstreamClient implements FreebuffUpstreamClientContract {
    private readonly transport: FreebuffTransport;
    private readonly maxErrorBodyBytes: number;

    public constructor(transport: FreebuffTransport, maxErrorBodyBytes = DEFAULT_ERROR_BODY_BYTES) {
        this.transport = transport;
        this.maxErrorBodyBytes = maxErrorBodyBytes;
    }

    public async createSession(options?: FreebuffRequestOptions): Promise<FreebuffSessionResponse> {
        const result = await this.transport.request("/api/v1/freebuff/session", { method: "POST", body: "{}" }, options);
        await assertResponse(result.response, this.maxErrorBodyBytes);
        return parseJsonObject(await result.response.text(), "session") as FreebuffSessionResponse;
    }

    public async getSession(instanceId: string, options?: FreebuffRequestOptions): Promise<FreebuffSessionResponse> {
        const result = await this.transport.request("/api/v1/freebuff/session", { method: "GET", headers: { "x-freebuff-instance-id": instanceId } }, options);
        if (result.response.status === 404) return { status: "disabled" };
        await assertResponse(result.response, this.maxErrorBodyBytes);
        return parseJsonObject(await result.response.text(), "session") as FreebuffSessionResponse;
    }

    public async endSession(instanceId: string, options?: FreebuffRequestOptions): Promise<void> {
        const result = await this.transport.request("/api/v1/freebuff/session", { method: "DELETE", headers: { "x-freebuff-instance-id": instanceId } }, options);
        if (result.response.status === 404) return;
        await assertResponse(result.response, this.maxErrorBodyBytes);
    }

    public async startRun(agentId: string, options?: FreebuffRequestOptions): Promise<string> {
        const result = await this.transport.request("/api/v1/agent-runs", { method: "POST", body: JSON.stringify({ action: "START", agentId }) }, options);
        await assertResponse(result.response, this.maxErrorBodyBytes);
        const body = parseJsonObject(await result.response.text(), "START run");
        if (typeof body.runId !== "string" || body.runId === "") throw new Error("FreeBuff START response missing runId");
        return body.runId;
    }

    public async finishRun(runId: string, totalSteps: number, options?: FreebuffRequestOptions): Promise<void> {
        const result = await this.transport.request("/api/v1/agent-runs", { method: "POST", body: JSON.stringify({ action: "FINISH", runId, status: "completed", totalSteps, directCredits: 0, totalCredits: 0 }) }, options);
        await assertResponse(result.response, this.maxErrorBodyBytes);
    }

    public async chatCompletions(req: FreebuffChatRequest, options: FreebuffChatOptions & FreebuffRequestOptions): Promise<Response> {
        const body = buildChatEnvelope(req, options);
        const result = await this.transport.request("/api/v1/chat/completions", {
            method: "POST",
            headers: {
                Accept: "application/json, text/event-stream",
                "x-freebuff-model": options.model ?? req.model,
                ...(options.instanceId === undefined ? {} : { "x-freebuff-instance-id": options.instanceId }),
            },
            body: JSON.stringify(body),
        }, options);
        await assertResponse(result.response, this.maxErrorBodyBytes);
        return result.response;
    }
}
