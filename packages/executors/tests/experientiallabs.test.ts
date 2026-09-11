import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type { ChatCompletionRequest } from "@srouter/types";
import { OpenAIExecutor } from "../src/openai.js";

const originalFetch = globalThis.fetch;
const fixtureKey = "xpl_fixture_key";

function executor(): OpenAIExecutor {
    return new OpenAIExecutor({
        id: "experientiallabs",
        name: "Experiential Labs",
        alias: "explabs",
        baseUrl: "https://api.experientiallabs.ai/v1",
        apiKey: fixtureKey
    });
}

function request(model: string): ChatCompletionRequest {
    return { model, messages: [{ role: "user", content: "hello" }] };
}

afterEach(() => {
    globalThis.fetch = originalFetch;
});

test("Experiential Labs lists live models with the explabs namespace", async () => {
    let requestUrl = "";
    let authorization = "";
    globalThis.fetch = async (input, init) => {
        requestUrl = String(input);
        authorization = new Headers(init?.headers).get("authorization") ?? "";
        return Response.json({ data: [{ id: "gpt-5.6-luna", object: "model" }] });
    };

    const models = await executor().listModels();

    assert.equal(requestUrl, "https://api.experientiallabs.ai/v1/models");
    assert.equal(authorization, `Bearer ${fixtureKey}`);
    assert.deepEqual(models, [
        { id: "explabs/gpt-5.6-luna", object: "model", owned_by: "explabs" }
    ]);
});

test("Experiential Labs sends a bare model slug to Chat Completions", async () => {
    let body: Record<string, unknown> | undefined;
    globalThis.fetch = async (_input, init) => {
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return Response.json({
            id: "chatcmpl_test",
            object: "chat.completion",
            created: 1,
            model: "gpt-5.6-luna",
            choices: []
        });
    };

    await executor().chatCompletion(request("explabs/gpt-5.6-luna"));

    assert.equal(body?.model, "gpt-5.6-luna");
    assert.equal(body?.stream, false);
});

test("Experiential Labs streaming preserves usage chunks", async () => {
    const usage = {
        prompt_tokens: 2,
        completion_tokens: 1,
        total_tokens: 3
    };
    globalThis.fetch = async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        assert.equal(body.model, "gpt-5.6-luna");
        const chunk = {
            id: "chatcmpl_test",
            object: "chat.completion.chunk",
            created: 1,
            model: "gpt-5.6-luna",
            choices: [],
            usage
        };
        const stream = new ReadableStream({
            start(controller) {
                controller.enqueue(
                    new TextEncoder().encode(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`)
                );
                controller.close();
            }
        });
        return new Response(stream, { headers: { "content-type": "text/event-stream" } });
    };

    const output = [];
    for await (const chunk of executor().chatCompletionStream(request("explabs/gpt-5.6-luna"))) {
        output.push(chunk);
    }

    assert.deepEqual(output[0]?.usage, usage);
});
