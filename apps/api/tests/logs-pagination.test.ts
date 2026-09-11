import test from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { LogsRouter } from "../src/routes/v1/logs.js";
import { logRequestDB } from "@srouter/db";

function createApp() {
    const app = new Hono();
    app.route("/v1", LogsRouter);
    return app;
}

test("GET /v1/logs supports server-side pagination with page and limit", async () => {
    const app = createApp();

    // Insert 5 dummy logs
    for (let i = 1; i <= 5; i++) {
        await logRequestDB({
            providerId: "test-prov",
            model: "test-model",
            promptTokens: 10 * i,
            completionTokens: 5 * i,
            totalTokens: 15 * i,
            statusCode: 200,
            latencyMs: 100 * i
        });
    }

    // Request page 1 with limit 2
    const res1 = await app.request("http://localhost/v1/logs?page=1&limit=2", {
        headers: { Authorization: "Bearer dev-test-key" }
    });
    assert.equal(res1.status, 200);
    const json1 = (await res1.json()) as any;
    assert.equal(json1.object, "list");
    assert.equal(json1.data.length, 2);
    assert.ok(json1.pagination);
    assert.equal(json1.pagination.page, 1);
    assert.equal(json1.pagination.limit, 2);
    assert.equal(json1.pagination.total >= 5, true);

    // Request page 2 with limit 2
    const res2 = await app.request("http://localhost/v1/logs?page=2&limit=2", {
        headers: { Authorization: "Bearer dev-test-key" }
    });
    assert.equal(res2.status, 200);
    const json2 = (await res2.json()) as any;
    assert.equal(json2.data.length, 2);
    assert.equal(json2.pagination.page, 2);
});
