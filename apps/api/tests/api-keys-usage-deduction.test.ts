import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createAPIKeyDB, deleteAPIKeyDB, getAPIKeyByKeyDB } from "@srouter/db";
import { ChatLogic } from "@/logic/chat.logic.js";
import { registry } from "@/services/registry.js";

const createdIds: string[] = [];

afterEach(() => {
    for (const id of createdIds.splice(0)) {
        deleteAPIKeyDB(id);
    }
});

test("ChatLogic.ProcessNonStreamingCompletion records usage tokens and dollar cost for apiKeyId", async () => {
    const key = createAPIKeyDB({
        name: "Deduction Key",
        creditLimit: 10
    });
    createdIds.push(key.id);

    // Mock provider in registry
    const origMethod = registry.chatCompletion;
    registry.chatCompletion = async () => ({
        id: "chatcmpl-mock",
        object: "chat.completion",
        created: Date.now(),
        model: "openai_codex/gpt-4o",
        choices: [
            {
                index: 0,
                message: { role: "assistant", content: "Hello!" },
                finish_reason: "stop"
            }
        ],
        usage: {
            prompt_tokens: 100,
            completion_tokens: 50,
            total_tokens: 150
        }
    });

    try {
        await ChatLogic.ProcessNonStreamingCompletion(
            {
                model: "openai_codex/gpt-4o",
                messages: [{ role: "user", content: "Hi" }]
            },
            Date.now(),
            0,
            key.id
        );

        const updated = getAPIKeyByKeyDB(key.key);
        assert.ok(updated);
        assert.equal(updated?.usageTokens, 150);
        assert.ok((updated?.usageCost ?? 0) > 0, "Usage cost should be greater than 0");
    } finally {
        registry.chatCompletion = origMethod;
    }
});

test("ChatLogic.ProcessStreamingCompletion records usage tokens and dollar cost for apiKeyId", async () => {
    const key = createAPIKeyDB({
        name: "Streaming Deduction Key",
        creditLimit: 10
    });
    createdIds.push(key.id);

    const origStream = registry.chatCompletionStream;
    registry.chatCompletionStream = async function* () {
        yield {
            id: "chatcmpl-mock",
            object: "chat.completion.chunk",
            created: Date.now(),
            model: "openai_codex/gpt-4o",
            choices: [{ index: 0, delta: { content: "Hello" } }]
        };
        yield {
            id: "chatcmpl-mock",
            object: "chat.completion.chunk",
            created: Date.now(),
            model: "openai_codex/gpt-4o",
            choices: [{ index: 0, delta: {} }],
            usage: {
                prompt_tokens: 200,
                completion_tokens: 100,
                total_tokens: 300
            }
        };
    };

    try {
        const stream = ChatLogic.ProcessStreamingCompletion(
            {
                model: "openai_codex/gpt-4o",
                messages: [{ role: "user", content: "Hi" }],
                stream: true
            },
            Date.now(),
            0,
            key.id
        );

        for await (const _ of stream) {
            // consume stream
        }

        const updated = getAPIKeyByKeyDB(key.key);
        assert.ok(updated);
        assert.equal(updated?.usageTokens, 300);
        assert.ok((updated?.usageCost ?? 0) > 0, "Streaming usage cost should be greater than 0");
    } finally {
        registry.chatCompletionStream = origStream;
    }
});
