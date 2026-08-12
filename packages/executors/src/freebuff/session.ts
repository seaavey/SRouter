import type {
    FreebuffRequestOptions,
    FreebuffSessionResponse,
    FreebuffUpstreamClientContract,
} from "./upstream.js";

export type FreebuffSessionStatus = "none" | "active" | "queued" | "disabled";

export interface FreebuffSessionLease {
    readonly instanceId?: string;
    readonly expiresAt?: number;
    readonly status: "active" | "disabled";
}

export interface FreebuffSessionSnapshot {
    readonly status: FreebuffSessionStatus;
    readonly instanceId?: string;
    readonly expiresAt?: number;
    readonly position?: number;
    readonly queueDepth?: number;
    readonly retryAt?: number;
}

export interface FreebuffSessionManagerOptions {
    readonly expiryMarginMs?: number;
    readonly minimumRetryMs?: number;
    readonly maxRefreshIterations?: number;
}

export class FreebuffWaitingRoomError extends Error {
    readonly name = "FreebuffWaitingRoomError" as const;
    readonly position: number | undefined;
    readonly queueDepth: number | undefined;
    readonly retryAt: number;
    readonly retryAfterMs: number;

    constructor(position: number | undefined, queueDepth: number | undefined, retryAt: number, retryAfterMs: number) {
        super("FreeBuff session is waiting in queue");
        this.position = position;
        this.queueDepth = queueDepth;
        this.retryAt = retryAt;
        this.retryAfterMs = retryAfterMs;
    }
}

interface SessionState {
    status: FreebuffSessionStatus;
    instanceId?: string;
    expiresAt?: number;
    position?: number;
    queueDepth?: number;
    retryAt?: number;
}

const DEFAULT_EXPIRY_MARGIN_MS = 5_000;
const DEFAULT_MINIMUM_RETRY_MS = 1_000;
const DEFAULT_MAX_REFRESH_ITERATIONS = 5;

function parseTimestamp(value: string | number | undefined): number | undefined {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value > 10_000_000_000 ? value : value * 1_000;
    }
    if (typeof value === "string") {
        const numeric = Number(value);
        if (Number.isFinite(numeric) && value.trim() !== "") return numeric > 10_000_000_000 ? numeric : numeric * 1_000;
        const parsed = Date.parse(value);
        return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
}

function activeState(response: FreebuffSessionResponse): SessionState {
    return {
        status: "active",
        instanceId: response.instanceId,
        expiresAt: parseTimestamp(response.expiresAt),
    };
}

export class FreebuffSessionManager {
    private readonly upstream: FreebuffUpstreamClientContract;
    private readonly expiryMarginMs: number;
    private readonly minimumRetryMs: number;
    private readonly maxRefreshIterations: number;
    private state: SessionState = { status: "none" };
    private refreshPromise: Promise<FreebuffSessionLease> | undefined;
    private generation = 0;

    constructor(upstream: FreebuffUpstreamClientContract, options: FreebuffSessionManagerOptions = {}) {
        this.upstream = upstream;
        this.expiryMarginMs = options.expiryMarginMs ?? DEFAULT_EXPIRY_MARGIN_MS;
        this.minimumRetryMs = options.minimumRetryMs ?? DEFAULT_MINIMUM_RETRY_MS;
        this.maxRefreshIterations = options.maxRefreshIterations ?? DEFAULT_MAX_REFRESH_ITERATIONS;
        if (!Number.isFinite(this.expiryMarginMs) || this.expiryMarginMs < 0) throw new TypeError("expiryMarginMs must be non-negative");
        if (!Number.isFinite(this.minimumRetryMs) || this.minimumRetryMs < 0) throw new TypeError("minimumRetryMs must be non-negative");
        if (!Number.isInteger(this.maxRefreshIterations) || this.maxRefreshIterations < 1) throw new TypeError("maxRefreshIterations must be positive");
    }

    async ensureSession(options?: FreebuffRequestOptions): Promise<FreebuffSessionLease> {
        const now = Date.now();
        if (this.state.status === "active" && (this.state.expiresAt === undefined || now < this.state.expiresAt - this.expiryMarginMs)) {
            return this.toLease(this.state);
        }
        if (this.state.status === "disabled") return { status: "disabled" };
        if (this.state.status === "queued" && this.state.retryAt !== undefined && now < this.state.retryAt) {
            throw this.waitingError(this.state);
        }
        if (this.refreshPromise !== undefined) return this.refreshPromise;
        const generation = this.generation;
        const refresh = this.refresh(options, generation);
        this.refreshPromise = refresh;
        try {
            return await refresh;
        } finally {
            if (this.refreshPromise === refresh) this.refreshPromise = undefined;
        }
    }

    invalidate(): void {
        this.generation += 1;
        this.state = { status: "none" };
    }

    async end(options?: FreebuffRequestOptions): Promise<void> {
        this.generation += 1;
        const instanceId = this.state.instanceId;
        this.state = { status: "none" };
        if (instanceId !== undefined) await this.upstream.endSession(instanceId, options);
    }

    snapshot(): FreebuffSessionSnapshot {
        return {
            status: this.state.status,
            instanceId: this.state.instanceId,
            expiresAt: this.state.expiresAt,
            position: this.state.position,
            queueDepth: this.state.queueDepth,
            retryAt: this.state.retryAt,
        };
    }

    private async refresh(options: FreebuffRequestOptions | undefined, generation: number): Promise<FreebuffSessionLease> {
        for (let attempt = 0; attempt < this.maxRefreshIterations; attempt += 1) {
            const response = await this.fetchState(options);
            if (generation !== this.generation) {
                if (response.instanceId !== undefined) await this.upstream.endSession(response.instanceId, options).catch(() => undefined);
                throw new Error("FreeBuff session refresh invalidated by lifecycle change");
            }
            const status = response.status ?? "active";
            if (status === "active" || status === "ready") {
                const next = activeState(response);
                if (generation === this.generation) this.state = next;
                return this.toLease(next);
            }
            if (status === "disabled") {
                const next: SessionState = { status: "disabled" };
                if (generation === this.generation) this.state = next;
                return { status: "disabled" };
            }
            if (status === "queued" || status === "waiting" || status === "waiting_room") {
                const retryAfter = Math.max(
                    this.minimumRetryMs,
                    Number.isFinite(response.estimatedWaitMs ?? Number.NaN) ? (response.estimatedWaitMs ?? 0) : 0,
                );
                const next: SessionState = {
                    status: "queued",
                    instanceId: response.instanceId,
                    position: response.position,
                    queueDepth: response.queueDepth,
                    retryAt: Date.now() + retryAfter,
                };
                if (generation === this.generation) this.state = next;
                throw this.waitingError(next);
            }
            if (status === "ended" || status === "superseded" || status === "none") {
                if (generation === this.generation) this.state = { status: "none" };
                continue;
            }
            throw new Error(`FreeBuff session returned unsupported status: ${status}`);
        }
        throw new Error("FreeBuff session refresh limit exceeded");
    }

    private async fetchState(options?: FreebuffRequestOptions): Promise<FreebuffSessionResponse> {
        if (this.state.status === "queued" && this.state.instanceId !== undefined) {
            return this.upstream.getSession(this.state.instanceId, options);
        }
        return this.upstream.createSession(options);
    }

    private waitingError(state: SessionState): FreebuffWaitingRoomError {
        const retryAt = state.retryAt ?? Date.now() + this.minimumRetryMs;
        return new FreebuffWaitingRoomError(state.position, state.queueDepth, retryAt, Math.max(0, retryAt - Date.now()));
    }

    private toLease(state: SessionState): FreebuffSessionLease {
        return {
            status: state.status === "disabled" ? "disabled" : "active",
            ...(state.instanceId === undefined ? {} : { instanceId: state.instanceId }),
            ...(state.expiresAt === undefined ? {} : { expiresAt: state.expiresAt }),
        };
    }
}
