import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { Hono } from "hono";
import { createAPIKeyDB, deleteAPIKeyDB, incrementAPIKeyUsageDB } from "@srouter/db";
import { ApiKeyAuth } from "@/middleware/ApiKeyAuth.js";

const createdIds: string[] = [];

afterEach(() => {
    for (const id of createdIds.splice(0)) {
        deleteAPIKeyDB(id);
    }
});

function createTestApp() {
    const app = new Hono();
    app.post("/test", ApiKeyAuth, (c) => c.json({ ok: true }));
    return app;
}

test("ApiKeyAuth rejects request with 402 when credit balance is exhausted", async () => {
    const key = createAPIKeyDB({
        name: "Exhausted Credit Key",
        creditLimit: 5.0
    });
    createdIds.push(key.id);

    // Increment cost to exceed creditLimit
    incrementAPIKeyUsageDB(key.id, 100, 5.01);

    const app = createTestApp();
    const res = await app.request("/test", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${key.key}`
        }
    });

    assert.equal(res.status, 402);
    const body = (await res.json()) as { error: { message: string; type: string; code: string } };
    assert.equal(body.error.code, "insufficient_credit");
    assert.match(body.error.message, /credit/i);
});

test("ApiKeyAuth rejects request with 429 when token quota is exhausted", async () => {
    const key = createAPIKeyDB({
        name: "Exhausted Quota Key",
        quotaLimit: 1000
    });
    createdIds.push(key.id);

    // Increment tokens to exceed quotaLimit
    incrementAPIKeyUsageDB(key.id, 1005, 0);

    const app = createTestApp();
    const res = await app.request("/test", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${key.key}`
        }
    });

    assert.equal(res.status, 429);
    const body = (await res.json()) as { error: { message: string; code: string } };
    assert.equal(body.error.code, "quota_exceeded");
    assert.match(body.error.message, /quota/i);
});

test("ApiKeyAuth allows request when within credit and quota limits", async () => {
    const key = createAPIKeyDB({
        name: "Valid Key",
        creditLimit: 10.0,
        quotaLimit: 10000
    });
    createdIds.push(key.id);

    incrementAPIKeyUsageDB(key.id, 1000, 1.0);

    const app = createTestApp();
    const res = await app.request("/test", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${key.key}`
        }
    });

    assert.equal(res.status, 200);
});
