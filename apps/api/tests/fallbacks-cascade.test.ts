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
