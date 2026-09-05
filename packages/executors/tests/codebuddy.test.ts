import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type { ChatCompletionRequest } from "@srouter/types";
import { CODEBUDDY_MODELS } from "@srouter/constants";
import { CodeBuddyExecutor } from "../src/codebuddy.js";

const originalFetch = globalThis.fetch;
const fixtureKey = "codebuddy-test-token-12345";

function executor(options = {}): CodeBuddyExecutor {
    return new CodeBuddyExecutor({
        id: "codebuddy",
        name: "CodeBuddy",
        apiKey: fixtureKey,
        ...options
    });
}

function request(model: string, extra: Record<string, unknown> = {}): ChatCompletionRequest {
    return {
        model,
        messages: [{ role: "user", content: "hello world" }],
        ...extra
    };
}

afterEach(() => {
    globalThis.fetch = originalFetch;
});

test("CodeBuddy lists all catalog models namespaced with codebuddy/", async () => {
    const models = await executor().listModels();
    assert.equal(models.length, CODEBUDDY_MODELS.length);
    assert.equal(models[0]?.id, `codebuddy/${CODEBUDDY_MODELS[0]?.id}`);
    assert.equal(models[0]?.owned_by, "codebuddy");
    assert.ok(models.some((m) => m.id === "codebuddy/glm-5.2"));
    assert.ok(models.some((m) => m.id === "codebuddy/deepseek-v3"));
    assert.ok(models.some((m) => m.id === "codebuddy/gpt-5.5"));
});

test("CodeBuddy transforms chat request: forces stream, wraps user message in typed blocks, and prepends system prompt", async () => {
    let url = "";
    let headers: Headers | undefined;
    let body: Record<string, unknown> | undefined;

    const chunk = {
        id: "chatcmpl-cb-1",
        object: "chat.completion.chunk",
        created: 1700000000,
        model: "glm-5.2",
        choices: [
            {
                index: 0,
                delta: { content: "Hello! How can I help you?" },
                finish_reason: "stop"
            }
        ]
    };

    globalThis.fetch = async (input, init) => {
        url = String(input);
        headers = new Headers(init?.headers);
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;

        const stream = new ReadableStream({
            start(controller) {
                controller.enqueue(
                    new TextEncoder().encode(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`)
                );
                controller.close();
            }
        });
        return new Response(stream, {
            status: 200,
            headers: { "Content-Type": "text/event-stream" }
        });
    };

    const res = await executor().chatCompletion(
        request("codebuddy/glm-5.2", {
            messages: [
                { role: "system", content: "Original system message that should be filtered" },
                { role: "user", content: "Write some code" }
            ],
            reasoning_effort: "high"
        })
    );

    assert.equal(url, "https://www.codebuddy.ai/v2/chat/completions");
    assert.equal(headers?.get("authorization"), `Bearer ${fixtureKey}`);
    assert.equal(headers?.get("user-agent"), "IDE/2.108.1 CodeBuddy/2.108.1");
    assert.equal(headers?.get("x-product"), "SaaS");
    assert.equal(headers?.get("x-codebuddy-request"), "1");

    assert.equal(body?.model, "glm-5.2");
    assert.equal(body?.stream, true);
    assert.equal(body?.reasoning_summary, "auto");

    const messages = body?.messages as Array<{ role: string; content: unknown }>;
    assert.equal(messages.length, 2);
    assert.deepEqual(messages[0], { role: "system", content: "You are CodeBuddy Code.\n\nOriginal system message that should be filtered" });
    assert.deepEqual(messages[1], {
        role: "user",
        content: [{ type: "text", text: "Write some code" }]
    });

    assert.equal(res.choices[0]?.message.content, "Hello! How can I help you?");
    assert.equal(res.choices[0]?.finish_reason, "stop");
});

test("CodeBuddy CN sends requests to Tencent with the CN CLI identity", async () => {
    let url = "";
    let headers: Headers | undefined;
    globalThis.fetch = async (input, init) => {
        url = String(input);
        headers = new Headers(init?.headers);
        const stream = new ReadableStream({
            start(controller) {
                controller.enqueue(
                    new TextEncoder().encode(
                        'data: {"id":"cn","object":"chat.completion.chunk","created":1,"model":"glm-5.2","choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'
                    )
                );
                controller.close();
            }
        });
        return new Response(stream, {
            status: 200,
            headers: { "Content-Type": "text/event-stream" }
        });
    };

    await executor({
        baseUrl: "https://copilot.tencent.com/v2/chat/completions",
        domain: "www.codebuddy.cn",
        userAgent: "CLI/2.96.0 CodeBuddy/2.96.0",
        flavor: "cli" as const,
        modelPrefix: "codebuddy-cn"
    }).chatCompletion(request("codebuddy-cn/glm-5.2"));

    assert.equal(url, "https://copilot.tencent.com/v2/chat/completions");
    assert.equal(headers?.get("x-domain"), "www.codebuddy.cn");
    assert.equal(headers?.get("user-agent"), "CLI/2.96.0 CodeBuddy/2.96.0");
    assert.equal(headers?.get("x-ide-type"), "CLI");
    assert.equal(headers?.get("x-ide-name"), "CLI");
    assert.equal(headers?.get("x-codebuddy-request"), "1");
});

test("CodeBuddy removes reasoning_effort when set to none or off", async () => {
    let body: Record<string, unknown> | undefined;

    globalThis.fetch = async (_input, init) => {
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        const chunk = {
            id: "chatcmpl-cb-2",
            object: "chat.completion.chunk",
            created: 1700000000,
            model: "glm-5.2",
            choices: [{ index: 0, delta: { content: "ok" }, finish_reason: "stop" }]
        };
        const stream = new ReadableStream({
            start(controller) {
                controller.enqueue(
                    new TextEncoder().encode(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`)
                );
                controller.close();
            }
        });
        return new Response(stream, {
            status: 200,
            headers: { "Content-Type": "text/event-stream" }
        });
    };

    await executor().chatCompletion(
        request("codebuddy/glm-5.2", {
            reasoning_effort: "none"
        })
    );

    assert.equal(body?.reasoning_effort, undefined);
    assert.equal(body?.reasoning_summary, undefined);
});

test("CodeBuddy streaming yields ChatCompletionChunk elements correctly", async () => {
    const chunk = {
        id: "chunk-stream-1",
        object: "chat.completion.chunk",
        created: 1,
        model: "deepseek-v3",
        choices: [
            {
                index: 0,
                delta: { content: "Stream chunk from CodeBuddy" },
                finish_reason: null
            }
        ]
    };

    globalThis.fetch = async () => {
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
    for await (const item of executor().chatCompletionStream(request("codebuddy/deepseek-v3"))) {
        output.push(item);
    }

    assert.deepEqual(output, [chunk]);
});

test("CodeBuddy upstream errors do not expose credentials", async () => {
    globalThis.fetch = async () => new Response("CodeBuddy 11101 error message", { status: 400 });
    await assert.rejects(
        executor().chatCompletion(request("codebuddy/glm-5.2")),
        (error: Error) =>
            error.message.includes("400") &&
            error.message.includes("CodeBuddy Provider Error") &&
            !error.message.includes(fixtureKey)
    );
});
