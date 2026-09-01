import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createAPIKeyDB, db, deleteAPIKeyDB } from "@srouter/db";
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

/**
 * Seeds `rows` into the 1h analytics window at a deterministic `created_at`
 * inside a fresh minute-bucket. Uses raw SQL so the timestamp is controlled —
 * `logRequestDB` forces `created_at = Date.now()`, which can collide with live
 * traffic in a shared dev DB. Skips backward in 1-min steps until it finds an
 * empty bucket, so the exact token sums asserted below are hermetic.
 */
function seedIntoEmptyBucket(rows: Array<Omit<RequestLogEntry, "id" | "createdAt">>) {
    const BucketSizeMs = 60_000;
    const Now = Date.now();
    const Since = Now - BucketSizeMs * 60;

    // Align to the minute boundary the DB buckets by (created_at / 60_000) * 60_000
    let bucketStart = Math.floor(Now / BucketSizeMs) * BucketSizeMs;
    for (;;) {
        const BucketEnd = bucketStart + BucketSizeMs;
        const Count = db
            .prepare(
                "SELECT COUNT(*) AS count FROM request_logs WHERE created_at >= ? AND created_at < ?"
            )
            .get(bucketStart, BucketEnd) as { count: number };
        if (Count.count === 0) break;
        if (bucketStart <= Since) {
            throw new Error("no empty minute-bucket found in the 1h window");
        }
        bucketStart -= BucketSizeMs;
    }

    const Insert = db.prepare(`
        INSERT INTO request_logs (id, api_key_id, provider_id, model, prompt_tokens, completion_tokens, total_tokens, status_code, latency_ms, cached_tokens, cache_creation_tokens, reasoning_tokens, estimated_cost, fallback_occurred, fallback_path, fallback_reason, resolved_model, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const now = bucketStart + Math.floor(BucketSizeMs / 3);

    for (const row of rows) {
        const id = `test_${Math.random().toString(36).slice(2, 10)}`;
        Insert.run(
            id,
            null,
            row.providerId,
            row.model,
            row.promptTokens,
            row.completionTokens,
            row.totalTokens,
            row.statusCode,
            row.latencyMs,
            row.cachedTokens ?? 0,
            0,
            0,
            row.estimatedCost ?? 0,
            0,
            null,
            null,
            null,
            now
        );
        seededIds.push(id);
    }

    return { bucketStart };
}

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
    const { bucketStart } = seedIntoEmptyBucket([
        {
            providerId: "openai",
            model: "analytics-test-model-a",
            promptTokens: 10,
            completionTokens: 20,
            totalTokens: 30,
            statusCode: 200,
            latencyMs: 100,
            cachedTokens: 0,
            cacheCreationTokens: 0,
            reasoningTokens: 0,
            estimatedCost: 0.001,
            fallbackOccurred: false
        },
        {
            providerId: "openai",
            model: "analytics-test-model-a",
            promptTokens: 10,
            completionTokens: 20,
            totalTokens: 40,
            statusCode: 200,
            latencyMs: 150,
            cachedTokens: 0,
            cacheCreationTokens: 0,
            reasoningTokens: 0,
            estimatedCost: 0.001,
            fallbackOccurred: false
        },
        {
            providerId: "anthropic",
            model: "analytics-test-model-b",
            promptTokens: 10,
            completionTokens: 20,
            totalTokens: 50,
            statusCode: 500,
            latencyMs: 2000,
            cachedTokens: 0,
            cacheCreationTokens: 0,
            reasoningTokens: 0,
            estimatedCost: 0.001,
            fallbackOccurred: false
        }
    ]);

    const app = createTestApp();
    const res = await authedRequest(app, "/v1/logs/analytics?window=1h");
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
        totalRequests: number;
        errorRate: number;
        buckets: Array<{
            bucketStart: number;
            totalRequests: number;
            successRequests: number;
            errorRequests: number;
            promptTokens: number;
            completionTokens: number;
            cachedTokens: number;
        }>;
        topModels: Array<{ model: string; totalRequests: number }>;
        providers: Array<{ providerId: string; totalRequests: number }>;
    };

    assert.ok(body.totalRequests >= 3);
    assert.ok(body.errorRate > 0);
    assert.ok(body.buckets.length > 0);

    // The seeded bucket is hermetic — assert exact aggregates
    const seededBucket = body.buckets.find((b) => b.bucketStart === bucketStart);
    assert.ok(seededBucket, "seeded bucket should be present in the report");
    assert.equal(seededBucket.totalRequests, 3);
    assert.equal(seededBucket.successRequests, 2);
    assert.equal(seededBucket.errorRequests, 1);
    assert.equal(seededBucket.promptTokens, 30);
    assert.equal(seededBucket.completionTokens, 60);
    assert.equal(seededBucket.cachedTokens, 0);

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
