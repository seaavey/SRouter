import assert from "node:assert/strict";
import { test } from "node:test";
import { KiroExecutor } from "../src/kiro.ts";

const encoder = new TextEncoder();

function crc32(bytes: Uint8Array): number {
    let crc = 0xffffffff;
    for (const byte of bytes) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function eventFrame(eventType: string, payload: unknown): Uint8Array {
    const headerName = encoder.encode(":event-type");
    const headerValue = encoder.encode(eventType);
    const headers = new Uint8Array(1 + headerName.length + 1 + 2 + headerValue.length);
    let offset = 0;
    headers[offset++] = headerName.length;
    headers.set(headerName, offset);
    offset += headerName.length;
    headers[offset++] = 7; // string header value
    new DataView(headers.buffer).setUint16(offset, headerValue.length, false);
    offset += 2;
    headers.set(headerValue, offset);

    const body = encoder.encode(JSON.stringify(payload));
    const totalLength = 12 + headers.length + body.length + 4;
    const frame = new Uint8Array(totalLength);
    const view = new DataView(frame.buffer);
    view.setUint32(0, totalLength, false);
    view.setUint32(4, headers.length, false);
    view.setUint32(8, crc32(frame.subarray(0, 8)), false);
    frame.set(headers, 12);
    frame.set(body, 12 + headers.length);
    view.setUint32(totalLength - 4, crc32(frame.subarray(0, totalLength - 4)), false);
    return frame;
}

function responseFromFrames(frames: Uint8Array[]): Response {
    const bytes = new Uint8Array(frames.reduce((sum, frame) => sum + frame.length, 0));
    let offset = 0;
    for (const frame of frames) {
        bytes.set(frame, offset);
        offset += frame.length;
    }
    return new Response(bytes, { status: 200 });
}

function streamResponse(frames: Uint8Array[]): { response: Response; release: () => void } {
    let release = (): void => {};
    const wait = new Promise<void>((resolve) => { release = resolve; });
    const body = new ReadableStream<Uint8Array>({
        async start(controller) {
            controller.enqueue(frames[0]!);
            await wait;
            for (const frame of frames.slice(1)) controller.enqueue(frame);
            controller.close();
        },
    });
    return { response: new Response(body, { status: 200 }), release };
}

test("Kiro API-key auth routes Amazon Q first and regionalizes AWS endpoints", () => {
    const executor = new KiroExecutor({ accessToken: "key", authMethod: "api_key", region: "eu-west-1" });
    assert.deepEqual(executor.getOrderedBaseUrls(), [
        "https://q.eu-west-1.amazonaws.com/generateAssistantResponse",
        "https://codewhisperer.eu-west-1.amazonaws.com/generateAssistantResponse",
        "https://runtime.us-east-1.kiro.dev/generateAssistantResponse",
    ]);
});

test("Kiro request contains CodeWhisperer conversation state and API-key profile rules", () => {
    const executor = new KiroExecutor({ accessToken: "key", authMethod: "api_key" });
    const body = executor.buildRequest({
        model: "claude-sonnet-4.5",
        messages: [
            { role: "system", content: "Be concise" },
            { role: "user", content: "hello" },
        ],
        tools: [{ type: "function", function: { name: "lookup", description: "Find it", parameters: { type: "object" } } }],
    });

    assert.equal(body.conversationState.currentMessage.userInputMessage.modelId, "claude-sonnet-4.5");
    assert.equal(body.conversationState.currentMessage.userInputMessage.content, "hello");
    assert.equal(body.conversationState.history[0].userInputMessage.content, "<instructions>\nBe concise\n</instructions>");
    assert.equal(body.conversationState.currentMessage.userInputMessage.userInputMessageContext.tools[0].toolSpecification.name, "lookup");
    assert.equal(body.profileArn, undefined);
});

test("Kiro auth modes send the documented bearer and token-type headers", async () => {
    const originalFetch = globalThis.fetch;
    const cases = [
        ["api_key", "API_KEY"],
        ["external_idp", "EXTERNAL_IDP"],
        ["idc", null],
        ["builder-id", null],
        ["social", null],
    ] as const;
    try {
        for (const [authMethod, expectedTokenType] of cases) {
            let captured = new Headers();
            globalThis.fetch = async (_input, init) => {
                captured = new Headers(init?.headers);
                return responseFromFrames([eventFrame("messageStopEvent", { stopReason: "END_TURN" })]);
            };
            const executor = new KiroExecutor({
                accessToken: "token",
                authMethod,
                baseUrl: "https://example.com/generateAssistantResponse",
            });
            for await (const _chunk of executor.chatCompletionStream({
                model: "kiro/simple-task",
                messages: [{ role: "user", content: "hi" }],
            })) { /* drain */ }
            assert.equal(captured.get("Authorization"), "Bearer token", authMethod);
            assert.equal(captured.get("TokenType"), expectedTokenType, authMethod);
        }
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test("Kiro EventStream becomes OpenAI chunks with text and stop reason", async () => {
    const originalFetch = globalThis.fetch;
    const executor = new KiroExecutor({ accessToken: "token", authMethod: "builder-id" });
    const frames = [
        eventFrame("assistantResponseEvent", { content: "hello" }),
        eventFrame("messageStopEvent", { stopReason: "END_TURN" }),
    ];
    globalThis.fetch = async () => responseFromFrames(frames);

    try {
        const chunks = [];
        for await (const chunk of executor.chatCompletionStream({ model: "kiro/claude-sonnet-4.5", messages: [{ role: "user", content: "hi" }] })) {
            chunks.push(chunk);
        }
        assert.equal(chunks[0]?.choices[0]?.delta.role, "assistant");
        assert.equal(chunks[0]?.choices[0]?.delta.content, "hello");
        assert.equal(chunks.at(-1)?.choices[0]?.finish_reason, "stop");
    } finally {
        globalThis.fetch = originalFetch;
    }
});

// Regression coverage for public Kiro behavior.
test("Kiro preserves the thinking model suffix", () => {
    const body = new KiroExecutor({ accessToken: "key", authMethod: "api_key" }).buildRequest({
        model: "kiro/claude-sonnet-4.5-thinking",
        messages: [{ role: "user", content: "think" }],
    });
    assert.equal(body.conversationState.currentMessage.userInputMessage.modelId, "claude-sonnet-4.5-thinking");
});

test("Kiro yields the first event before the upstream body closes", async () => {
    const originalFetch = globalThis.fetch;
    const streamed = streamResponse([
        eventFrame("assistantResponseEvent", { content: "early" }),
        eventFrame("messageStopEvent", { stopReason: "END_TURN" }),
    ]);
    globalThis.fetch = async () => streamed.response;
    try {
        const iterator = new KiroExecutor({ accessToken: "token" }).chatCompletionStream({
            model: "kiro/simple-task",
            messages: [{ role: "user", content: "hi" }],
        });
        const first = await Promise.race([
            iterator.next(),
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error("first chunk waited for stream close")), 100)),
        ]);
        assert.equal(first.value?.choices[0]?.delta.content, "early");
        streamed.release();
        while (!(await iterator.next()).done) { /* drain */ }
    } finally {
        streamed.release();
        globalThis.fetch = originalFetch;
    }
});

test("Kiro combines fragmented tool input for one tool call", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => responseFromFrames([
        eventFrame("toolUseEvent", { toolUseId: "call_1", name: "weather", input: "{\"city\":\"" }),
        eventFrame("toolUseEvent", { toolUseId: "call_1", input: "Paris\"}" }),
        eventFrame("messageStopEvent", { stopReason: "TOOL_USE" }),
    ]);
    try {
        const chunks = [];
        for await (const value of new KiroExecutor({ accessToken: "token" }).chatCompletionStream({
            model: "kiro/simple-task",
            messages: [{ role: "user", content: "weather" }],
        })) chunks.push(value);
        const call = chunks.flatMap((value) => value.choices[0]?.delta.tool_calls ?? [])[0];
        assert.equal(call?.function?.name, "weather");
        assert.equal(call?.function?.arguments, "{\"city\":\"Paris\"}");
    } finally {
        globalThis.fetch = originalFetch;
    }
});
