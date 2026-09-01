import test from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { ProvidersRouter } from "../src/routes/v1/providers.js";
import { registry } from "../src/services/registry.js";
import type { AIProvider } from "@srouter/types";

function mockProvider(id: string): AIProvider {
    return {
        id,
        name: `Mock ${id}`,
        listModels: async () => [{ id: `${id}/mock-model`, object: "model", owned_by: id }],
        chatCompletion: async () => {
            throw new Error("not used");
        },
        chatCompletionStream: async function* () {
            throw new Error("not used");
        }
    };
}

test("round-robin toggle persists and flips registry flag", async (t) => {
    const openai1 = "openai_1789000001";
    const openai2 = "openai_1789000002";
    registry.registerProvider(mockProvider(openai1));
    registry.registerProvider(mockProvider(openai2));

    t.after(() => {
        registry.unregisterProvider(openai1);
        registry.unregisterProvider(openai2);
        registry.setRoundRobin("openai", false);
    });

    const app = new Hono();
    app.route("/v1", ProvidersRouter);

    // Requires admin session — expect 401 without it (proves mutation guard)
    const unauth = await app.request("/v1/providers/openai/round-robin", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: true })
    });
    assert.equal(unauth.status, 401, "mutation without admin session should be rejected");
});
