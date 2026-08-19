import test from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { chatRoute } from "../src/routes/v1/chat.js";
import { modelsRoute } from "../src/routes/v1/models.js";
import { providersRoute } from "../src/routes/v1/providers.js";
import { registry } from "../src/services/registry.js";
import type { AIProvider, ChatCompletionRequest, ChatCompletionResponse } from "@srouter/types";
import { deleteLogsByProviderDB } from "@srouter/db";

test("OpenCode Compatibility - supports both /v1 and root endpoints", async (t) => {
    const mockProviderId = "opencode_mock_provider";
    const mockModelId = "opencode_mock_provider/test-model";

    const mockProvider: AIProvider = {
        id: mockProviderId,
        name: "OpenCode Mock Provider",
        listModels: async () => [{ id: mockModelId, object: "model" }],
        chatCompletion: async (req: ChatCompletionRequest): Promise<ChatCompletionResponse> => {
            return {
                id: "chatcmpl-mock-opencode",
                object: "chat.completion",
                created: Date.now(),
                model: req.model,
                choices: [
                    {
                        index: 0,
                        message: {
                            role: "assistant",
                            content: "SRouter siap digunakan!"
                        },
                        finish_reason: "stop"
                    }
                ],
                usage: {
                    prompt_tokens: 10,
                    completion_tokens: 10,
                    total_tokens: 20
                }
            };
        },
        chatCompletionStream: async function* () {}
    };

    registry.registerProvider(mockProvider);

    t.after(() => {
        deleteLogsByProviderDB(mockProviderId);
        registry.unregisterProvider(mockProviderId);
    });

    const app = new Hono();
    app.route("/v1", modelsRoute);
    app.route("/v1", chatRoute);
    app.route("/v1", providersRoute);
    app.route("/", chatRoute);
    app.route("/", modelsRoute);
    app.route("/", providersRoute);

    // 1. Test GET /models and /v1/models without auth
    const modelsRes = await app.fetch(
        new Request("http://localhost:3000/models", {
            method: "GET"
        })
    );
    assert.equal(modelsRes.status, 200);

    const v1ModelsRes = await app.fetch(
        new Request("http://localhost:3000/v1/models", {
            method: "GET"
        })
    );
    assert.equal(v1ModelsRes.status, 200);

    // 2. Test GET /providers and /v1/providers without auth
    const providersRes = await app.fetch(
        new Request("http://localhost:3000/providers", {
            method: "GET"
        })
    );
    assert.equal(providersRes.status, 200);

    // 3. Test POST /v1/chat/completions (/v1 level)
    const chatRes = await app.fetch(
        new Request("http://localhost:3000/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: "Bearer sk-local-srouter"
            },
            body: JSON.stringify({
                model: mockModelId,
                messages: [
                    {
                        role: "user",
                        content: "Halo SRouter, tolong jawab singkat 'SRouter siap digunakan!'"
                    }
                ]
            })
        })
    );
    assert.equal(chatRes.status, 200);
    const chatBody = (await chatRes.json()) as ChatCompletionResponse;
    assert.equal(chatBody.choices[0].message.content, "SRouter siap digunakan!");

    // 4. Test POST /chat/completions (root level)
    const rootChatRes = await app.fetch(
        new Request("http://localhost:3000/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: "Bearer sk-local-srouter"
            },
            body: JSON.stringify({
                model: mockModelId,
                messages: [
                    {
                        role: "user",
                        content: "Halo SRouter root endpoint"
                    }
                ]
            })
        })
    );
    assert.equal(rootChatRes.status, 200);
    const rootChatBody = (await rootChatRes.json()) as ChatCompletionResponse;
    assert.equal(rootChatBody.choices[0].message.content, "SRouter siap digunakan!");
});
