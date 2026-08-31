import { getCookie } from "hono/cookie";
import type { Context, MiddlewareHandler } from "hono";
import { Err } from "@/utils/response.js";
import { ADMIN_SESSION_COOKIE } from "@/services/adminAuth.js";
import { GetAllowedOrigin } from "@/middleware/Cors.js";

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * CSRF defense for cookie-based admin mutations. SameSite=Lax already blocks
 * cross-site POSTs from modern browsers; this adds an explicit Origin/Referer
 * check for same-site cross-subdomain requests. Requests without an admin
 * session cookie (plain API-key traffic) and non-browser clients (no Origin)
 * pass through untouched.
 */
export function CreateCsrfOriginGuard(Allowlist: Set<string>): MiddlewareHandler {
    return async (c: Context, next) => {
        if (!UNSAFE_METHODS.has(c.req.method)) return next();
        if (!getCookie(c, ADMIN_SESSION_COOKIE)) return next();

        const Origin = c.req.header("origin") || c.req.header("referer");
        if (!Origin) return next();

        let OriginUrl: URL | null = null;
        try {
            OriginUrl = new URL(Origin);
        } catch {
            OriginUrl = null;
        }
        if (!OriginUrl) {
            return Err(c, "Cross-origin admin mutation is not allowed", 403, {
                code: "csrf_origin_rejected"
            });
        }

        // Same-origin mutations are inherently CSRF-safe (the browser decides
        // the Origin header; an attacker page cannot forge its own origin).
        const RequestHost = new URL(c.req.url).host || c.req.header("host");
        if (OriginUrl.host === RequestHost) return next();

        if (!GetAllowedOrigin(OriginUrl.origin, Allowlist)) {
            return Err(c, "Cross-origin admin mutation is not allowed", 403, {
                code: "csrf_origin_rejected"
            });
        }

        return next();
    };
}
