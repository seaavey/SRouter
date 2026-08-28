import assert from "node:assert/strict";
import { test } from "node:test";
import { getProviderAlias, ProviderRegistry } from "../src/registry.js";
import type { AIProvider } from "@srouter/types";

const delay = (ms: number): Promise<void> =>
    new Promise((resolve) => {
        setTimeout(resolve, ms);
    });

const provider: AIProvider = {
    id: "kiro_test_runtime",
    name: "Kiro Runtime Test",
    listModels: async () => [],
    chatCompletion: async () => {
        throw new Error("not used");
    },
    chatCompletionStream: async function* () {
        throw new Error("not used");
    }
};

test("unregisterProvider removes a deleted runtime connection", () => {
    const registry = new ProviderRegistry();
    registry.registerProvider(provider);
    assert.equal(registry.getProvider(provider.id), provider);

    assert.equal(registry.unregisterProvider(provider.id), true);
    assert.equal(registry.getProvider(provider.id), undefined);
    assert.equal(registry.unregisterProvider(provider.id), false);
});

test("Neosantara uses its own model prefix alias", () => {
    assert.equal(getProviderAlias("neosantara"), "neosantara");
    assert.equal(getProviderAlias("neosantara_123"), "neosantara");
    assert.equal(getProviderAlias("bai"), "bai");
    assert.equal(getProviderAlias("bai_primary"), "bai");
});

test("GoRouter uses its own model prefix alias", () => {
    assert.equal(getProviderAlias("gorouter"), "gorouter");
    assert.equal(getProviderAlias("gorouter_123"), "gorouter");
});

test("BluesMinds uses its own model prefix alias", () => {
    assert.equal(getProviderAlias("bluesminds"), "bluesminds");
    assert.equal(getProviderAlias("bluesminds_123"), "bluesminds");
});

test("SeekAI uses its own model prefix alias", () => {
    assert.equal(getProviderAlias("seekai"), "seekai");
    assert.equal(getProviderAlias("seekai_123"), "seekai");
});

test("TabiToken uses its own model prefix alias", () => {
    assert.equal(getProviderAlias("tabitoken"), "tabitoken");
    assert.equal(getProviderAlias("tabitoken_123"), "tabitoken");
});

test("TokenRouter uses its own model prefix alias", () => {
    assert.equal(getProviderAlias("tokenrouter"), "tokenrouter");
    assert.equal(getProviderAlias("tokenrouter_123"), "tokenrouter");
});

test("Qoder uses qd model prefix alias", () => {
    assert.equal(getProviderAlias("qoder"), "qd");
    assert.equal(getProviderAlias("qoder_456"), "qd");
});

test("getProviderForModel resolves provider with alias and full name prefixes", async () => {
    const registry = new ProviderRegistry();
    const qoderProvider: AIProvider = {
        id: "qoder_1786759000",
        name: "Qoder Test",
        listModels: async () => [{ id: "qoder/ultimate", object: "model" }],
        chatCompletion: async () => {
            throw new Error("not used");
        },
        chatCompletionStream: async function* () {
            throw new Error("not used");
        }
    };
    registry.registerProvider(qoderProvider);

    // Direct model match
    const p1 = await registry.getProviderForModel("qoder/ultimate");
    assert.equal(p1.id, qoderProvider.id);

    // Alias prefix match (qd/ultimate)
    const p2 = await registry.getProviderForModel("qd/ultimate");
    assert.equal(p2.id, qoderProvider.id);

    // Unregistered provider throws descriptive error
    await assert.rejects(
        () => registry.getProviderForModel("unregistered/model"),
        /No active provider connection found for model "unregistered\/model"/
    );
});

test("ProviderRegistry caches listModels responses across multiple calls within TTL", async () => {
    let callCount = 0;
    const testProvider: AIProvider = {
        id: "test_cached_provider",
        name: "Test Cached Provider",
        listModels: async () => {
            callCount++;
            return [{ id: "test_cached_provider/model-1", object: "model" }];
        },
        chatCompletion: async () => {
            throw new Error("not used");
        },
        chatCompletionStream: async function* () {
            throw new Error("not used");
        }
    };

    const registry = new ProviderRegistry();
    registry.registerProvider(testProvider);

    // Initial call fetches models
    const models1 = await registry.listAllModels();
    assert.equal(callCount, 1);
    assert.ok(models1.some((m) => m.id === "test/model-1"));

    // Second call within TTL hits cache (callCount remains 1)
    const models2 = await registry.listAllModels();
    assert.equal(callCount, 1);
    assert.deepEqual(models2, models1);

    // forceRefresh bypasses cache (callCount increments)
    const models3 = await registry.listAllModels(undefined, true);
    assert.equal(callCount, 2);
    assert.deepEqual(models3, models1);
});

test("ProviderRegistry invalidates cache on register and unregister", async () => {
    let callCount = 0;
    const testProvider: AIProvider = {
        id: "test_invalidation_provider",
        name: "Test Invalidation Provider",
        listModels: async () => {
            callCount++;
            return [{ id: "test_invalidation_provider/alpha", object: "model" }];
        },
        chatCompletion: async () => {
            throw new Error("not used");
        },
        chatCompletionStream: async function* () {
            throw new Error("not used");
        }
    };

    const registry = new ProviderRegistry();
    registry.registerProvider(testProvider);

    await registry.listAllModels();
    assert.equal(callCount, 1);

    // Re-registering the provider clears cache
    registry.registerProvider(testProvider);
    await registry.listAllModels();
    assert.equal(callCount, 2);

    // Unregistering removes provider and clears cache
    registry.unregisterProvider(testProvider.id);
    const models = await registry.listAllModels();
    assert.equal(models.length, 0);
});

test("ProviderRegistry serves a stale aggregate snapshot while refreshing", async () => {
    let callCount = 0;
    const testProvider: AIProvider = {
        id: "test_snapshot_provider",
        name: "Test Snapshot Provider",
        listModels: async () => {
            callCount++;
            if (callCount === 2) await delay(120);
            return [
                {
                    id: `test_snapshot_provider/${callCount === 1 ? "stale" : "fresh"}`,
                    object: "model"
                }
            ];
        },
        chatCompletion: async () => {
            throw new Error("not used");
        },
        chatCompletionStream: async function* () {
            throw new Error("not used");
        }
    };

    const registry = new ProviderRegistry(undefined, 100);
    registry.registerProvider(testProvider);
    await registry.listAllModels();
    await delay(110);

    const startedAt = Date.now();
    const staleModels = await registry.listAllModels();
    const elapsedMs = Date.now() - startedAt;

    assert.ok(elapsedMs < 60, `stale read took ${elapsedMs}ms`);
    assert.ok(staleModels.some((m) => m.id === "test/stale"));
    assert.equal(callCount, 2);

    await delay(140);
    const freshModels = await registry.listAllModels();
    assert.ok(freshModels.some((m) => m.id === "test/fresh"));
    assert.equal(callCount, 2);
});

test("ProviderRegistry bounds slow refreshes and keeps cached models", async () => {
    let callCount = 0;
    const testProvider: AIProvider = {
        id: "test_timeout_provider",
        name: "Test Timeout Provider",
        listModels: async () => {
            callCount++;
            if (callCount > 1) await delay(300);
            return [
                {
                    id: `test_timeout_provider/${callCount === 1 ? "cached" : "fresh"}`,
                    object: "model"
                }
            ];
        },
        chatCompletion: async () => {
            throw new Error("not used");
        },
        chatCompletionStream: async function* () {
            throw new Error("not used");
        }
    };

    const registry = new ProviderRegistry();
    registry.registerProvider(testProvider);
    await registry.listAllModels();
    registry.setModelsFetchTimeoutMs(20);

    const startedAt = Date.now();
    const models = await registry.listAllModels(undefined, true);
    const elapsedMs = Date.now() - startedAt;

    assert.ok(elapsedMs < 150, `timed out read took ${elapsedMs}ms`);
    assert.ok(models.some((m) => m.id === "test/cached"));
    assert.equal(callCount, 2);
});

test("ProviderRegistry coalesces concurrent forced refreshes", async () => {
    let callCount = 0;
    const pending: Array<() => void> = [];
    const testProvider: AIProvider = {
        id: "test_forced_refresh_provider",
        name: "Test Forced Refresh Provider",
        listModels: async () => {
            callCount++;
            if (callCount > 1) {
                await new Promise<void>((resolve) => {
                    pending.push(resolve);
                });
            }
            return [{ id: "test_forced_refresh_provider/model", object: "model" }];
        },
        chatCompletion: async () => {
            throw new Error("not used");
        },
        chatCompletionStream: async function* () {
            throw new Error("not used");
        }
    };

    const registry = new ProviderRegistry();
    registry.registerProvider(testProvider);
    await registry.listAllModels();

    const firstRefresh = registry.listAllModels(undefined, true);
    const secondRefresh = registry.listAllModels(undefined, true);
    await delay(10);

    assert.equal(callCount, 2);
    pending.forEach((resolve) => resolve());
    await Promise.all([firstRefresh, secondRefresh]);
    assert.equal(callCount, 2);
});

test("CircuitBreaker tracks provider health and handles cooldown recovery", async () => {
    const registry = new ProviderRegistry();
    const cb = registry.getCircuitBreaker();
    cb.reset();

    assert.equal(cb.isAvailable("acc_1"), true);
    assert.equal(cb.getHealth("acc_1").state, "healthy");

    // Record failure with 50ms cooldown
    cb.recordFailure("acc_1", new Error("Rate limit exceeded 429"), 50);
    assert.equal(cb.isAvailable("acc_1"), false);
    assert.equal(cb.getHealth("acc_1").state, "cooldown");

    // After cooldown duration, auto-recovers to healthy
    await delay(60);
    assert.equal(cb.isAvailable("acc_1"), true);
    assert.equal(cb.getHealth("acc_1").state, "healthy");
});

test("ProviderRegistry automatically fails over to backup account when primary account fails", async () => {
    let acc1Called = false;
    let acc2Called = false;

    const acc1: AIProvider = {
        id: "antigravity_acc1",
        name: "Antigravity Account 1",
        listModels: async () => [{ id: "antigravity/gemini-2.5-flash", object: "model" }],
        chatCompletion: async () => {
            acc1Called = true;
            throw new Error("429 Too Many Requests: Resource Exhausted");
        },
        chatCompletionStream: async function* () {
            acc1Called = true;
            throw new Error("429 Too Many Requests: Resource Exhausted");
        }
    };

    const acc2: AIProvider = {
        id: "antigravity_acc2",
        name: "Antigravity Account 2",
        listModels: async () => [{ id: "antigravity/gemini-2.5-flash", object: "model" }],
        chatCompletion: async () => {
            acc2Called = true;
            return {
                id: "chatcmpl-test",
                object: "chat.completion",
                created: Date.now(),
                model: "antigravity/gemini-2.5-flash",
                choices: [
                    {
                        index: 0,
                        message: { role: "assistant", content: "Recovered from acc2!" },
                        finish_reason: "stop"
                    }
                ]
            };
        },
        chatCompletionStream: async function* () {
            acc2Called = true;
            yield {
                id: "chatcmpl-test",
                object: "chat.completion.chunk",
                created: Date.now(),
                model: "antigravity/gemini-2.5-flash",
                choices: [
                    {
                        index: 0,
                        delta: { content: "Recovered stream from acc2!" },
                        finish_reason: null
                    }
                ]
            };
        }
    };

    const registry = new ProviderRegistry();
    registry.registerProvider(acc1);
    registry.registerProvider(acc2);

    // Non-streaming completion failover test
    const res = await registry.chatCompletion({
        model: "antigravity/gemini-2.5-flash",
        messages: [{ role: "user", content: "Hello" }]
    });

    assert.equal(acc1Called, true);
    assert.equal(acc2Called, true);
    assert.equal(res.choices[0]?.message.content, "Recovered from acc2!");

    // Streaming completion failover test
    acc1Called = false;
    acc2Called = false;
    const stream = registry.chatCompletionStream({
        model: "antigravity/gemini-2.5-flash",
        messages: [{ role: "user", content: "Hello streaming" }]
    });

    const chunks = [];
    for await (const chunk of stream) {
        chunks.push(chunk);
    }

    assert.equal(chunks.length, 1);
    assert.equal(chunks[0]?.choices[0]?.delta.content, "Recovered stream from acc2!");
});
