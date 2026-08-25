import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { Hono } from "hono";
import type { AIProvider } from "@srouter/types";
import { modelsRoute } from "../src/routes/v1/models.js";
import { registry } from "../src/services/registry.js";
import { ModelsLogic } from "../src/logic/models.logic.js";

const app = new Hono();
app.route("/v1", modelsRoute);

const mockProviderId = "mock";
let fetchCount = 0;
let slowRefresh = false;

const delay = (ms: number): Promise<void> =>
    new Promise((resolve) => {
        setTimeout(resolve, ms);
    });

const mockProvider: AIProvider = {
    id: mockProviderId,
    name: "Mock Models Cached Provider",
    listModels: async () => {
        fetchCount++;
        if (slowRefresh) await delay(300);
        return [
            { id: `${mockProviderId}/gpt-5-turbo`, object: "model" },
            { id: `${mockProviderId}/claude-sonnet-4`, object: "model" }
        ];
    },
    chatCompletion: async () => {
        throw new Error("not implemented");
    },
    chatCompletionStream: async function* () {
        throw new Error("not implemented");
    }
};

beforeEach(() => {
    fetchCount = 0;
    slowRefresh = false;
    for (const providerId of registry.getAllProviders().keys()) {
        if (providerId !== "default" && providerId !== mockProviderId) {
            registry.unregisterProvider(providerId);
        }
    }
    registry.registerProvider(mockProvider);
    ModelsLogic.ClearCache();
});

afterEach(() => {
    registry.unregisterProvider(mockProviderId);
    ModelsLogic.ClearCache();
});

test("GET /v1/models returns cached models and Cache-Control header", async () => {
    const res1 = await app.request("/v1/models", { method: "GET" });
    assert.equal(res1.status, 200);
    assert.match(res1.headers.get("cache-control") ?? "", /public, max-age=\d+/);

    const body1 = (await res1.json()) as { object: string; data: Array<{ id: string }> };
    assert.equal(body1.object, "list");
    assert.ok(body1.data.some((m) => m.id.includes("gpt-5-turbo")));
    assert.equal(fetchCount, 1);

    // Second request within TTL hits cache (fetchCount is still 1)
    const res2 = await app.request("/v1/models", { method: "GET" });
    assert.equal(res2.status, 200);
    const body2 = (await res2.json()) as { object: string; data: Array<{ id: string }> };
    assert.deepEqual(body2, body1);
    assert.equal(fetchCount, 1);
});

test("GET /v1/models?refresh=true forces a fresh fetch bypassing cache", async () => {
    // Initial fetch
    await app.request("/v1/models", { method: "GET" });
    assert.equal(fetchCount, 1);

    // Forced refresh via query param
    const resRefresh = await app.request("/v1/models?refresh=true", { method: "GET" });
    assert.equal(resRefresh.status, 200);
    assert.equal(fetchCount, 2);

    // Forced refresh via Cache-Control header
    const resNoCache = await app.request("/v1/models", {
        method: "GET",
        headers: { "Cache-Control": "no-cache" }
    });
    assert.equal(resNoCache.status, 200);
    for (let i = 0; i < 20 && fetchCount < 3; i++) await delay(5);
    assert.equal(fetchCount, 3);
});

test("GET /v1/models revalidates no-cache requests without blocking", async () => {
    await app.request("/v1/models", { method: "GET" });
    slowRefresh = true;

    const startedAt = Date.now();
    const response = await app.request("/v1/models", {
        method: "GET",
        headers: { "Cache-Control": "no-cache" }
    });
    const elapsedMs = Date.now() - startedAt;

    assert.equal(response.status, 200);
    assert.ok(elapsedMs < 150, `no-cache request took ${elapsedMs}ms`);
    const body = (await response.json()) as { data: Array<{ id: string }> };
    assert.ok(body.data.some((model) => model.id.includes("gpt-5-turbo")));

    for (let i = 0; i < 60 && fetchCount < 2; i++) await delay(10);
    assert.equal(fetchCount, 2);
});

test("GET /v1/models/:model returns single model or 404", async () => {
    const resFound = await app.request(
        `/v1/models/${encodeURIComponent(`${mockProviderId}/gpt-5-turbo`)}`,
        { method: "GET" }
    );
    assert.equal(resFound.status, 200);
    const model = (await resFound.json()) as { id: string };
    assert.equal(model.id, `${mockProviderId}/gpt-5-turbo`);

    const resNotFound = await app.request("/v1/models/non-existent-model-xyz", {
        method: "GET"
    });
    assert.equal(resNotFound.status, 404);
});
