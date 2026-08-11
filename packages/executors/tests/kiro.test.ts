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
