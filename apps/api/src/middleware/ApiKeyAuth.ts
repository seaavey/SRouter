import type { Context, Next } from "hono";
import { getCookie } from "hono/cookie";
import { getConnInfo } from "@hono/node-server/conninfo";
import {
    adminAuthStore,
    getAPIKeyByKeyDB,
    getRequireApiKeyDB,
    type AdminAuthStore
} from "@srouter/db";
import { Err } from "@/utils/response.js";
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

function GetDirectClientAddress(c: Context): string | undefined {
    try {
        const Addr = getConnInfo(c).remote.address;
        if (Addr) return Addr;
    } catch {}

    try {
        const Url = new URL(c.req.url);
        if (
            Url.hostname === "localhost" ||
            Url.hostname === "127.0.0.1" ||
            Url.hostname === "[::1]"
        ) {
            return "127.0.0.1";
        }
    } catch {}

    return undefined;
}

export function CreateApiKeyAuth(Options: ApiKeyAuthOptions = {}) {
    const Store = Options.store ?? adminAuthStore;
    const Now = Options.now ?? (() => Date.now());
    const GetClientAddress = Options.getClientAddress ?? GetDirectClientAddress;

    return async function ApiKeyAuthMiddleware(c: Context, next: Next) {
        if (verifyAdminSession(Store, getCookie(c, ADMIN_SESSION_COOKIE), Now())) {
            c.set("authType", "admin_session");
            return await next();
        }

        const ClientAddress = GetClientAddress(c);
        const IsLoopback = isLoopbackAddress(ClientAddress);
        const IsRequired = getRequireApiKeyDB() || !IsLoopback;
        const AuthHeader = c.req.header("Authorization") || c.req.header("authorization");
        const XApiKey =
            c.req.header("x-api-key") || c.req.header("X-Api-Key") || c.req.header("X-API-KEY");

        let BearerKey: string | null = null;
        if (XApiKey) {
            BearerKey = XApiKey.trim();
        } else if (AuthHeader && AuthHeader.startsWith("Bearer ")) {
            BearerKey = AuthHeader.slice(7).trim();
        } else if (AuthHeader) {
            BearerKey = AuthHeader.trim();
        }

        if (BearerKey) {
            const ApiKeyRow = getAPIKeyByKeyDB(BearerKey);
            if (ApiKeyRow) {
                if (!ApiKeyRow.enabled) {
                    return Err(c, "The provided SRouter API Key is disabled", 401, {
                        type: "invalid_request_error",
                        code: "api_key_disabled"
                    });
                }

                if (ApiKeyRow.credit_limit > 0 && ApiKeyRow.usage_cost >= ApiKeyRow.credit_limit) {
                    return Err(
                        c,
                        "Insufficient credit balance. Your credit limit has been reached.",
                        402,
                        {
                            type: "insufficient_quota",
                            code: "insufficient_credit"
                        }
                    );
                }

                if (ApiKeyRow.quota_limit > 0 && ApiKeyRow.usage_tokens >= ApiKeyRow.quota_limit) {
                    return Err(
                        c,
                        "Token quota exceeded. Your lifetime token limit has been reached.",
                        429,
                        {
                            type: "insufficient_quota",
                            code: "quota_exceeded"
                        }
                    );
                }

                c.set("apiKeyRow", ApiKeyRow);
                c.set("authType", "api_key");
                return await next();
            }

            if (IsRequired) {
                return Err(c, "Invalid SRouter API Key", 401, {
                    type: "invalid_request_error",
                    code: "invalid_api_key"
                });
            }
        }

        if (IsRequired) {
            return Err(
                c,
                !IsLoopback
                    ? "Remote/public requests require a valid SRouter API Key. Please provide your key via 'Authorization: Bearer ***' or 'x-api-key'."
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

export const ApiKeyAuth = CreateApiKeyAuth();
