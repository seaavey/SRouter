import type { Context, MiddlewareHandler, Next } from "hono";
import { getCookie } from "hono/cookie";
import { adminAuthStore, type AdminAuthStore } from "@srouter/db";
import { err } from "@/utils/response.js";
import { ADMIN_SESSION_COOKIE, verifyAdminSession } from "@/services/adminAuth.js";

export interface AdminAuthMiddlewareOptions {
    store?: AdminAuthStore;
    now?: () => number;
}

export function createAdminAuthMiddleware(
    options: AdminAuthMiddlewareOptions = {}
): MiddlewareHandler {
    const store = options.store ?? adminAuthStore;
    const now = options.now ?? (() => Date.now());

    return async (c: Context, next: Next) => {
        const sessionToken = getCookie(c, ADMIN_SESSION_COOKIE);
        if (!verifyAdminSession(store, sessionToken, now())) {
            return err(c, "Admin authentication is required", 401, {
                type: "authentication_error",
                code: "authentication_required"
            });
        }

        c.set("authType", "admin_session");
        return next();
    };
}

export const requireAdmin = createAdminAuthMiddleware();
export const adminAuth = requireAdmin;
