import { Hono } from "hono";
import { adminAuthStore, type AdminAuthStore } from "@srouter/db";
import { AdminController } from "@/controllers/admin.controller.js";
import type { Context } from "hono";

export interface AdminRouteOptions {
    store?: AdminAuthStore;
    getClientAddress?: (c: Context) => string | undefined;
    now?: () => number;
    secureCookies?: boolean;
}

export function CreateAdminRoute(Options: AdminRouteOptions = {}): Hono {
    const Store = Options.store ?? adminAuthStore;
    const GetClientAddress = Options.getClientAddress ?? AdminController.GetDirectClientAddress;
    const Now = Options.now ?? (() => Date.now());
    const SecureCookies = Options.secureCookies ?? process.env.SROUTER_SECURE_COOKIES === "true";
    const FailedLogins = new Map<string, { count: number; blockedUntil: number }>();
    const Route = new Hono();

    Route.get("/admin/status", (c) => AdminController.GetStatus(c, Store, Now));
    Route.post("/admin/setup", (c) => AdminController.Setup(c, Store, Now, SecureCookies));
    Route.post("/admin/login", (c) =>
        AdminController.Login(c, FailedLogins, Store, Now, GetClientAddress, SecureCookies)
    );
    Route.post("/admin/change-password", (c) => AdminController.ChangePassword(c, Store, Now));
    Route.post("/admin/logout", (c) => AdminController.Logout(c, Store, Now, SecureCookies));

    return Route;
}

export const createAdminRoute = CreateAdminRoute;
export const adminRoute = CreateAdminRoute();
