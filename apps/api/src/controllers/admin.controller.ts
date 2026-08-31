import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { adminAuthStore, type AdminAuthStore } from "@srouter/db";
import { Err, Ok } from "@/utils/response.js";
import { AdminChangePasswordSchema, AdminLoginSchema, AdminSetupSchema } from "@srouter/types";
import {
    ADMIN_SESSION_COOKIE,
    ADMIN_SESSION_TTL_MS,
    createAdminSession,
    hashAdminPassword,
    revokeAdminSession,
    validateAdminPassword,
    verifyAdminPassword,
    verifyAdminSession
} from "@/services/adminAuth.js";

const MAX_LOGIN_FAILURES = 5;
const LOGIN_BLOCK_MS = 15 * 60 * 1000;

export class AdminController {
    public static GetDirectClientAddress(c: Context): string | undefined {
        try {
            return getConnInfo(c).remote.address ?? undefined;
        } catch {
            return undefined;
        }
    }

    public static SetAdminSessionCookie(c: Context, Token: string, Secure: boolean): void {
        setCookie(c, ADMIN_SESSION_COOKIE, Token, {
            httpOnly: true,
            maxAge: Math.floor(ADMIN_SESSION_TTL_MS / 1000),
            path: "/",
            sameSite: "Lax",
            secure: Secure
        });
    }

    public static ClearAdminSessionCookie(c: Context, Secure: boolean): void {
        deleteCookie(c, ADMIN_SESSION_COOKIE, { path: "/", secure: Secure });
    }

    public static GetStatus(
        c: Context,
        Store: AdminAuthStore = adminAuthStore,
        Now: () => number = () => Date.now()
    ): Response {
        const Authenticated = verifyAdminSession(Store, getCookie(c, ADMIN_SESSION_COOKIE), Now());
        return Ok(c, {
            setupRequired: !Store.hasAdminAccount(),
            authenticated: Authenticated
        });
    }

    public static async Setup(
        c: Context,
        Store: AdminAuthStore = adminAuthStore,
        Now: () => number = () => Date.now(),
        SecureCookies = process.env.SROUTER_SECURE_COOKIES === "true"
    ): Promise<Response> {
        if (Store.hasAdminAccount()) {
            return Err(c, "Admin setup has already been completed", 409, {
                code: "setup_already_complete"
            });
        }

        const RawBody = await c.req.json().catch(() => null);
        const Parsed = AdminSetupSchema.safeParse(RawBody);
        if (!Parsed.success) {
            return Err(c, Parsed.error.issues[0]?.message || "Invalid setup payload", 400, {
                code: "invalid_password"
            });
        }

        const PasswordError = validateAdminPassword(Parsed.data.password);
        if (PasswordError) {
            return Err(c, PasswordError, 400, {
                code: "invalid_password"
            });
        }

        if (Parsed.data.confirmation !== Parsed.data.password) {
            return Err(c, "Password confirmation does not match", 400, {
                code: "password_mismatch"
            });
        }

        const Created = Store.createAdminAccount(hashAdminPassword(Parsed.data.password), Now());
        if (!Created) {
            return Err(c, "Admin setup has already been completed", 409, {
                code: "setup_already_complete"
            });
        }

        const SessionToken = createAdminSession(Store, Now());
        AdminController.SetAdminSessionCookie(c, SessionToken, SecureCookies);
        return Ok(c, { authenticated: true }, 201);
    }

    public static async Login(
        c: Context,
        FailedLogins: Map<string, { count: number; blockedUntil: number }>,
        Store: AdminAuthStore = adminAuthStore,
        Now: () => number = () => Date.now(),
        GetClientAddress: (
            c: Context
        ) => string | undefined = AdminController.GetDirectClientAddress,
        SecureCookies = process.env.SROUTER_SECURE_COOKIES === "true"
    ): Promise<Response> {
        const Address = GetClientAddress(c) ?? "unknown";
        const Timestamp = Now();
        const Failure = FailedLogins.get(Address);
        if (Failure && Failure.blockedUntil > Timestamp) {
            return Err(c, "Too many failed login attempts", 429, {
                code: "login_rate_limited"
            });
        }
        if (Failure && Failure.blockedUntil > 0 && Failure.blockedUntil <= Timestamp) {
            FailedLogins.delete(Address);
        }

        const RawBody = await c.req.json().catch(() => null);
        const Parsed = AdminLoginSchema.safeParse(RawBody);
        if (!Parsed.success) {
            return Err(c, "Invalid admin password", 401, {
                code: "invalid_credentials"
            });
        }

        const PasswordHash = Store.getPasswordHash();
        if (!PasswordHash || !verifyAdminPassword(Parsed.data.password, PasswordHash)) {
            const Current = FailedLogins.get(Address);
            const Count = (Current?.count ?? 0) + 1;
            FailedLogins.set(Address, {
                count: Count,
                blockedUntil: Count >= MAX_LOGIN_FAILURES ? Timestamp + LOGIN_BLOCK_MS : 0
            });
            return Err(c, "Invalid admin password", 401, {
                code: "invalid_credentials"
            });
        }

        FailedLogins.delete(Address);
        const SessionToken = createAdminSession(Store, Timestamp);
        AdminController.SetAdminSessionCookie(c, SessionToken, SecureCookies);
        return Ok(c, { authenticated: true });
    }

    public static async ChangePassword(
        c: Context,
        Store: AdminAuthStore = adminAuthStore,
        Now: () => number = () => Date.now()
    ): Promise<Response> {
        const SessionToken = getCookie(c, ADMIN_SESSION_COOKIE);
        if (!verifyAdminSession(Store, SessionToken, Now())) {
            return Err(c, "Admin authentication is required", 401, {
                code: "authentication_required"
            });
        }

        const RawBody = await c.req.json().catch(() => null);
        const Parsed = AdminChangePasswordSchema.safeParse(RawBody);
        if (!Parsed.success) {
            return Err(c, Parsed.error.issues[0]?.message || "Invalid payload", 400, {
                code: "invalid_password"
            });
        }

        const PasswordHash = Store.getPasswordHash();
        if (!PasswordHash || !verifyAdminPassword(Parsed.data.current_password, PasswordHash)) {
            return Err(c, "Current admin password is incorrect", 401, {
                code: "invalid_credentials"
            });
        }

        const PasswordError = validateAdminPassword(Parsed.data.new_password);
        if (PasswordError) {
            return Err(c, PasswordError, 400, {
                code: "invalid_password"
            });
        }

        if (Parsed.data.new_password !== Parsed.data.confirmation) {
            return Err(c, "New password confirmation does not match", 400, {
                code: "password_mismatch"
            });
        }

        const Updated = Store.updatePasswordHash(hashAdminPassword(Parsed.data.new_password), Now());
        if (!Updated) {
            return Err(c, "Failed to update admin password", 500, {
                code: "password_update_failed"
            });
        }

        return Ok(c, { message: "Admin password updated successfully" });
    }

    public static Logout(
        c: Context,
        Store: AdminAuthStore = adminAuthStore,
        Now: () => number = () => Date.now(),
        SecureCookies = process.env.SROUTER_SECURE_COOKIES === "true"
    ): Response {
        const SessionToken = getCookie(c, ADMIN_SESSION_COOKIE);
        if (!verifyAdminSession(Store, SessionToken, Now())) {
            AdminController.ClearAdminSessionCookie(c, SecureCookies);
            return Err(c, "Admin authentication is required", 401, {
                code: "authentication_required"
            });
        }

        revokeAdminSession(Store, SessionToken);
        AdminController.ClearAdminSessionCookie(c, SecureCookies);
        return c.body(null, 204);
    }
}
