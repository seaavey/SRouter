import type { FreebuffError, FreebuffErrorCode, FreebuffErrorDetails } from "./types.js";

const MAX_BODY_LENGTH = 2048;
const SENSITIVE_HEADER = /^(authorization|proxy-authorization|cookie|set-cookie)$/i;
const SECRET_PATTERN = /\b(?:sk-[A-Za-z0-9_-]+|freebuff-[A-Za-z0-9_-]+|Bearer\s+[A-Za-z0-9._~-]+)\b/gi;

type ErrorCause = Error | undefined;
type HeaderInput = Readonly<Record<string, string>>;
type MutableFreebuffErrorDetails = {
    -readonly [Key in keyof FreebuffErrorDetails]: FreebuffErrorDetails[Key];
};

function safeBody(body: string): string {
    return body.replace(SECRET_PATTERN, "[redacted]").slice(0, MAX_BODY_LENGTH);
}

function safeHeaders(headers: HeaderInput): Readonly<Record<string, string>> {
    const result: Record<string, string> = {};
    for (const [name, value] of Object.entries(headers)) {
        if (!SENSITIVE_HEADER.test(name)) result[name.toLowerCase()] = safeBody(value);
    }
    return result;
}

function parseJson(body: string): Record<string, string | number> {
    try {
        const parsed = JSON.parse(body) as Record<string, string | number | boolean | null>;
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
        const result: Record<string, string | number> = {};
        for (const [key, value] of Object.entries(parsed)) {
            if (typeof value === "string" || typeof value === "number") result[key] = value;
        }
        return result;
    } catch {
        return {};
    }
}

function numberValue(payload: Record<string, string | number>, keys: readonly string[]): number | undefined {
    for (const key of keys) {
        const value = payload[key];
        if (typeof value === "number" && Number.isFinite(value)) return value;
        if (typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value)) return Number(value);
    }
    return undefined;
}

export class FreebuffUpstreamError extends Error implements FreebuffError {
    readonly name = "FreebuffError" as const;
    readonly code: FreebuffErrorCode;
    readonly status: number;
    readonly details: FreebuffErrorDetails;

    constructor(code: FreebuffErrorCode, status: number, details: FreebuffErrorDetails, cause?: ErrorCause) {
        super(`FreeBuff upstream error (${status}): ${code}${details.body ? ` — ${details.body}` : ""}`, { cause });
        this.code = code;
        this.status = status;
        this.details = details;
    }

    is(code: FreebuffErrorCode): boolean {
        return this.code === code;
    }

    get body(): string {
        return this.details.body;
    }
}

export class FreebuffAuthError extends FreebuffUpstreamError {
    constructor(status: number, details: FreebuffErrorDetails, cause?: ErrorCause) { super("AUTH_REJECTED", status, details, cause); }
}

export class FreebuffRateLimitError extends FreebuffUpstreamError {
    readonly retryAfterSeconds: number | undefined;
    readonly resetAt: number | undefined;
    constructor(status: number, details: FreebuffErrorDetails, cause?: ErrorCause) {
        super("RATE_LIMITED", status, details, cause);
        this.retryAfterSeconds = details.retryAfterSeconds;
        this.resetAt = details.resetAt;
    }
}

export function parseUpstreamError(status: number, body: string, headers: HeaderInput, cause?: Error): FreebuffError {
    const payload = parseJson(body);
    const text = `${body} ${Object.values(payload).join(" ")}`.toLowerCase();
    const details: MutableFreebuffErrorDetails = {
        status,
        body: safeBody(body),
        headers: safeHeaders(headers),
        retryAfterSeconds: numberValue(payload, ["retryAfter", "retry_after"]),
        resetAt: numberValue(payload, ["resetAt", "reset_at"]),
        resumesAt: numberValue(payload, ["resumesAt", "resumes_at"]),
        position: numberValue(payload, ["position", "queuePosition"]),
    };
    const retryHeader = headers["retry-after"] ?? headers["Retry-After"];
    if (details.retryAfterSeconds === undefined && retryHeader !== undefined && /^\d+(?:\.\d+)?$/.test(retryHeader)) {
        details.retryAfterSeconds = Number(retryHeader);
    }
    const resetHeader = headers["x-ratelimit-reset"] ?? headers["X-RateLimit-Reset"];
    if (details.resetAt === undefined && resetHeader !== undefined && /^\d+$/.test(resetHeader)) details.resetAt = Number(resetHeader) * 1000;

    if (status === 401) return new FreebuffAuthError(status, details, cause);
    if (status === 429) return new FreebuffRateLimitError(status, details, cause);
    if (status === 403 && /ban|suspend/.test(text)) return new FreebuffUpstreamError("BANNED", status, details, cause);
    if (status === 503 && /wait|queue|room/.test(text)) return new FreebuffUpstreamError("WAITING_ROOM", status, details, cause);
    if (/session[-_ ]?invalid/.test(text)) return new FreebuffUpstreamError("SESSION_INVALID", status, details, cause);
    if (/run[-_ ]?invalid/.test(text)) return new FreebuffUpstreamError("RUN_INVALID", status, details, cause);
    return new FreebuffUpstreamError("UPSTREAM", status, details, cause);
}

export function isFreebuffError(error: Error, code?: FreebuffErrorCode): error is FreebuffError {
    return error instanceof FreebuffUpstreamError && (code === undefined || error.is(code));
}

export const FREEBUFF_MAX_ERROR_BODY_LENGTH = MAX_BODY_LENGTH;
