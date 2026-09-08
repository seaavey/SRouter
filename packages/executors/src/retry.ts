// Shared retry/backoff helpers for upstream providers with transient errors.
import type { RequestAttemptBudget } from "@srouter/types";

const MAX_RETRY_AFTER_MS = 10000;
const TRANSIENT_RETRY_MAX_MS = 15000;

const TRANSIENT_ERROR_PATTERNS = [
    /high\s+traffic/i,
    /overloaded/i,
    /concurrency/i,
    /agent\s+(execution\s+)?terminated\s+due\s+to\s+error/i,
    /capacity/i,
    /temporarily\s+unavailable/i,
    /timeout/i,
    /stream\s+(ended|closed|terminated|interrupted)/i,
    /empty\s+response/i
];

const TRANSIENT_STATUSES = new Set([500, 502, 503, 504]);

function parseRetryAfter(value: string): number | null {
    const seconds = parseInt(value, 10);
    if (!isNaN(seconds) && seconds > 0) return seconds * 1000;

    const date = new Date(value);
    if (!isNaN(date.getTime())) {
        const diff = date.getTime() - Date.now();
        return diff > 0 ? diff : null;
    }
    return null;
}

function parseRetryHeaders(headers: Headers): number | null {
    const retryAfter = headers.get("retry-after");
    if (retryAfter) {
        const ms = parseRetryAfter(retryAfter);
        if (ms !== null) return ms;
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

function parseRetryFromErrorMessage(errorMessage: string): number | null {
    if (!errorMessage || typeof errorMessage !== "string") return null;
    const match = errorMessage.match(/reset after (\d+h)?(\d+m)?(\d+s)?/i);
    if (!match) return null;
    let totalMs = 0;
    if (match[1]) totalMs += parseInt(match[1]) * 3600 * 1000;
    if (match[2]) totalMs += parseInt(match[2]) * 60 * 1000;
    if (match[3]) totalMs += parseInt(match[3]) * 1000;
    return totalMs > 0 ? totalMs : null;
}

function extractErrorMessage(errorJson: unknown, bodyText = ""): string {
    const parts: string[] = [];
    const err = errorJson as { error?: { message?: unknown }; message?: unknown } | null;
    if (err?.error?.message) parts.push(String(err.error.message));
    if (err?.message) parts.push(String(err.message));
    if (err?.error)
        parts.push(typeof err.error === "string" ? err.error : JSON.stringify(err.error));
    if (bodyText) parts.push(bodyText);
    return parts.filter(Boolean).join("\n");
}

function isTransientError(status: number, message: string): boolean {
    if (status === 429) return true;
    if (TRANSIENT_STATUSES.has(status)) return true;
    return TRANSIENT_ERROR_PATTERNS.some((pattern) => pattern.test(message || ""));
}

/**
 * Compute a retry delay (ms) for a failed upstream response, or null when the
 * error is not retryable. Honors Retry-After-style headers first, then the error
 * message, then falls back to capped exponential backoff.
 */
export async function computeRetryDelay(
    response: Response,
    attempt: number
): Promise<number | null> {
    let bodyText = "";
    let errorJson: unknown = null;
    let retryMs = parseRetryHeaders(response.headers);

    try {
        bodyText = await response.clone().text();
        errorJson = bodyText ? JSON.parse(bodyText) : null;
    } catch {
        // ignore parse errors
    }

    const errorMessage = extractErrorMessage(errorJson, bodyText);

    if (!retryMs) {
        retryMs = parseRetryFromErrorMessage(errorMessage);
    }
    if (retryMs) return retryMs <= MAX_RETRY_AFTER_MS ? retryMs : null;

    if (!isTransientError(response.status, errorMessage)) return null;

    const cap = response.status === 429 ? MAX_RETRY_AFTER_MS : TRANSIENT_RETRY_MAX_MS;
    return Math.min(1000 * 2 ** attempt, cap);
}

/**
 * POST JSON to `url` with `headers`, retrying transient failures up to `maxAttempts`.
 * The final attempt's response is returned as-is.
 */
export async function fetchWithRetry(
    url: string,
    body: Record<string, unknown>,
    headers: Record<string, string>,
    maxAttempts = 3,
    budget?: RequestAttemptBudget
): Promise<Response> {
    let lastResponse: Response | undefined;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        if (budget && budget.remaining <= 0) {
            return (
                lastResponse ??
                new Response(null, { status: 503, statusText: "Retry budget exhausted" })
            );
        }
        budget?.consume();
        const res = await fetch(url, {
            method: "POST",
            headers,
            body: JSON.stringify(body)
        });
        lastResponse = res;

        if (res.ok) return res;

        const retryMs = await computeRetryDelay(res, attempt);
        if (!retryMs) return res;

        await new Promise((r) => setTimeout(r, retryMs));
    }
    return (
        lastResponse ?? new Response(null, { status: 503, statusText: "Retry attempts exhausted" })
    );
}

export async function FetchWithBudget(
    input: string | URL,
    init: RequestInit,
    budget?: RequestAttemptBudget
): Promise<Response> {
    budget?.consume();
    return fetch(input, init);
}
