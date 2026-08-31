import assert from "node:assert/strict";
import { test } from "node:test";
import { Hono } from "hono";
import { adminAuthStore } from "@srouter/db";
import { TunnelRouter } from "../src/routes/v1/tunnel.js";
import {
    ADMIN_SESSION_COOKIE,
    createAdminSession,
    revokeAdminSession
} from "../src/services/adminAuth.js";

function createTestApp() {
    const app = new Hono();
    // Same mount shape as index.ts: the guard must travel with the router.
    app.route("/v1", TunnelRouter);
    return app;
}

const TUNNEL_ROUTES: { method: string; path: string }[] = [
    { method: "GET", path: "/v1/tunnel/status" },
    { method: "GET", path: "/v1/tunnel/events" },
    { method: "GET", path: "/v1/tunnel/install" },
    { method: "POST", path: "/v1/tunnel/start" },
    { method: "POST", path: "/v1/tunnel/stop" },
    { method: "PUT", path: "/v1/tunnel/config" },
    { method: "POST", path: "/v1/tunnel/install" }
];

test("every tunnel endpoint rejects anonymous requests with 401", async () => {
    const app = createTestApp();

    for (const { method, path } of TUNNEL_ROUTES) {
        const res = await app.request(path, { method });
        assert.equal(res.status, 401, `${method} ${path} should be 401, got ${res.status}`);
        const body = (await res.json()) as { error: { code: string } };
        assert.equal(body.error.code, "authentication_required", `${method} ${path}`);
    }
});

test("tunnel endpoints reject API-key-only requests with 401", async () => {
    const app = createTestApp();

    const res = await app.request("/v1/tunnel/status", {
        headers: { Authorization: "***" }
    });
    assert.equal(res.status, 401);
});

test("tunnel status is readable with a valid admin session", async () => {
    const app = createTestApp();
    const Token = createAdminSession(adminAuthStore);
    try {
        const res = await app.request("/v1/tunnel/status", {
            headers: { Cookie: `${ADMIN_SESSION_COOKIE}=${Token}` }
        });
        assert.equal(res.status, 200);
        const body = (await res.json()) as { ok: boolean; running: boolean };
        assert.equal(typeof body.running, "boolean");
    } finally {
        revokeAdminSession(adminAuthStore, Token);
    }
});
