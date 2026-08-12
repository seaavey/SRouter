import { randomUUID } from "node:crypto";
import type {
    ChatCompletionChunk,
    ChatCompletionRequest,
    ChatCompletionResponse,
    FinishReason,
    ModelObject,
} from "@srouter/types";
import {
    accumulateChunk,
    createAccumulator,
    finishAccumulator,
    normalizeRequest,
    removeFreebuffModelPrefix,
    sanitizeSseLine,
    type FreebuffRequestInput,
    type FreebuffSanitizedChunk,
} from "./convert.js";
import { isFreebuffError } from "./errors.js";
import type { FreebuffError } from "./types.js";
import { FreebuffModelRegistry } from "./registry.js";
import { FreebuffRunManager, type FreebuffRunLease } from "./runs.js";
import { FreebuffSessionManager, type FreebuffSessionLease, FreebuffWaitingRoomError } from "./session.js";
import {
    createFreebuffTransport,
    FreebuffUpstreamClient,
    type FreebuffChatRequest,
    type FreebuffRequestOptions,
    type FreebuffTransportConfig,
    type FreebuffUpstreamClientContract,
} from "./upstream.js";
import type { FreebuffConnectionConfig } from "./types.js";

export interface FreebuffCoordinatorOptions {
    readonly registry?: FreebuffModelRegistry;
    readonly createUpstream?: (config: FreebuffConnectionConfig) => FreebuffUpstreamClientContract;
    readonly sessionExpiryMarginMs?: number;
    readonly runRotationIntervalMs?: number;
    readonly requestTimeoutMs?: number;
}

export interface FreebuffCoordinatorSnapshot {
    readonly connections: readonly FreebuffConnectionSnapshot[];
    readonly registry: ReturnType<FreebuffModelRegistry["snapshot"]>;
}

export interface FreebuffConnectionSnapshot {
    readonly id: string;
    readonly enabled: boolean;
    readonly cooldownUntil?: number;
    readonly session: ReturnType<FreebuffSessionManager["snapshot"]>;
    readonly runs: ReturnType<FreebuffRunManager["snapshot"]>;
}

interface RuntimeConnection {
    readonly config: FreebuffConnectionConfig;
    readonly upstream: FreebuffUpstreamClientContract;
    readonly session: FreebuffSessionManager;
    readonly runs: FreebuffRunManager;
    enabled: boolean;
    cooldownUntil: number;
}

const AUTH_COOLDOWN_MS = 30 * 60 * 1_000;
const DEFAULT_BASE_URL = "https://www.codebuff.com";

function requestInput(request: ChatCompletionRequest): FreebuffRequestInput {
    return JSON.parse(JSON.stringify(request)) as FreebuffRequestInput;
}

function upstreamRequest(request: ChatCompletionRequest): FreebuffChatRequest {
    const normalized = normalizeRequest(requestInput(request));
    return {
        ...normalized,
        model: removeFreebuffModelPrefix(normalized.model),
        messages: normalized.messages,
    };
}

function retryAfterMs(error: FreebuffError): number {
    const retrySeconds = error.details.retryAfterSeconds;
    if (retrySeconds !== undefined) return Math.max(0, retrySeconds * 1_000);
    const resetAt = error.details.resetAt;
    if (resetAt !== undefined) return Math.max(0, resetAt - Date.now());
    const resumesAt = error.details.resumesAt;
    if (resumesAt !== undefined) return Math.max(0, resumesAt - Date.now());
    return 0;
}

function publicFinishReason(reason: string | null): FinishReason {
    return reason === null || reason === "stop" || reason === "length" || reason === "tool_calls" || reason === "content_filter" ? reason : null;
}

async function* responseLines(body: ReadableStream<Uint8Array>): AsyncGenerator<string, void, void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
        while (true) {
            const item = await reader.read();
            if (item.done) break;
            buffer += decoder.decode(item.value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
            for (const line of lines) if (line.trim() !== "") yield line.trim();
        }
        buffer += decoder.decode();
        if (buffer.trim() !== "") yield buffer.trim();
    } finally {
        await reader.cancel().catch(() => undefined);
    }
}

export class FreebuffCoordinator {
    public readonly id = "freebuff";
    private readonly registry: FreebuffModelRegistry;
    private readonly createUpstream: (config: FreebuffConnectionConfig) => FreebuffUpstreamClientContract;
    private readonly sessionExpiryMarginMs: number | undefined;
    private readonly runRotationIntervalMs: number | undefined;
    private readonly requestTimeoutMs: number | undefined;
    private readonly connections = new Map<string, RuntimeConnection>();
    private cursor = 0;
    private started = false;

    public constructor(options: FreebuffCoordinatorOptions = {}) {
        this.registry = options.registry ?? new FreebuffModelRegistry();
        this.createUpstream = options.createUpstream ?? ((config) => {
            const transportConfig: FreebuffTransportConfig = {
                baseUrl: config.baseUrl || DEFAULT_BASE_URL,
                accessToken: config.accessToken,
                ...(this.requestTimeoutMs === undefined ? {} : { timeoutMs: this.requestTimeoutMs }),
            };
            return new FreebuffUpstreamClient(createFreebuffTransport(transportConfig));
        });
        this.sessionExpiryMarginMs = options.sessionExpiryMarginMs;
        this.runRotationIntervalMs = options.runRotationIntervalMs;
        this.requestTimeoutMs = options.requestTimeoutMs;
    }

    public register(config: FreebuffConnectionConfig): void {
        if (config.id.trim() === "") throw new TypeError("FreeBuff connection id must not be empty");
        if (config.accessToken.trim() === "") throw new TypeError("FreeBuff access token must not be empty");
        const previous = this.connections.get(config.id);
        if (previous !== undefined) void this.closeConnection(previous);
        const upstream = this.createUpstream(config);
        const session = new FreebuffSessionManager(upstream, {
            ...(this.sessionExpiryMarginMs === undefined ? {} : { expiryMarginMs: this.sessionExpiryMarginMs }),
        });
        const runs = new FreebuffRunManager(upstream, {
            ...(this.runRotationIntervalMs === undefined ? {} : { rotationIntervalMs: this.runRotationIntervalMs }),
        });
        this.connections.set(config.id, {
            config,
            upstream,
            session,
            runs,
            enabled: config.enabled,
            cooldownUntil: 0,
        });
    }

    /** Replace the runtime pool with the currently persisted enabled connections. */
    public replaceConnections(configs: readonly FreebuffConnectionConfig[]): void {
        const nextIds = new Set(configs.map((config) => config.id));
        for (const connectionId of this.connections.keys()) {
            if (!nextIds.has(connectionId)) void this.unregister(connectionId).catch(() => undefined);
        }
        for (const config of configs) this.register(config);
    }

    public async update(config: FreebuffConnectionConfig): Promise<void> {
        await this.unregister(config.id);
        this.register(config);
    }

    public updateToken(connectionId: string, accessToken: string): void {
        const current = this.connections.get(connectionId);
        if (current === undefined) return;
        this.register({ ...current.config, accessToken });
    }

    public async unregister(connectionId: string): Promise<void> {
        const current = this.connections.get(connectionId);
        if (current === undefined) return;
        this.connections.delete(connectionId);
        await this.closeConnection(current);
    }

    public setEnabled(connectionId: string, enabled: boolean): void {
        const current = this.connections.get(connectionId);
        if (current !== undefined) current.enabled = enabled;
    }

    public async listModels(): Promise<ModelObject[]> {
        try {
            await this.registry.refresh();
        } catch {
            // The registry intentionally retains its prior verified/degraded state.
        }
        return this.registry.models();
    }

    public async chatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
        const accumulator = createAccumulator();
        for await (const chunk of this.streamWithFailover(request)) {
            accumulateChunk(accumulator, chunk);
        }
        return finishAccumulator(accumulator, request.model);
    }

    public async *chatCompletionStream(request: ChatCompletionRequest): AsyncGenerator<ChatCompletionChunk, void, void> {
        for await (const chunk of this.streamWithFailover(request)) {
            yield {
                ...chunk,
                model: request.model,
                choices: chunk.choices.map((choice) => ({
                    ...choice,
                    finish_reason: publicFinishReason(choice.finish_reason),
                })),
            };
        }
    }

    private async *streamWithFailover(request: ChatCompletionRequest): AsyncGenerator<FreebuffSanitizedChunk, void, void> {
        const agentId = this.registry.agentForModel(request.model);
        if (agentId === null) throw new Error(`FreeBuff model is not available: ${request.model}`);
        const candidates = this.candidateConnections();
        if (candidates.length === 0) throw new Error("No enabled FreeBuff connections are available");
        let lastError: Error | undefined;
        let bestWaiting: FreebuffWaitingRoomError | undefined;
        for (const connection of candidates) {
            let emitted = false;
            try {
                for await (const chunk of this.streamFromConnection(connection, agentId, request)) {
                    emitted = true;
                    yield chunk;
                }
                return;
            } catch (error) {
                const caught = error instanceof Error ? error : new Error("FreeBuff request failed");
                lastError = caught;
                if (emitted) throw caught;
                if (caught instanceof FreebuffWaitingRoomError) {
                    if (bestWaiting === undefined || (caught.position ?? Number.MAX_SAFE_INTEGER) < (bestWaiting.position ?? Number.MAX_SAFE_INTEGER)) bestWaiting = caught;
                    continue;
                }
                if (isFreebuffError(caught, "SESSION_INVALID") || isFreebuffError(caught, "RUN_INVALID")) {
                    connection.session.invalidate();
                    connection.runs.invalidateRun(agentId);
                    try {
                        yield* this.streamFromConnection(connection, agentId, request);
                        return;
                    } catch (retryError) {
                        lastError = retryError instanceof Error ? retryError : new Error("FreeBuff retry failed");
                    }
                }
                this.applyCooldown(connection, caught);
            }
        }
        if (bestWaiting !== undefined) throw bestWaiting;
        throw lastError ?? new Error("All FreeBuff connections failed");
    }

    public async start(signal?: AbortSignal): Promise<void> {
        if (this.started) return;
        this.started = true;
        this.registry.start(signal);
    }

    public async shutdown(options: FreebuffRequestOptions = {}): Promise<void> {
        this.started = false;
        this.registry.stop();
        const current = [...this.connections.values()];
        this.connections.clear();
        await Promise.all(current.map((connection) => this.closeConnection(connection, options)));
    }

    public snapshot(): FreebuffCoordinatorSnapshot {
        return {
            connections: [...this.connections.values()].map((connection) => ({
                id: connection.config.id,
                enabled: connection.enabled,
                ...(connection.cooldownUntil > Date.now() ? { cooldownUntil: connection.cooldownUntil } : {}),
                session: connection.session.snapshot(),
                runs: connection.runs.snapshot(),
            })),
            registry: this.registry.snapshot(),
        };
    }

    private candidateConnections(): RuntimeConnection[] {
        const now = Date.now();
        const enabled = [...this.connections.values()].filter((connection) => connection.enabled && connection.cooldownUntil <= now);
        if (enabled.length === 0) return [];
        const offset = this.cursor % enabled.length;
        this.cursor += 1;
        return [...enabled.slice(offset), ...enabled.slice(0, offset)];
    }

    private async *streamFromConnection(connection: RuntimeConnection, agentId: string, request: ChatCompletionRequest): AsyncGenerator<FreebuffSanitizedChunk, void, void> {
        const session: FreebuffSessionLease = await connection.session.ensureSession({ timeoutMs: this.requestTimeoutMs });
        if (session.status !== "active") throw new Error("FreeBuff session is disabled");
        const run: FreebuffRunLease = await connection.runs.acquireRun(agentId, { timeoutMs: this.requestTimeoutMs });
        try {
            const response = await connection.upstream.chatCompletions(upstreamRequest(request), {
                model: removeFreebuffModelPrefix(request.model),
                runId: run.runId,
                clientId: randomUUID(),
                ...(session.instanceId === undefined ? {} : { instanceId: session.instanceId }),
                timeoutMs: this.requestTimeoutMs,
            });
            if (!response.body) throw new Error("FreeBuff response did not contain a stream body");
            for await (const line of responseLines(response.body)) {
                const chunk = sanitizeSseLine(line);
                if (chunk === null) continue;
                yield chunk;
            }
        } finally {
            connection.runs.releaseRun(run);
        }
    }

    private applyCooldown(connection: RuntimeConnection, error: Error): void {
        if (!isFreebuffError(error)) return;
        if (error.code === "AUTH_REJECTED") connection.cooldownUntil = Date.now() + AUTH_COOLDOWN_MS;
        else if (error.code === "RATE_LIMITED" || error.code === "BANNED") connection.cooldownUntil = Date.now() + retryAfterMs(error);
    }

    private async closeConnection(connection: RuntimeConnection, options: FreebuffRequestOptions = {}): Promise<void> {
        await connection.runs.shutdown(options).catch(() => undefined);
        await connection.session.end(options).catch(() => undefined);
    }
}
