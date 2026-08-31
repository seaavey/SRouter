import { cors } from "hono/cors";
import type { MiddlewareHandler } from "hono";

const LOOPBACK_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

export function ParseAllowedOrigins(EnvValue = process.env.SROUTER_CORS_ORIGINS): Set<string> {
    return new Set(
        (EnvValue ?? "")
            .split(",")
            .map((Entry) => Entry.trim().replace(/\/+$/, ""))
            .filter(Boolean)
    );
}

/**
 * Returns the origin to echo back, or null when the origin is not allowed.
 * Requests without an Origin header (curl, server-to-server) never need
 * CORS headers, so they also return null.
 */
export function GetAllowedOrigin(
    Origin: string | undefined,
    Allowlist: Set<string>
): string | null {
    if (!Origin) return null;
    if (LOOPBACK_ORIGIN.test(Origin) || Allowlist.has(Origin)) return Origin;
    return null;
}

export function CreateCorsMiddleware(ExtraOrigins?: Set<string>): MiddlewareHandler {
    const Allowlist = ExtraOrigins ?? ParseAllowedOrigins();

    return cors({
        origin: (Origin) => GetAllowedOrigin(Origin, Allowlist),
        allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allowHeaders: ["Content-Type", "Authorization", "x-api-key", "anthropic-version"],
        exposeHeaders: ["Content-Length", "X-Request-Id", "X-Version"],
        credentials: true
    });
}
