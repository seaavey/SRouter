import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type { ChatCompletionChunk, ChatCompletionRequest } from "@srouter/types";
import { ClineExecutor } from "../src/cline.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
    globalThis.fetch = originalFetch;
});

test("Cline sends hosted API headers and keeps the provider/model namespace", async () => {
    let requestUrl = "";
    let requestHeaders: Headers | undefined;
    let requestBody: Record<string, unknown> | undefined;

    globalThis.fetch = async (input, init) => {
        requestUrl = String(input);
        requestHeaders = new Headers(init?.headers);
        requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return Response.json({ id: "chatcmpl_test", choices: [] });
    };

    const request: ChatCompletionRequest = {
        model: "cline/deepseek/deepseek-v4.1-flash",
        messages: [{ role: "user", content: "Reply with exactly OK" }]
    };

    await new ClineExecutor({ apiKey: "cline_fixture_key" }).chatCompletion(request);

    assert.equal(requestUrl, "https://api.cline.bot/api/v1/chat/completions");
    assert.equal(requestHeaders?.get("authorization"), "Bearer cline_fixture_key");
    assert.equal(requestHeaders?.get("user-agent"), "Cline/3.0.62");
    assert.equal(requestHeaders?.get("x-client-type"), "cline-sdk");
    assert.equal(requestHeaders?.get("x-client-version"), "3.0.62");
    assert.equal(requestHeaders?.get("http-referer"), "https://cline.bot");
    assert.match(requestHeaders?.get("x-task-id") ?? "", /^[0-9a-f-]{36}$/);
    assert.equal(requestBody?.model, "deepseek/deepseek-v4.1-flash");
    assert.equal(requestBody?.stream, false);
});

test("Cline discovers the live model catalog with the OAuth token", async () => {
    const requestUrls: string[] = [];
    let authorization = "";
    globalThis.fetch = async (input, init) => {
        const requestUrl = String(input);
        requestUrls.push(requestUrl);
        authorization = new Headers(init?.headers).get("authorization") ?? "";
        if (requestUrl.endsWith("/recommended-models")) {
            return Response.json({ free: [{ id: "cline-free/free-model" }] });
        }
        return Response.json({ data: [{ id: "provider/model" }] });
    };

    const models = await new ClineExecutor({ accessToken: "workos:test-token" }).listModels();

    assert.deepEqual(requestUrls.sort(), [
        "https://api.cline.bot/api/v1/ai/cline/recommended-models",
        "https://api.cline.bot/api/v1/models"
    ]);
    assert.equal(authorization, "Bearer workos:test-token");
    assert.deepEqual(models, [
        { id: "cline/provider/model", object: "model", owned_by: "cline" },
        { id: "cline/cline-free/free-model", object: "model", owned_by: "cline" }
    ]);
});

test("Cline unwraps the hosted { data, success } envelope on non-streaming responses", async () => {
    globalThis.fetch = async () =>
        Response.json({
            data: {
                id: "gen_01M2Q0TFDRACJFV1QR2KXE425Y",
                object: "chat.completion",
                created: 1789626499,
                model: "deepseek/deepseek-v4.1-flash",
                choices: [
                    {
                        index: 0,
                        finish_reason: "stop",
                        message: { role: "assistant", content: "OK" }
                    }
                ],
                usage: { prompt_tokens: 141, completion_tokens: 18, total_tokens: 159 }
            },
            success: true
        });

    const response = await new ClineExecutor({ apiKey: "cline_fixture_key" }).chatCompletion({
        model: "cline/deepseek/deepseek-v4.1-flash",
        messages: [{ role: "user", content: "Reply with exactly OK" }]
    } as ChatCompletionRequest);

    assert.equal(response.choices[0]?.message.content, "OK");
    assert.equal(response.usage?.total_tokens, 159);
});

test("Cline leaves a plain OpenAI payload untouched", async () => {
    const plain = {
        id: "chatcmpl_test",
        object: "chat.completion",
        created: 1789626499,
        model: "deepseek/deepseek-v4.1-flash",
        choices: [
            {
                index: 0,
                finish_reason: "stop",
                message: { role: "assistant", content: "plain" }
            }
        ]
    };
    globalThis.fetch = async () => Response.json(plain);

    const response = await new ClineExecutor({ apiKey: "cline_fixture_key" }).chatCompletion({
        model: "cline/deepseek/deepseek-v4.1-flash",
        messages: [{ role: "user", content: "Reply with exactly OK" }]
    } as ChatCompletionRequest);

    assert.equal(response.choices[0]?.message.content, "plain");
});

test("Cline surfaces a failed { data, success } envelope as an error", async () => {
    globalThis.fetch = async () => Response.json({ data: "model not found", success: false });

    await assert.rejects(
        () =>
            new ClineExecutor({ apiKey: "cline_fixture_key" }).chatCompletion({
                model: "cline/deepseek/deepseek-v4.1-flash",
                messages: [{ role: "user", content: "Reply with exactly OK" }]
            } as ChatCompletionRequest),
        /Cline Provider Error: model not found/
    );
});

test("Cline raises SSE error frames instead of yielding them as chunks", async () => {
    const errorFrame = {
        error: {
            code: "stream_initialization_failed",
            message: "Model 'deepseek/deepseek-v3' not found",
            type: "stream_error"
        }
    };
    const sse = `data: ${JSON.stringify(errorFrame)}\n\ndata: [DONE]\n\n`;
    globalThis.fetch = async () =>
        new Response(sse, {
            status: 200,
            headers: { "Content-Type": "text/event-stream" }
        });

    const chunks: ChatCompletionChunk[] = [];
    await assert.rejects(async () => {
        const stream = new ClineExecutor({
            apiKey: "cline_fixture_key"
        }).chatCompletionStream({
            model: "cline/deepseek/deepseek-v4.1-flash",
            messages: [{ role: "user", content: "Reply with exactly OK" }],
            stream: true
        } as ChatCompletionRequest);
        for await (const chunk of stream) chunks.push(chunk);
    }, /OpenAI Provider Stream Error: Model 'deepseek\/deepseek-v3' not found \(stream_initialization_failed\)/);

    assert.equal(chunks.length, 0);
});
