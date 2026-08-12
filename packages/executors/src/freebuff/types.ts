export type FreebuffErrorCode =
    | "AUTH_REJECTED"
    | "RATE_LIMITED"
    | "BANNED"
    | "WAITING_ROOM"
    | "SESSION_INVALID"
    | "RUN_INVALID"
    | "UPSTREAM";

export interface FreebuffConnectionConfig {
    id: string;
    accessToken: string;
    baseUrl: string;
    enabled: boolean;
    instanceId?: string;
}

export interface FreebuffConfig {
    providerId: string;
    connections: readonly FreebuffConnectionConfig[];
    defaultBaseUrl: string;
    modelPrefix: "freebuff";
    sessionExpiryMarginMs: number;
    runLeaseMs: number;
}

export interface FreebuffModelRegistryState {
    models: Readonly<Record<string, string>>;
    fetchedAt: number;
    source: string;
    degraded: boolean;
}

export interface FreebuffLease {
    leaseId: string;
    connectionId: string;
    runId: string;
    acquiredAt: number;
    expiresAt: number;
    released: boolean;
}

export interface FreebuffErrorDetails {
    readonly status: number;
    readonly body: string;
    readonly headers: Readonly<Record<string, string>>;
    readonly retryAfterSeconds?: number;
    readonly resetAt?: number;
    readonly resumesAt?: number;
    readonly position?: number;
}

export interface FreebuffError extends Error {
    readonly name: "FreebuffError";
    readonly code: FreebuffErrorCode;
    readonly status: number;
    readonly details: FreebuffErrorDetails;
    is(code: FreebuffErrorCode): boolean;
}
