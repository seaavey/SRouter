import { randomUUID } from "node:crypto";
import type { FreebuffRequestOptions, FreebuffUpstreamClientContract } from "./upstream.js";

export interface FreebuffRunLease {
    readonly leaseId: string;
    readonly agentId: string;
    readonly runId: string;
    readonly acquiredAt: number;
    readonly released: boolean;
}

export interface FreebuffRunSnapshot {
    readonly activeRuns: number;
    readonly activeLeases: number;
    readonly drainingRuns: number;
    readonly cooldownUntil?: number;
}

export interface FreebuffRunManagerOptions {
    readonly rotationIntervalMs?: number;
    readonly shutdownTimeoutMs?: number;
}

interface RunRecord {
    readonly agentId: string;
    readonly runId: string;
    readonly startedAt: number;
    requests: number;
    activeLeases: number;
}

const DEFAULT_ROTATION_INTERVAL_MS = 6 * 60 * 60 * 1_000;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000;

function positiveOrDefault(value: number | undefined, fallback: number): number {
    return value === undefined ? fallback : value > 0 && Number.isFinite(value) ? value : fallback;
}

export class FreebuffRunManager {
    private readonly upstream: FreebuffUpstreamClientContract;
    private readonly rotationIntervalMs: number;
    private readonly shutdownTimeoutMs: number;
    private readonly active = new Map<string, RunRecord>();
    private readonly draining = new Map<string, RunRecord>();
    private readonly starts = new Map<string, Promise<RunRecord>>();
    private readonly leases = new Map<string, RunRecord>();
    private readonly finishedRunIds = new Set<string>();
    private cooldownUntil = 0;
    private generation = 0;
    private shuttingDown = false;

    constructor(upstream: FreebuffUpstreamClientContract, options: FreebuffRunManagerOptions = {}) {
        this.upstream = upstream;
        this.rotationIntervalMs = positiveOrDefault(options.rotationIntervalMs, DEFAULT_ROTATION_INTERVAL_MS);
        this.shutdownTimeoutMs = positiveOrDefault(options.shutdownTimeoutMs, DEFAULT_SHUTDOWN_TIMEOUT_MS);
    }

    async acquireRun(agentId: string, options?: FreebuffRequestOptions): Promise<FreebuffRunLease> {
        if (agentId.trim() === "") throw new TypeError("agentId must not be empty");
        if (this.shuttingDown) throw new Error("FreeBuff run manager is shut down");
        this.assertAvailable();

        let current = this.active.get(agentId);
        if (current !== undefined && Date.now() - current.startedAt >= this.rotationIntervalMs) {
            this.active.delete(agentId);
            this.draining.set(current.runId, current);
            current = undefined;
        }

        if (current === undefined) {
            const generation = this.generation;
            let start = this.starts.get(agentId);
            if (start === undefined) {
                start = this.start(agentId, options);
                this.starts.set(agentId, start);
                void start.then(() => undefined, () => undefined).finally(() => {
                    if (this.starts.get(agentId) === start) this.starts.delete(agentId);
                });
            }
            current = await start;
            if (this.shuttingDown || generation !== this.generation) {
                await this.finishOnce(current, options);
                throw new Error("FreeBuff run manager shutdown invalidated START");
            }
            if (this.active.get(agentId) === undefined) this.active.set(agentId, current);
        }

        current.activeLeases += 1;
        current.requests += 1;
        const lease: FreebuffRunLease = {
            leaseId: randomUUID(),
            agentId,
            runId: current.runId,
            acquiredAt: Date.now(),
            released: false,
        };
        this.leases.set(lease.leaseId, current);
        return lease;
    }

    releaseRun(lease: FreebuffRunLease): void {
        const record = this.leases.get(lease.leaseId);
        if (record === undefined) return;
        this.leases.delete(lease.leaseId);
        if (record.activeLeases > 0) record.activeLeases -= 1;
        Object.assign(lease as { released: boolean }, { released: true });
        void this.finishReady().catch(() => undefined);
    }

    invalidateRun(agentId: string): void {
        const record = this.active.get(agentId);
        if (record !== undefined) {
            this.active.delete(agentId);
            this.draining.set(record.runId, record);
            void this.finishReady().catch(() => undefined);
        }
    }

    async maintain(options?: FreebuffRequestOptions): Promise<void> {
        const now = Date.now();
        for (const [agentId, record] of this.active) {
            if (now - record.startedAt >= this.rotationIntervalMs) {
                this.active.delete(agentId);
                this.draining.set(record.runId, record);
            }
        }
        await this.finishReady(options);
    }

    async prewarm(agentIds: readonly string[], options?: FreebuffRequestOptions): Promise<void> {
        for (const agentId of agentIds) {
            const lease = await this.acquireRun(agentId, options);
            this.releaseRun(lease);
        }
    }

    cooldown(durationMs: number): void {
        if (durationMs > 0 && Number.isFinite(durationMs)) this.cooldownUntil = Date.now() + durationMs;
    }

    clearCooldown(): void {
        this.cooldownUntil = 0;
    }

    async shutdown(options?: FreebuffRequestOptions): Promise<void> {
        if (this.shuttingDown) return;
        this.shuttingDown = true;
        this.generation += 1;
        const controller = new AbortController();
        const callerSignal = options?.signal;
        const abortCaller = (): void => controller.abort(callerSignal?.reason);
        if (callerSignal?.aborted) abortCaller();
        else callerSignal?.addEventListener("abort", abortCaller, { once: true });
        const timer = setTimeout(() => controller.abort(new Error("FreeBuff run shutdown timed out")), this.shutdownTimeoutMs);
        timer.unref();

        const records = [...this.active.values(), ...this.draining.values()];
        this.active.clear();
        this.draining.clear();
        this.leases.clear();
        try {
            await Promise.all(records.map((record) => this.finishOnce(record, { signal: controller.signal })));
            const pendingStarts = [...this.starts.values()];
            await Promise.allSettled(pendingStarts.map(async (start) => {
                try {
                    await this.finishOnce(await start, { signal: controller.signal });
                } catch {
                    // The corresponding acquire call receives the lifecycle error.
                }
            }));
        } finally {
            clearTimeout(timer);
            callerSignal?.removeEventListener("abort", abortCaller);
        }
    }

    snapshot(): FreebuffRunSnapshot {
        const snapshot: FreebuffRunSnapshot = {
            activeRuns: this.active.size,
            activeLeases: this.leases.size,
            drainingRuns: this.draining.size,
        };
        return this.cooldownUntil > Date.now() ? { ...snapshot, cooldownUntil: this.cooldownUntil } : snapshot;
    }

    private async start(agentId: string, options?: FreebuffRequestOptions): Promise<RunRecord> {
        const runId = await this.upstream.startRun(agentId, options);
        return { agentId, runId, startedAt: Date.now(), requests: 0, activeLeases: 0 };
    }

    private async finishReady(options?: FreebuffRequestOptions): Promise<void> {
        const ready: RunRecord[] = [];
        for (const [runId, record] of this.draining) {
            if (record.activeLeases === 0) {
                this.draining.delete(runId);
                ready.push(record);
            }
        }
        await Promise.all(ready.map(async (record) => {
            try {
                await this.finishOnce(record, options);
            } catch (error) {
                this.draining.set(record.runId, record);
                throw error;
            }
        }));
    }

    private async finishOnce(record: RunRecord, options?: FreebuffRequestOptions): Promise<void> {
        if (this.finishedRunIds.has(record.runId)) return;
        this.finishedRunIds.add(record.runId);
        try {
            await this.upstream.finishRun(record.runId, record.requests, options);
        } catch (error) {
            this.finishedRunIds.delete(record.runId);
            throw error;
        }
    }

    private assertAvailable(): void {
        if (this.cooldownUntil > Date.now()) throw new Error(`FreeBuff token cooldown active until ${this.cooldownUntil}`);
        if (this.cooldownUntil !== 0) this.cooldownUntil = 0;
    }
}
