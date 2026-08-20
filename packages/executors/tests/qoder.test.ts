import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
    buildCosyHeaders,
    isQoderPat,
    isQwenThinkingActive,
    qoderEncodeBody,
    QoderExecutor,
    sanitizeQwenThinkingToolChoice
} from "../src/qoder.js";

const originalFetch = globalThis.fetch;
const fixtureToken = "dt-fixture-token-not-a-secret";
const fixtureUserId = "user-12345";

afterEach(() => {
    globalThis.fetch = originalFetch;
});

test("qoderEncodeBody encodes plaintext into WAF-bypass format", () => {
    const plain = "Hello, world!";
    const encoded = qoderEncodeBody(plain);
    assert.equal(typeof encoded, "string");
    assert.notEqual(encoded, plain);
    assert.ok(encoded.length > 0);
});

test("buildCosyHeaders creates expected COSY signature and headers", () => {
    const body = Buffer.from('{"test": true}', "utf8");
    const url = "https://api3.qoder.sh/algo/api/v2/service/pro/sse/agent_chat_generation";
    const headers = buildCosyHeaders(body, url, {
        userId: fixtureUserId,
        authToken: fixtureToken,
        machineId: "machine-uuid-1"
    });

    assert.ok(headers["Authorization"].startsWith("Bearer COSY."));
    assert.ok(headers["Cosy-Key"]);
    assert.equal(headers["Cosy-User"], fixtureUserId);
    assert.equal(headers["Cosy-Machineid"], "machine-uuid-1");
    assert.equal(headers["Cosy-Sigpath"], "/api/v2/service/pro/sse/agent_chat_generation");
    assert.ok(headers["Cosy-Date"]);
});

test("QoderExecutor lists models with base id prefix", async () => {
    globalThis.fetch = async (input) => {
        const urlStr = String(input);
        if (urlStr.includes("/model/list")) {
            return Response.json({
                chat: [
                    { key: "ultimate", display_name: "Ultimate", enable: true },
                    { key: "qmodel_latest", display_name: "Qwen3.7-Max", enable: true }
                ]
            });
        }
        return Response.json({});
    };

    const executor = new QoderExecutor({
        id: "qoder",
        name: "Qoder",
        accessToken: fixtureToken,
        providerSpecificData: { userId: fixtureUserId }
    });

    const models = await executor.listModels();
    assert.ok(models.length >= 2);
    assert.ok(models.some((m) => m.id === "qoder/ultimate"));
    assert.ok(models.some((m) => m.id === "qoder/qmodel_latest"));
    assert.ok(models.some((m) => m.id === "qoder/qwen3.8-max-preview"));
});

test("QoderExecutor streams SSE chat and unwraps statusCodeValue envelope", async () => {
    let requestUrl = "";
    let capturedHeaders: Record<string, string> = {};
    let requestBody: unknown = null;

    const chunkData = {
        id: "chatcmpl-qoder-1",
        object: "chat.completion.chunk",
        created: 123456,
        model: "ultimate",
        choices: [
            {
                index: 0,
                delta: { content: "Hello from Qoder!" },
                finish_reason: null
            }
        ]
    };

    globalThis.fetch = async (input, init) => {
        requestUrl = String(input);
        capturedHeaders = Object.fromEntries(new Headers(init?.headers).entries());
        requestBody = init?.body;

        const envelope = JSON.stringify({
            statusCodeValue: 200,
            body: JSON.stringify(chunkData)
        });

        const sseStream = new ReadableStream({
            start(controller) {
                controller.enqueue(
                    new TextEncoder().encode(`data: ${envelope}\n\ndata: [DONE]\n\n`)
                );
                controller.close();
            }
        });

        return new Response(sseStream, {
            headers: { "Content-Type": "text/event-stream" }
        });
    };

    const executor = new QoderExecutor({
        id: "qoder",
        name: "Qoder",
        accessToken: fixtureToken,
        providerSpecificData: { userId: fixtureUserId }
    });

    const chunks = [];
    for await (const chunk of executor.chatCompletionStream({
        model: "qoder/ultimate",
        messages: [{ role: "user", content: "hi" }]
    })) {
        chunks.push(chunk);
    }

    assert.ok(requestUrl.includes("api3.qoder.sh"));
    assert.ok(requestUrl.includes("Encode=1"));
    assert.ok(capturedHeaders["authorization"]?.startsWith("Bearer COSY."));
    assert.ok(requestBody);
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0]?.choices?.[0]?.delta?.content, "Hello from Qoder!");
});

test("QoderExecutor handles PAT exchange to job token and routes to api2", async () => {
    const patToken = "pt-test-pat-token";
    const jobToken = "jt-test-job-token";
    let exchangeCalled = false;
    let userInfoCalled = false;
    let chatUrl = "";

    globalThis.fetch = async (input, init) => {
        const urlStr = String(input);
        if (urlStr.includes("/jobToken/exchange")) {
            exchangeCalled = true;
            return Response.json({ token: jobToken, expires_in: 3600 });
        }
        if (urlStr.includes("/userinfo")) {
            userInfoCalled = true;
            return Response.json({ id: "user-from-pat", email: "test@example.com" });
        }
        if (urlStr.includes("/agent_chat_generation")) {
            chatUrl = urlStr;
            const envelope = JSON.stringify({
                statusCodeValue: 200,
                body: JSON.stringify({
                    id: "cmpl-pat",
                    choices: [{ index: 0, delta: { content: "PAT success" } }]
                })
            });
            const sseStream = new ReadableStream({
                start(controller) {
                    controller.enqueue(
                        new TextEncoder().encode(`data: ${envelope}\n\ndata: [DONE]\n\n`)
                    );
                    controller.close();
                }
            });
            return new Response(sseStream, {
                headers: { "Content-Type": "text/event-stream" }
            });
        }
        return Response.json({});
    };

    assert.equal(isQoderPat(patToken), true);

    const executor = new QoderExecutor({
        id: "qoder",
        name: "Qoder",
        apiKey: patToken
    });

    const chunks = [];
    for await (const chunk of executor.chatCompletionStream({
        model: "qoder/auto",
        messages: [{ role: "user", content: "test pat" }]
    })) {
        chunks.push(chunk);
    }

    assert.equal(exchangeCalled, true);
    assert.equal(userInfoCalled, true);
    assert.ok(chatUrl.includes("api2.qoder.sh"));
    assert.equal(chunks[0]?.choices?.[0]?.delta?.content, "PAT success");
});

test("isQwenThinkingActive and sanitizeQwenThinkingToolChoice sanitize conflicting tool_choice", () => {
    const req1 = { model: "qoder/qmodel_preview", messages: [] };
    assert.equal(isQwenThinkingActive(req1, { is_reasoning: true }), true);

    const req2 = { model: "qoder/qwen", messages: [], thinking: true } as any;
    assert.equal(isQwenThinkingActive(req2), true);

    const payload: Record<string, unknown> = {
        tool_choice: "auto",
        tools: [{ type: "function", function: { name: "search" } }]
    };

    sanitizeQwenThinkingToolChoice(payload, true);
    assert.equal("tool_choice" in payload, false);
    assert.ok(Array.isArray(payload.tools));
});
