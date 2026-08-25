import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { Hono } from "hono";
import {
    createAPIKeyDB,
    deleteAPIKeyDB,
    getRequireApiKeyDB,
    setRequireApiKeyDB
} from "@srouter/db";
import { ApiKeyAuth, CreateApiKeyAuth } from "../src/middleware/ApiKeyAuth.js";

const createdKeyIds: string[] = [];

afterEach(() => {
    // Reset require_api_key setting to false
    setRequireApiKeyDB(false);
    for (const id of createdKeyIds.splice(0)) {
        deleteAPIKeyDB(id);
    }
});

test("settings DB correctly gets and sets require_api_key toggle", () => {
    setRequireApiKeyDB(false);
    assert.equal(getRequireApiKeyDB(), false);

    setRequireApiKeyDB(true);
    assert.equal(getRequireApiKeyDB(), true);

    setRequireApiKeyDB(false);
    assert.equal(getRequireApiKeyDB(), false);
});

test("apiKeyAuth middleware rejects requests with 401 when require_api_key is true and no key is provided", async () => {
    setRequireApiKeyDB(true);

    const testApp = new Hono();
    testApp.use("/*", ApiKeyAuth);
    testApp.post("/chat/completions", (c) => c.json({ ok: true }));

    const res = await testApp.request("/chat/completions", {
        method: "POST"
    });

    assert.equal(res.status, 401);
    const body = (await res.json()) as { error: { message: string; code: string } };
    assert.equal(body.error.code, "missing_api_key");
});

test("apiKeyAuth middleware allows request when valid Bearer key is provided", async () => {
    setRequireApiKeyDB(true);

    const created = createAPIKeyDB({
        name: "Test Auth Key"
    });
    createdKeyIds.push(created.id);

    const testApp = new Hono();
    testApp.use("/*", ApiKeyAuth);
    testApp.post("/chat/completions", (c) => c.json({ ok: true }));

    const res = await testApp.request("/chat/completions", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${created.key}`
        }
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as { ok: boolean };
    assert.equal(body.ok, true);
});

test("apiKeyAuth middleware allows unauthenticated requests when require_api_key is false", async () => {
    setRequireApiKeyDB(false);

    const testApp = new Hono();
    testApp.use("/*", CreateApiKeyAuth({ getClientAddress: () => "127.0.0.1" }));
    testApp.post("/chat/completions", (c) => c.json({ ok: true }));

    const res = await testApp.request("/chat/completions", {
        method: "POST"
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as { ok: boolean };
    assert.equal(body.ok, true);
});

test("apiKeyAuth middleware rejects non-loopback requests when require_api_key is false and no key provided", async () => {
    setRequireApiKeyDB(false);

    const testApp = new Hono();
    testApp.use("/*", CreateApiKeyAuth({ getClientAddress: () => "192.168.1.50" }));
    testApp.post("/chat/completions", (c) => c.json({ ok: true }));

    const res = await testApp.request("/chat/completions", {
        method: "POST"
    });

    assert.equal(res.status, 401);
    const body = (await res.json()) as { error: { message: string; code: string } };
    assert.equal(body.error.code, "missing_api_key");
});

test("apiKeyAuth middleware accepts non-loopback requests with valid API key", async () => {
    setRequireApiKeyDB(false);

    const created = createAPIKeyDB({
        name: "Remote Auth Key"
    });
    createdKeyIds.push(created.id);

    const testApp = new Hono();
    testApp.use("/*", CreateApiKeyAuth({ getClientAddress: () => "192.168.1.50" }));
    testApp.post("/chat/completions", (c) => c.json({ ok: true }));

    const res = await testApp.request("/chat/completions", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${created.key}`
        }
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as { ok: boolean };
    assert.equal(body.ok, true);
});
