import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type { ChatCompletionRequest } from "@srouter/types";
import { OpenAIExecutor } from "../src/openai.js";

const originalFetch = globalThis.fetch;
const fixtureKey = "fixture-key-not-a-secret";

function executor(): OpenAIExecutor {
    return new OpenAIExecutor({
        id: "neosantara",
        name: "Neosantara",
        baseUrl: "https://api.neosantara.xyz/v1",
        accessToken: fixtureKey,
    });
}

function request(model: string): ChatCompletionRequest {
    return { model, messages: [{ role: "user", content: "hello" }] };
}

afterEach(() => {
    globalThis.fetch = originalFetch;
});

test("Neosantara lists namespaced live models with bearer auth", async () => {
    let url = "";
    let authorized = false;
    globalThis.fetch = async (input, init) => {
        url = String(input);
        const auth = new Headers(init?.headers).get("authorization") ?? "";
        authorized = auth.startsWith("Bearer ") && auth.endsWith(fixtureKey);
        return Response.json({ data: [{ id: "garda-core", object: "model", owned_by: "neosantara" }] });
    };

    const models = await executor().listModels();
    assert.equal(url, "https://api.neosantara.xyz/v1/models");
    assert.equal(authorized, true);
    assert.deepEqual(models, [{ id: "neosantara/garda-core", object: "model", owned_by: "neosantara" }]);
});

test("Neosantara chat sends bare model and preserves nested upstream IDs", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    globalThis.fetch = async (_input, init) => {
        bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return Response.json({ id: "chat", object: "chat.completion", created: 1, model: "test", choices: [] });
    };

    await executor().chatCompletion(request("neosantara/garda-core"));
    await executor().chatCompletion(request("neosantara/provider/model-with-slash"));

    assert.equal(bodies[0]?.model, "garda-core");
    assert.equal(bodies[0]?.stream, false);
    assert.equal(bodies[1]?.model, "provider/model-with-slash");
});

test("Neosantara streaming preserves tools and yields tool-call deltas", async () => {
    let body: Record<string, unknown> | undefined;
    const chunk = {
        id: "chunk",
        object: "chat.completion.chunk",
        created: 1,
        model: "garda-core",
        choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "weather", arguments: "{}" } }] }, finish_reason: null }],
    };
    globalThis.fetch = async (_input, init) => {
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        const stream = new ReadableStream({
            start(controller) {
                controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`));
                controller.close();
            },
        });
        return new Response(stream, { headers: { "content-type": "text/event-stream" } });
    };

    const tools = [{ type: "function" as const, function: { name: "weather", description: "Weather", parameters: { type: "object", properties: {} } } }];
    const output = [];
    for await (const item of executor().chatCompletionStream({ ...request("neosantara/garda-core"), tools })) output.push(item);

    assert.equal(body?.stream, true);
    assert.deepEqual(body?.tools, tools);
    assert.deepEqual(output, [chunk]);
});

test("Neosantara upstream errors do not expose credentials", async () => {
    globalThis.fetch = async () => new Response("upstream unavailable", { status: 503 });
    await assert.rejects(
        executor().chatCompletion(request("neosantara/garda-core")),
        (error: Error) => error.message.includes("503") && error.message.includes("upstream unavailable") && !error.message.includes(fixtureKey),
    );
});
