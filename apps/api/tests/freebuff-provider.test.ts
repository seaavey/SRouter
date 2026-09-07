import assert from "node:assert/strict";
import { test } from "node:test";
import {
    FREEBUFF_BASE_URL,
    FREEBUFF_MODELS,
    FREEBUFF_PROVIDER,
    KNOWN_PROVIDERS,
    providerById
} from "@srouter/constants";
import { FreebuffExecutor } from "@srouter/executors";

test("Freebuff provider constants and metadata", () => {
    assert.equal(FREEBUFF_PROVIDER.id, "freebuff");
    assert.equal(FREEBUFF_PROVIDER.alias, "freebuff");
    assert.equal(FREEBUFF_PROVIDER.category, "free_tier");
    assert.equal(FREEBUFF_PROVIDER.protocol, "openai");
    assert.equal(FREEBUFF_PROVIDER.base_url, FREEBUFF_BASE_URL);

    const fromCatalog = providerById("freebuff");
    assert.ok(fromCatalog);
    assert.equal(fromCatalog?.id, "freebuff");
    assert.ok(KNOWN_PROVIDERS.some((p) => p.id === "freebuff"));
});

test("FreebuffExecutor lists mapped models with baseId prefix", async () => {
    const executor = new FreebuffExecutor({
        id: "freebuff",
        freebuffToken: "test-token"
    });

    const models = await executor.listModels();
    assert.equal(models.length, FREEBUFF_MODELS.length);
    assert.ok(models.some((m) => m.id === "freebuff/meta/muse-spark-1.3-contributor"));
    assert.ok(models.some((m) => m.id === "freebuff/z-ai/glm-5.3-flash"));
});
