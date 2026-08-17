import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createFallbackRuleDB, deleteFallbackRuleDB, getRecentLogsDB } from "@srouter/db";
import type { AIProvider } from "@srouter/types";
import { ChatLogic } from "../src/logic/chat.logic.js";
import { registry } from "../src/services/registry.js";

const createdRuleIds: string[] = [];
const registeredProviderIds: string[] = [];

afterEach(() => {
    for (const id of createdRuleIds.splice(0)) {
        deleteFallbackRuleDB(id);
    }
    for (const id of registeredProviderIds.splice(0)) {
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
    const rule = createFallbackRuleDB({
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
    const recentLogs = getRecentLogsDB(5);
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

    const rule = createFallbackRuleDB({
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

test("ChatLogic logs resolvedModel when srouter/auto meta-model is used", async () => {
    const autoProvider: AIProvider = {
        id: "auto_test_provider",
        name: "Auto Test Provider",
        listModels: async () => [{ id: "auto_test_provider/claude-3-7-sonnet", object: "model" }],
        chatCompletion: async (req) => ({
            id: "chatcmpl-auto-test",
            object: "chat.completion",
            created: Date.now(),
            model: req.model,
            choices: [
                {
                    index: 0,
                    message: { role: "assistant", content: "Auto routed answer" },
                    finish_reason: "stop"
                }
            ]
        }),
        chatCompletionStream: async function* (req) {
            yield {
                id: "chatcmpl-auto-stream-test",
                object: "chat.completion.chunk",
                created: Date.now(),
                model: req.model,
                choices: [
                    {
                        index: 0,
                        delta: { content: "Auto stream answer" },
                        finish_reason: null
                    }
                ]
            };
        }
    };

    registry.registerProvider(autoProvider);
    registeredProviderIds.push(autoProvider.id);

    // 1. Non-streaming test
    const startTime = Date.now();
    const res = await ChatLogic.processNonStreamingCompletion(
        {
            model: "srouter/auto",
            messages: [{ role: "user", content: "Auto test query" }]
        },
        startTime
    );

    assert.equal(res.choices[0]?.message.content, "Auto routed answer");

    const recentLogs = getRecentLogsDB(5);
    const autoLog = recentLogs.find(
        (l) =>
            l.model === "srouter/auto" && l.resolvedModel === "auto_test_provider/claude-3-7-sonnet"
    );
    assert.ok(autoLog, "Expected to find log with model srouter/auto and resolvedModel set");
    assert.equal(autoLog?.resolvedModel, "auto_test_provider/claude-3-7-sonnet");

    // 2. Streaming test
    const streamGen = ChatLogic.processStreamingCompletion(
        {
            model: "srouter/auto",
            messages: [{ role: "user", content: "Auto streaming query" }]
        },
        Date.now()
    );

    const streamChunks = [];
    for await (const chunk of streamGen) {
        streamChunks.push(chunk);
    }
    assert.equal(streamChunks.length, 1);

    const streamLogs = getRecentLogsDB(5);
    const streamLog = streamLogs.find(
        (l) =>
            l.model === "srouter/auto" && l.resolvedModel === "auto_test_provider/claude-3-7-sonnet"
    );
    assert.ok(
        streamLog,
        "Expected to find streaming log with model srouter/auto and resolvedModel set"
    );
});
