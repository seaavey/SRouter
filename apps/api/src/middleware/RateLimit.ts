import type { Context, MiddlewareHandler } from "hono";
import type { APIKeyZod } from "@srouter/types";
import { Err } from "@/utils/response.js";

const WINDOW_MS = 60_000;
const MAX_TRACKED_KEYS = 10_000;

interface WindowEntry {
    count: number;
    resetAt: number;
}

export interface RateLimitOptions {
    now?: () => number;
    windows?: Map<string, WindowEntry>;
    getClientAddress?: (c: Context) => string | undefined;
}

/**
 * Fixed-window rate limiter keyed by API key id + client address.
 * `rate_limit` is requests per minute; 0 (default) means unlimited.
 * Must run after ApiKeyAuth so `apiKeyRow` is populated.
 */
export function CreateRateLimitMiddleware(Options: RateLimitOptions = {}): MiddlewareHandler {
    const Now = Options.now ?? (() => Date.now());
    const Windows = Options.windows ?? new Map<string, WindowEntry>();
    const GetAddress = Options.getClientAddress ?? (() => undefined);

    return async (c, next) => {
        const ApiKeyRow = c.get("apiKeyRow") as APIKeyZod | undefined;
        const Limit = ApiKeyRow?.rate_limit ?? 0;
        if (!ApiKeyRow || Limit <= 0) return next();

        const Timestamp = Now();
        if (Windows.size > MAX_TRACKED_KEYS) {
            for (const [Key, Entry] of Windows) {
                if (Entry.resetAt <= Timestamp) Windows.delete(Key);
            }
        }

        const WindowKey = `${ApiKeyRow.id}:${GetAddress(c) ?? "unknown"}`;
        const Entry = Windows.get(WindowKey);

        if (!Entry || Entry.resetAt <= Timestamp) {
            Windows.set(WindowKey, { count: 1, resetAt: Timestamp + WINDOW_MS });
            return next();
        }

        Entry.count += 1;
        if (Entry.count > Limit) {
            const RetryAfterSec = Math.max(1, Math.ceil((Entry.resetAt - Timestamp) / 1000));
            c.header("Retry-After", String(RetryAfterSec));
            return Err(
                c,
                `Rate limit exceeded: this API key allows ${Limit} request${Limit === 1 ? "" : "s"} per minute.`,
                429,
                { code: "rate_limit_exceeded" }
            );
        }

        return next();
    };
}

export const EnforceRateLimit = CreateRateLimitMiddleware();
