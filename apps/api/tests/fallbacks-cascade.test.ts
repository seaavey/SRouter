import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
    createFallbackRuleDB,
    deleteFallbackRuleDB,
    deleteLogsByProviderDB,
    getRecentLogsDB
} from "@srouter/db";
import type { AIProvider } from "@srouter/types";
import { ChatLogic } from "../src/logic/chat.logic.js";
import { registry } from "../src/services/registry.js";

const createdRuleIds: string[] = [];
const registeredProviderIds: string[] = [];

afterEach(async () => {
    for (const id of createdRuleIds.splice(0)) {
        await await deleteFallbackRuleDB(id);
    }
    for (const id of registeredProviderIds.splice(0)) {
        await await deleteLogsByProviderDB(id);
        registry.unregisterProvider(id);
    }
});

test("ChatLogic automatically cascades non-streaming request to fallback provider when primary fails", async () => {
    let primaryCalled = false;
    let fallbackCalled = false;

    const primaryProvider: AIProvider = {
        id: "primary_failing",
        name: "Primary Failing Provider",
        listModels: async () => [{ id: "primary_failing/model-a", object: "model" }],
        chatCompletion: async () => {
            primaryCalled = true;
            throw new Error("429 Too Many Requests: Rate limit exceeded");
        },
        chatCompletionStream: async function* () {
            primaryCalled = true;
            throw new Error("429 Too Many Requests: Rate limit exceeded");
        }
    };

    const fallbackProvider: AIProvider = {
        id: "fallback_backup",
        name: "Fallback Backup Provider",
        listModels: async () => [{ id: "fallback_backup/model-b", object: "model" }],
        chatCompletion: async (req) => {
            fallbackCalled = true;
            return {
                id: "chatcmpl-fallback-test",
                object: "chat.completion",
                created: Date.now(),
                model: req.model,
                choices: [
                    {
                        index: 0,
                        message: { role: "assistant", content: "Hello from fallback cascade!" },
                        finish_reason: "stop"
                    }
                ]
            };
        },
        chatCompletionStream: async function* (req) {
            fallbackCalled = true;
            yield {
                id: "chatcmpl-fallback-test",
                object: "chat.completion.chunk",
                created: Date.now(),
                model: req.model,
                choices: [
                    {
                        index: 0,
                        delta: { content: "Stream from fallback cascade!" },
                        finish_reason: null
                    }
                ]
            };
        }
    };

    registry.registerProvider(primaryProvider);
    registry.registerProvider(fallbackProvider);
    registeredProviderIds.push(primaryProvider.id, fallbackProvider.id);

    // Create fallback rule: primary_failing/model-a -> fallback_backup/model-b
    const rule = await await createFallbackRuleDB({
        sourceModel: "primary_failing/model-a",
        targetModel: "fallback_backup/model-b",
        priority: 1,
        enabled: true,
        triggerOnStatus: [429, 500, 502, 503]
    });
    createdRuleIds.push(rule.id);

    const startTime = Date.now();
    const res = await ChatLogic.processNonStreamingCompletion(
        {
            model: "primary_failing/model-a",
            messages: [{ role: "user", content: "Hello" }]
        },
        startTime
    );

    assert.equal(primaryCalled, true);
    assert.equal(fallbackCalled, true);
    assert.equal(res.choices[0]?.message.content, "Hello from fallback cascade!");

    // Verify request logs record fallback metadata
    const recentLogs = await await getRecentLogsDB(5);
    const log = recentLogs.find((l) => l.model === "fallback_backup/model-b");
    assert.ok(log);
    assert.equal(log?.fallbackOccurred, true);
    assert.equal(log?.fallbackPath, "primary_failing/model-a -> fallback_backup/model-b");
});

test("ChatLogic cascades streaming request to fallback provider before first chunk is yielded", async () => {
    let primaryCalled = false;
    let fallbackCalled = false;

    const primaryProvider: AIProvider = {
        id: "primary_failing_stream",
        name: "Primary Failing Stream Provider",
        listModels: async () => [{ id: "primary_failing_stream/model-x", object: "model" }],
        chatCompletion: async () => {
            primaryCalled = true;
            throw new Error("503 Service Unavailable");
        },
        chatCompletionStream: async function* () {
            primaryCalled = true;
            throw new Error("503 Service Unavailable");
        }
    };

    const fallbackProvider: AIProvider = {
        id: "fallback_backup_stream",
        name: "Fallback Backup Stream Provider",
        listModels: async () => [{ id: "fallback_backup_stream/model-y", object: "model" }],
        chatCompletion: async () => {
            throw new Error("Not implemented");
        },
        chatCompletionStream: async function* (req) {
            fallbackCalled = true;
            yield {
                id: "chatcmpl-stream-test",
                object: "chat.completion.chunk",
                created: Date.now(),
                model: req.model,
                choices: [
                    {
                        index: 0,
                        delta: { content: "Streaming seamlessly from fallback!" },
                        finish_reason: null
                    }
                ]
            };
        }
    };

    registry.registerProvider(primaryProvider);
    registry.registerProvider(fallbackProvider);
    registeredProviderIds.push(primaryProvider.id, fallbackProvider.id);

    const rule = await await createFallbackRuleDB({
        sourceModel: "primary_failing_stream/*",
        targetModel: "fallback_backup_stream/model-y",
        priority: 1,
        enabled: true
    });
    createdRuleIds.push(rule.id);

    const startTime = Date.now();
    const generator = ChatLogic.processStreamingCompletion(
        {
            model: "primary_failing_stream/model-x",
            messages: [{ role: "user", content: "Stream test" }]
        },
        startTime
    );

    const chunks = [];
    for await (const chunk of generator) {
        chunks.push(chunk);
    }

    assert.equal(primaryCalled, true);
    assert.equal(fallbackCalled, true);
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0]?.choices[0]?.delta.content, "Streaming seamlessly from fallback!");
});

test("ChatLogic does not cascade after a client-visible streaming chunk", async () => {
    let fallbackCalled = false;
    const primaryProvider: AIProvider = {
        id: "primary_committed_stream",
        name: "Primary Committed Stream Provider",
        listModels: async () => [{ id: "primary_committed_stream/model", object: "model" }],
        chatCompletion: async () => {
            throw new Error("Not implemented");
        },
        chatCompletionStream: async function* () {
            yield {
                id: "committed-chunk",
                object: "chat.completion.chunk",
                created: Date.now(),
                model: "primary_committed_stream/model",
                choices: [{ index: 0, delta: { content: "partial" }, finish_reason: null }]
            };
            throw new Error("stream interrupted after output");
        }
    };
    const fallbackProvider: AIProvider = {
        id: "fallback_after_commit",
        name: "Fallback After Commit",
        listModels: async () => [{ id: "fallback_after_commit/model", object: "model" }],
        chatCompletion: async () => {
            throw new Error("Not implemented");
        },
        chatCompletionStream: async function* () {
            fallbackCalled = true;
            yield {
                id: "fallback-chunk",
                object: "chat.completion.chunk",
                created: Date.now(),
                model: "fallback_after_commit/model",
                choices: [{ index: 0, delta: { content: "fallback" }, finish_reason: null }]
            };
        }
    };

    registry.registerProvider(primaryProvider);
    registry.registerProvider(fallbackProvider);
    registeredProviderIds.push(primaryProvider.id, fallbackProvider.id);
    const rule = await createFallbackRuleDB({
        sourceModel: "primary_committed_stream/model",
        targetModel: "fallback_after_commit/model",
        priority: 1,
        enabled: true
    });
    createdRuleIds.push(rule.id);

    const chunks = [];
    await assert.rejects(async () => {
        for await (const chunk of ChatLogic.processStreamingCompletion(
            {
                model: "primary_committed_stream/model",
                messages: [{ role: "user", content: "commit test" }]
            },
            Date.now()
        )) {
            chunks.push(chunk);
        }
    }, /stream interrupted after output/);

    assert.equal(chunks.length, 1);
    assert.equal(fallbackCalled, false);
});

test("ChatLogic can cascade when a buffered tool-call stream fails before client output", async () => {
    let fallbackCalled = false;
    const primaryProvider: AIProvider = {
        id: "primary_buffered_stream",
        name: "Primary Buffered Stream Provider",
        listModels: async () => [{ id: "primary_buffered_stream/model", object: "model" }],
        chatCompletion: async () => {
            throw new Error("Not implemented");
        },
        chatCompletionStream: async function* () {
            yield {
                id: "tool-buffered-chunk",
                object: "chat.completion.chunk",
                created: Date.now(),
                model: "primary_buffered_stream/model",
                choices: [
                    {
                        index: 0,
                        delta: {
                            tool_calls: [
                                {
                                    index: 0,
                                    id: "buffered-call",
                                    type: "function",
                                    function: { name: "client_tool", arguments: "{}" }
                                }
                            ]
                        },
                        finish_reason: null
                    }
                ]
            };
            throw new Error("buffered stream interrupted");
        }
    };
    const fallbackProvider: AIProvider = {
        id: "fallback_buffered_stream",
        name: "Fallback Buffered Stream",
        listModels: async () => [{ id: "fallback_buffered_stream/model", object: "model" }],
        chatCompletion: async () => {
            throw new Error("Not implemented");
        },
        chatCompletionStream: async function* () {
            fallbackCalled = true;
            yield {
                id: "buffered-fallback-chunk",
                object: "chat.completion.chunk",
                created: Date.now(),
                model: "fallback_buffered_stream/model",
                choices: [
                    { index: 0, delta: { content: "fallback after buffer" }, finish_reason: null }
                ]
            };
        }
    };

    registry.registerProvider(primaryProvider);
    registry.registerProvider(fallbackProvider);
    registeredProviderIds.push(primaryProvider.id, fallbackProvider.id);
    const rule = await createFallbackRuleDB({
        sourceModel: "primary_buffered_stream/model",
        targetModel: "fallback_buffered_stream/model",
        priority: 1,
        enabled: true
    });
    createdRuleIds.push(rule.id);

    const chunks = [];
    for await (const chunk of ChatLogic.processStreamingCompletion(
        {
            model: "primary_buffered_stream/model",
            messages: [{ role: "user", content: "buffer test" }]
        },
        Date.now()
    )) {
        chunks.push(chunk);
    }

    assert.equal(fallbackCalled, true);
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0]?.choices[0]?.delta.content, "fallback after buffer");
});
