import assert from "node:assert/strict";
import { test } from "node:test";
import { Hono } from "hono";
import { adminAuthStore } from "@srouter/db";
import { CreateCsrfOriginGuard } from "../src/middleware/CsrfOrigin.js";
import { ADMIN_SESSION_COOKIE, createAdminSession, revokeAdminSession } from "../src/services/adminAuth.js";

function createTestApp(Allowlist = new Set<string>()) {
    const app = new Hono();
    app.use("/v1/*", CreateCsrfOriginGuard(Allowlist));
    app.post("/v1/keys", (c) => c.json({ ok: true }));
    return app;
}

test("cookie mutation from a foreign origin is rejected even with a valid session", async () => {
    const app = createTestApp();
    const Token = createAdminSession(adminAuthStore);
    try {
        const res = await app.request("/v1/keys", {
            method: "POST",
            headers: {
                Cookie: `${ADMIN_SESSION_COOKIE}=${Token}`,
                Origin: "https://evil.example.com"
            }
        });
        assert.equal(res.status, 403);
        const body = (await res.json()) as { error: { code: string } };
        assert.equal(body.error.code, "csrf_origin_rejected");
    } finally {
        revokeAdminSession(adminAuthStore, Token);
    }
});

test("same-origin cookie mutation passes", async () => {
    const app = createTestApp();
    const Token = createAdminSession(adminAuthStore);
    try {
        const res = await app.request("http://gateway.local:3000/v1/keys", {
            method: "POST",
            headers: {
                Cookie: `${ADMIN_SESSION_COOKIE}=${Token}`,
                Origin: "http://gateway.local:3000"
            }
        });
        assert.equal(res.status, 200);
    } finally {
        revokeAdminSession(adminAuthStore, Token);
    }
});

test("cross-origin mutation from an allowlisted origin passes", async () => {
    const app = createTestApp(new Set(["https://dash.example.com"]));
    const Token = createAdminSession(adminAuthStore);
    try {
        const res = await app.request("http://gateway.local:3000/v1/keys", {
            method: "POST",
            headers: {
                Cookie: `${ADMIN_SESSION_COOKIE}=${Token}`,
                Origin: "https://dash.example.com"
            }
        });
        assert.equal(res.status, 200);
    } finally {
        revokeAdminSession(adminAuthStore, Token);
    }
});

test("API-key traffic without a session cookie is untouched", async () => {
    const app = createTestApp();
    const res = await app.request("/v1/keys", {
        method: "POST",
        headers: {
            Authorization: "***",
            Origin: "https://evil.example.com"
        }
    });
    assert.equal(res.status, 200);
});

test("GET requests are never blocked", async () => {
    const app = createTestApp();
    const res = await app.request("/v1/keys", {
        method: "GET",
        headers: { Origin: "https://evil.example.com" }
    });
    assert.equal(res.status, 404);
});
