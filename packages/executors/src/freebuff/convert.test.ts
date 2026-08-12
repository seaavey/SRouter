import assert from "node:assert/strict";
import test from "node:test";
import type { ChatCompletionChunk } from "@srouter/types";
import {
    accumulateChunk,
    createAccumulator,
    finishAccumulator,
    normalizeRequest,
    removeFreebuffModelPrefix,
    sanitizeSseLine,
    withFreebuffModelPrefix,
    type FreebuffRequestInput,
} from "./convert.js";

type ChatMessageWithReasoning = { reasoning_content?: string };

test("normalizes allowlisted request fields and developer role", () => {
    const input: FreebuffRequestInput = {
        model: "freebuff/deepseek/deepseek-v4-flash",
        messages: [{ role: "developer", content: "be concise" }, { role: "user", content: "hi" }],
        temperature: 0.2,
        max_tokens: 20,
        stream: true,
        n: 2,
        bogus: "drop me",
    };
    const output = normalizeRequest(input);
    assert.equal(output.model, input.model);
    assert.equal(output.temperature, 0.2);
    assert.equal(output.max_tokens, 20);
    assert.equal("stream" in output, false);
    assert.equal("n" in output, false);
    assert.equal("bogus" in output, false);
    assert.equal(output.messages[0]?.role, "system");
});

test("resolves nested refs and removes nullable schema noise", () => {
    const input: FreebuffRequestInput = {
        model: "m",
        messages: [],
        tools: [{
            type: "function",
            function: {
                name: "lookup",
                parameters: {
                    type: "object",
                    properties: { value: { $ref: "#/$defs/Value" } },
                    $defs: { Value: { anyOf: [{ type: "string" }, { type: "null" }], nullable: true } },
                },
            },
        }],
    };
    const normalized = normalizeRequest(input);
    const tools = normalized.tools;
    assert.ok(Array.isArray(tools));
    const tool = tools[0];
    assert.ok(tool && typeof tool === "object" && !Array.isArray(tool));
    const functionValue = tool.function;
    assert.ok(functionValue && typeof functionValue === "object" && !Array.isArray(functionValue));
    const parameters = functionValue.parameters;
    assert.deepEqual(parameters, { type: "object", properties: { value: { type: "string" } } });
});

test("drops malformed SSE and preserves reasoning and usage", () => {
    assert.equal(sanitizeSseLine("data: {bad"), null);
    assert.equal(sanitizeSseLine("event: message"), null);
    const chunk = sanitizeSseLine('data: {"id":"c1","choices":[{"index":0,"delta":{"content":"x","reasoning_content":"think"},"finish_reason":null}]}');
    assert.equal(chunk?.choices[0]?.delta.content, "x");
    assert.equal(chunk?.choices[0]?.delta.reasoning_content, "think");
    const usage = sanitizeSseLine('data: {"usage":{"prompt_tokens":1,"completion_tokens":2,"total_tokens":3}}');
    assert.deepEqual(usage?.usage, { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 });
    const toolChunk = sanitizeSseLine('data: {"system_fingerprint":"fp","choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"search","arguments":"{\\"q\\":\\""}}]}}]}');
    assert.equal(toolChunk?.system_fingerprint, "fp");
    assert.deepEqual(toolChunk?.choices[0]?.delta.tool_calls?.[0]?.function, { name: "search", arguments: '{"q":"' });
    assert.equal(sanitizeSseLine("data: [DONE]"), null);
});

test("accumulates non-stream content, reasoning, tool fragments, usage, and finish reason", () => {
    const accumulator = createAccumulator();
    const chunks: ChatCompletionChunk[] = [
        { id: "c1", object: "chat.completion.chunk", created: 10, model: "upstream", choices: [{ index: 0, delta: { content: "Hello", reasoning_content: "think " }, finish_reason: null }] },
        { id: "c1", object: "chat.completion.chunk", created: 10, model: "upstream", choices: [{ index: 0, delta: { content: " world", reasoning_content: "step", tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "search", arguments: "{\"q\":\"" } }] }, finish_reason: null }] },
        { id: "c1", object: "chat.completion.chunk", created: 10, model: "upstream", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: "x\"}" } }] }, finish_reason: "tool_calls" }] },
        { id: "c1", object: "chat.completion.chunk", created: 10, model: "upstream", choices: [], usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 } },
    ];
    for (const chunk of chunks) accumulateChunk(accumulator, chunk);
    const response = finishAccumulator(accumulator, "freebuff/deepseek/deepseek-v4-flash");
    assert.equal(response.model, "freebuff/deepseek/deepseek-v4-flash");
    assert.equal(response.choices[0]?.message.content, "Hello world");
    assert.equal((response.choices[0]?.message as ChatMessageWithReasoning).reasoning_content, "think step");
    assert.equal(response.choices[0]?.finish_reason, "tool_calls");
    assert.deepEqual(response.choices[0]?.message.tool_calls?.[0]?.function, { name: "search", arguments: '{"q":"x"}' });
    assert.deepEqual(response.usage, { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 });
});

test("preserves nested model IDs while changing only exact prefix", () => {
    assert.equal(removeFreebuffModelPrefix("freebuff/deepseek/deepseek-v4-flash"), "deepseek/deepseek-v4-flash");
    assert.equal(removeFreebuffModelPrefix("other/freebuff/model"), "other/freebuff/model");
    assert.equal(withFreebuffModelPrefix("deepseek/deepseek-v4-flash"), "freebuff/deepseek/deepseek-v4-flash");
});

test("preserves a non-standard legacy finish reason at the SRouter response boundary", () => {
    const chunk = sanitizeSseLine('data: {"choices":[{"delta":{},"finish_reason":"legacy_complete"}]}');
    assert.equal(chunk?.choices[0]?.finish_reason, "legacy_complete");
    const accumulator = createAccumulator();
    if (chunk) accumulateChunk(accumulator, chunk);
    const response = finishAccumulator(accumulator, "m");
    assert.equal(response.choices[0]?.finish_reason, null);
    assert.equal(response.choices[0]?.legacy_finish_reason, "legacy_complete");
});

test("returns zero usage and stop for an empty accumulator", () => {
    const response = finishAccumulator(createAccumulator(), "m");
    assert.equal(response.choices[0]?.finish_reason, "stop");
    assert.deepEqual(response.usage, { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });
});
