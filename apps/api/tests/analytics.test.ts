import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createAPIKeyDB, db, deleteAPIKeyDB, logRequestDB } from "@srouter/db";
import { Hono } from "hono";
import { LogsRouter } from "@/routes/v1/logs.js";
import type { RequestLogEntry } from "@srouter/types";

const seededIds: string[] = [];
const seededKeyIds: string[] = [];

afterEach(() => {
    for (const id of seededIds.splice(0)) {
        const Delete = db.prepare("DELETE FROM request_logs WHERE id = ?");
        Delete.run(id);
    }
    for (const id of seededKeyIds.splice(0)) {
        deleteAPIKeyDB(id);
    }
});

function createTestApp() {
    const app = new Hono();
    app.route("/v1", LogsRouter);
    return app;
}

/** Creates a disposable API key and returns its token for the Authorization header. */
function createTestAuth(): string {
    const key = createAPIKeyDB({ name: "Analytics Test Key" });
    seededKeyIds.push(key.id);
    return key.key;
}

function seedLog(overrides: Partial<RequestLogEntry> = {}): RequestLogEntry {
    const row = logRequestDB({
        providerId: "openai",
        model: "gpt-4o-mini",
        promptTokens: 10,
        completionTokens: 20,
        totalTokens: 30,
        statusCode: 200,
        latencyMs: 100,
        cachedTokens: 0,
        cacheCreationTokens: 0,
        reasoningTokens: 0,
        estimatedCost: 0.001,
        fallbackOccurred: false,
        ...overrides
    });
    seededIds.push(row.id);
    return row;
}

function authedRequest(app: Hono, path: string) {
    return app.request(path, {
        headers: { Authorization: `Bearer ${createTestAuth()}` }
    });
}

test("GET /v1/logs/analytics returns analytics report", async () => {
    const app = createTestApp();
    const res = await authedRequest(app, "/v1/logs/analytics?window=1h");
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
        object: string;
        window: string;
        bucketSizeMs: number;
        generatedAt: number;
        requestsPerSecond: number;
        totalRequests: number;
        errorRate: number;
        p95LatencyMs: number;
        buckets: unknown[];
        topModels: unknown[];
        providers: unknown[];
    };
    assert.equal(body.object, "analytics");
    assert.equal(body.window, "1h");
    assert.equal(body.bucketSizeMs, 60_000);
    assert.ok(typeof body.generatedAt === "number");
    assert.ok(typeof body.requestsPerSecond === "number");
    assert.ok(typeof body.totalRequests === "number");
    assert.ok(typeof body.errorRate === "number");
    assert.ok(typeof body.p95LatencyMs === "number");
    assert.ok(Array.isArray(body.buckets));
    assert.ok(Array.isArray(body.topModels));
    assert.ok(Array.isArray(body.providers));
});

test("GET /v1/logs/analytics?window=bad returns 400", async () => {
    const app = createTestApp();
    const res = await authedRequest(app, "/v1/logs/analytics?window=bad");
    assert.equal(res.status, 400);
});

test("GET /v1/logs/analytics reflects seeded traffic and orders top models", async () => {
    seedLog({ providerId: "openai", model: "analytics-test-model-a", statusCode: 200, latencyMs: 100, totalTokens: 30 });
    seedLog({ providerId: "openai", model: "analytics-test-model-a", statusCode: 200, latencyMs: 150, totalTokens: 40 });
    seedLog({ providerId: "anthropic", model: "analytics-test-model-b", statusCode: 500, latencyMs: 2000, totalTokens: 50 });

    const app = createTestApp();
    const res = await authedRequest(app, "/v1/logs/analytics?window=1h");
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
        totalRequests: number;
        errorRate: number;
        buckets: Array<{ bucketStart: number; totalRequests: number; successRequests: number; errorRequests: number }>;
        topModels: Array<{ model: string; totalRequests: number }>;
        providers: Array<{ providerId: string; totalRequests: number }>;
    };

    assert.ok(body.totalRequests >= 3);
    assert.ok(body.errorRate > 0);
    assert.ok(body.buckets.length > 0);

    // Top model ordering: most requests first
    const testModels = body.topModels.filter((m) => m.model.startsWith("analytics-test-"));
    assert.ok(testModels.length >= 2);
    assert.equal(testModels[0].model, "analytics-test-model-a");
    assert.equal(testModels[0].totalRequests, 2);

    // Provider split reflects both providers
    const providers = body.providers.map((p) => p.providerId);
    assert.ok(providers.includes("openai"));
    assert.ok(providers.includes("anthropic"));
});