import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { Hono } from "hono";
import { createAPIKeyDB, deleteAPIKeyDB } from "@srouter/db";
import { CreateRateLimitMiddleware } from "../src/middleware/RateLimit.js";
import type { APIKeyZod } from "@srouter/types";

const createdKeyIds: string[] = [];

afterEach(() => {
    for (const id of createdKeyIds.splice(0)) {
        deleteAPIKeyDB(id);
    }
});

function createTestApp(Row: Partial<APIKeyZod> | undefined, now: () => number = () => Date.now()) {
    const app = new Hono();
    app.use("/*", async (c, next) => {
        if (Row) c.set("apiKeyRow" as never, Row as never);
        await next();
    });
    app.use(
        "/*",
        CreateRateLimitMiddleware({ now, getClientAddress: () => "203.0.113.7" })
    );
    app.post("/chat/completions", (c) => c.json({ ok: true }));
    return app;
}

test("rate_limit=0 means unlimited", async () => {
    const app = createTestApp({ id: "k1", rate_limit: 0 } as APIKeyZod);
    for (let i = 0; i < 5; i++) {
        const res = await app.request("/chat/completions", { method: "POST" });
        assert.equal(res.status, 200);
    }
});

test("requests beyond the per-minute limit get 429 with Retry-After", async () => {
    const created = createAPIKeyDB({ name: "Rate Limit Test", rateLimit: 3 });
    createdKeyIds.push(created.id);

    const app = createTestApp({ id: created.id, rate_limit: 3 } as APIKeyZod);

    for (let i = 0; i < 3; i++) {
        const res = await app.request("/chat/completions", { method: "POST" });
        assert.equal(res.status, 200, `request ${i + 1} should pass`);
    }

    const blocked = await app.request("/chat/completions", { method: "POST" });
    assert.equal(blocked.status, 429);
    assert.ok(blocked.headers.get("retry-after"));
    const body = (await blocked.json()) as { error: { code: string; type: string } };
    assert.equal(body.error.code, "rate_limit_exceeded");
    assert.equal(body.error.type, "rate_limit_error");
});

test("window resets after the limit period", async () => {
    let Current = 1_000_000;
    const app = createTestApp({ id: "k2", rate_limit: 1 } as APIKeyZod, () => Current);

    assert.equal((await app.request("/chat/completions", { method: "POST" })).status, 200);
    assert.equal((await app.request("/chat/completions", { method: "POST" })).status, 429);

    Current += 60_001;
    assert.equal((await app.request("/chat/completions", { method: "POST" })).status, 200);
});

test("unauthenticated requests (no apiKeyRow) are not rate limited", async () => {
    const app = createTestApp(undefined);
    for (let i = 0; i < 5; i++) {
        assert.equal((await app.request("/chat/completions", { method: "POST" })).status, 200);
    }
});
