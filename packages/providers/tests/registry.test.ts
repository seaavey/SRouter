import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_CATALOG, getProviderAlias, ProviderRegistry } from "../src/registry.js";
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

test("Neosantara has the API-key OpenAI catalog contract", () => {
    const item = DEFAULT_CATALOG.find((entry) => entry.id === "neosantara");
    assert.ok(item);
    assert.equal(item.name, "Neosantara");
    assert.equal(item.category, "api_key");
    assert.equal(item.protocol, "openai");
    assert.equal(item.defaultBaseUrl, "https://api.neosantara.xyz/v1");
    assert.equal(item.requiresApiKey, true);
    assert.equal(item.supportsCustomUrl, true);
    assert.equal(item.status.state, "disconnected");
    assert.deepEqual(item.models, []);
});

test("Neosantara uses its own model prefix alias", () => {
    assert.equal(getProviderAlias("neosantara"), "neosantara");
    assert.equal(getProviderAlias("neosantara_123"), "neosantara");
});
