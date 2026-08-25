import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { afterEach, test } from "node:test";
import { Hono } from "hono";
import { AdminAuthStore } from "../../../packages/db/src/adminAuth.js";
import { setRequireApiKeyDB } from "@srouter/db";
import { ADMIN_SESSION_COOKIE, createAdminSession } from "../src/services/adminAuth.js";
import { CreateAdminAuthMiddleware } from "../src/middleware/adminAuth.js";
import { createApiKeyAuth } from "../src/middleware/apiKeyAuth.js";

afterEach(() => {
    setRequireApiKeyDB(false);
});

test("admin middleware requires a valid session cookie", async () => {
    const store = new AdminAuthStore(new DatabaseSync(":memory:"));
    store.createAdminAccount("hash");
    const app = new Hono();
    app.use("/*", CreateAdminAuthMiddleware({ store }));
    app.get("/providers", (c) => c.json({ ok: true }));

    const rejected = await app.request("/providers");
    assert.equal(rejected.status, 401);

    const token = createAdminSession(store);
    const accepted = await app.request("/providers", {
        headers: { Cookie: `${ADMIN_SESSION_COOKIE}=${token}` }
    });
    assert.equal(accepted.status, 200);
});

test("client-identifying headers do not bypass API-key auth", async () => {
    setRequireApiKeyDB(true);
    const store = new AdminAuthStore(new DatabaseSync(":memory:"));
    store.createAdminAccount("hash");
    const app = new Hono();
    app.use("/*", createApiKeyAuth({ store }));
    app.post("/chat/completions", (c) => c.json({ ok: true }));

    const spoofed = await app.request("/chat/completions", {
        method: "POST",
        headers: { "X-SRouter-Client": "playground" }
    });
    assert.equal(spoofed.status, 401);

    const token = createAdminSession(store);
    const adminRequest = await app.request("/chat/completions", {
        method: "POST",
        headers: { Cookie: `${ADMIN_SESSION_COOKIE}=${token}` }
    });
    assert.equal(adminRequest.status, 200);
});
