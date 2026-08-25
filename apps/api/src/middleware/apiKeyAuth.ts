import type { Context, Next } from "hono";
import { getCookie } from "hono/cookie";
import { getConnInfo } from "@hono/node-server/conninfo";
import {
    adminAuthStore,
    getAPIKeyByKeyDB,
    getRequireApiKeyDB,
    type AdminAuthStore
} from "@srouter/db";
import { err } from "@/utils/response.js";
import {
    ADMIN_SESSION_COOKIE,
    isLoopbackAddress,
    verifyAdminSession
} from "@/services/adminAuth.js";

export interface ApiKeyAuthOptions {
    store?: AdminAuthStore;
    now?: () => number;
    getClientAddress?: (c: Context) => string | undefined;
}

function getDirectClientAddress(c: Context): string | undefined {
    try {
        const addr = getConnInfo(c).remote.address;
        if (addr) return addr;
    } catch {
        // Fallback when request is invoked via Hono in-memory app.request()
    }

    // If running in test / in-memory environment where conninfo is not available,
    // infer from URL hostname
    try {
        const url = new URL(c.req.url);
        if (
            url.hostname === "localhost" ||
            url.hostname === "127.0.0.1" ||
            url.hostname === "[::1]"
        ) {
            return "127.0.0.1";
        }
    } catch {}

    return undefined;
}

export function createApiKeyAuth(options: ApiKeyAuthOptions = {}) {
    const store = options.store ?? adminAuthStore;
    const now = options.now ?? (() => Date.now());
    const getClientAddress = options.getClientAddress ?? getDirectClientAddress;

    return async function apiKeyAuth(c: Context, next: Next) {
        if (verifyAdminSession(store, getCookie(c, ADMIN_SESSION_COOKIE), now())) {
            c.set("authType", "admin_session");
            return await next();
        }

        const clientAddress = getClientAddress(c);
        const isLoopback = isLoopbackAddress(clientAddress);
        // If requireApiKey is true in DB OR request comes from non-localhost (public network)
        const isRequired = getRequireApiKeyDB() || !isLoopback;
        const authHeader = c.req.header("Authorization") || c.req.header("authorization");
        const xApiKey =
            c.req.header("x-api-key") || c.req.header("X-Api-Key") || c.req.header("X-API-KEY");

        let bearerKey: string | null = null;
        if (xApiKey) {
            bearerKey = xApiKey.trim();
        } else if (authHeader && authHeader.startsWith("Bearer ")) {
            bearerKey = authHeader.slice(7).trim();
        } else if (authHeader) {
            bearerKey = authHeader.trim();
        }

        if (bearerKey) {
            const apiKeyRow = getAPIKeyByKeyDB(bearerKey);
            if (apiKeyRow) {
                if (!apiKeyRow.enabled) {
                    return err(c, "The provided SRouter API Key is disabled", 401, {
                        type: "invalid_request_error",
                        code: "api_key_disabled"
                    });
                }
                c.set("apiKeyRow", apiKeyRow);
                c.set("authType", "api_key");
                return await next();
            }

            // If a key was provided but not found in DB
            if (isRequired) {
                return err(c, "Invalid SRouter API Key", 401, {
                    type: "invalid_request_error",
                    code: "invalid_api_key"
                });
            }
        }

        if (isRequired) {
            return err(
                c,
                !isLoopback
                    ? "Remote/public requests require a valid SRouter API Key. Please provide your key via 'Authorization: Bearer <API_KEY>' or 'x-api-key'."
                    : "Missing SRouter API Key. Please provide a valid key via 'Authorization: Bearer ***' header or disable 'Require API Key' in Settings.",
                401,
                {
                    type: "invalid_request_error",
                    code: "missing_api_key"
                }
            );
        }

        return await next();
    };
}

export const apiKeyAuth = createApiKeyAuth();
