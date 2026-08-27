import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createAPIKeyDB, deleteAPIKeyDB, getAPIKeyByKeyDB } from "@srouter/db";
import type { DBAPIKey } from "@srouter/types";
import { Hono } from "hono";
import { KeysRouter } from "@/routes/v1/keys.js";
import { createAdminSession, ADMIN_SESSION_COOKIE } from "@/services/adminAuth.js";

const createdIds: string[] = [];

afterEach(() => {
    for (const id of createdIds.splice(0)) {
        deleteAPIKeyDB(id);
    }
});

function createTestApp() {
    const app = new Hono();
    app.route("/v1", KeysRouter);
    return app;
}

test("POST /v1/keys creates key with creditLimit", async () => {
    const token = createAdminSession();
    const app = createTestApp();
    const res = await app.request("/v1/keys", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Cookie: `${ADMIN_SESSION_COOKIE}=${token}`
        },
        body: JSON.stringify({
            name: "Credit API Key",
            creditLimit: 25.5
        })
    });

    assert.equal(res.status, 201);
    const body = (await res.json()) as DBAPIKey;
    createdIds.push(body.id);
    assert.equal(body.creditLimit, 25.5);
    assert.equal(body.usageCost, 0);
});

test("POST /v1/keys/:id/credit adds credit to existing key", async () => {
    const token = createAdminSession();
    const key = createAPIKeyDB({
        name: "Topup Route Key",
        creditLimit: 10
    });
    createdIds.push(key.id);

    const app = createTestApp();
    const res = await app.request(`/v1/keys/${key.id}/credit`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Cookie: `${ADMIN_SESSION_COOKIE}=${token}`
        },
        body: JSON.stringify({ amount: 15 })
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as DBAPIKey;
    assert.equal(body.creditLimit, 25);

    const lookup = getAPIKeyByKeyDB(key.key);
    assert.equal(lookup?.creditLimit, 25);
});

test("POST /v1/keys/:id/credit rejects non-positive amount", async () => {
    const token = createAdminSession();
    const key = createAPIKeyDB({ name: "Validation Key" });
    createdIds.push(key.id);

    const app = createTestApp();
    const res = await app.request(`/v1/keys/${key.id}/credit`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Cookie: `${ADMIN_SESSION_COOKIE}=${token}`
        },
        body: JSON.stringify({ amount: -5 })
    });

    assert.equal(res.status, 400);
});
