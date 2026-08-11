import assert from "node:assert/strict";
import { test } from "node:test";
import { ProviderRegistry } from "../src/registry.js";
import type { AIProvider } from "@srouter/types";

const provider: AIProvider = {
    id: "kiro_test_runtime",
    name: "Kiro Runtime Test",
    listModels: async () => [],
    chatCompletion: async () => { throw new Error("not used"); },
    chatCompletionStream: async function* () { throw new Error("not used"); },
};

test("unregisterProvider removes a deleted runtime connection", () => {
    const registry = new ProviderRegistry();
    registry.registerProvider(provider);
    assert.equal(registry.getProvider(provider.id), provider);

    assert.equal(registry.unregisterProvider(provider.id), true);
    assert.equal(registry.getProvider(provider.id), undefined);
    assert.equal(registry.unregisterProvider(provider.id), false);
});
