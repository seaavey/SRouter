import assert from "node:assert/strict";
import { test } from "node:test";
import {
    AnthropicToOpenAIRequest,
    OpenAIToAnthropicResponse,
    OpenAIToAnthropicStream
} from "../src/anthropic.js";
import type {
    AnthropicMessageRequest,
    ChatCompletionChunk,
    ChatCompletionResponse
} from "@srouter/types";

test("anthropicToOpenAIRequest maps system string, messages, and tools", () => {
    const req: AnthropicMessageRequest = {
        model: "claude-3-7-sonnet-20250219",
        system: "You are a helpful coding assistant.",
        max_tokens: 4096,
        messages: [
            {
                role: "user",
                content: "Run test suite"
            },
            {
                role: "assistant",
                content: [
                    {
                        type: "tool_use",
                        id: "call_123",
                        name: "bash",
                        input: { command: "pnpm test" }
                    }
                ]
            },
            {
                role: "user",
                content: [
                    {
                        type: "tool_result",
                        tool_use_id: "call_123",
                        content: "Tests passed: 20"
                    }
                ]
            }
        ],
        tools: [
            {
                name: "bash",
                description: "Execute a bash command",
                input_schema: {
                    type: "object",
                    properties: { command: { type: "string" } },
                    required: ["command"]
                }
            }
        ]
    };

    const openAIReq = AnthropicToOpenAIRequest(req);
    assert.equal(openAIReq.model, "claude-3-7-sonnet-20250219");
    assert.equal(openAIReq.max_tokens, 4096);
    assert.equal(openAIReq.messages.length, 4);

    // System message
    assert.equal(openAIReq.messages[0]?.role, "system");
    assert.equal(openAIReq.messages[0]?.content, "You are a helpful coding assistant.");

    // User message
    assert.equal(openAIReq.messages[1]?.role, "user");
    assert.equal(openAIReq.messages[1]?.content, "Run test suite");

    // Assistant tool_calls
    assert.equal(openAIReq.messages[2]?.role, "assistant");
    assert.equal(openAIReq.messages[2]?.tool_calls?.length, 1);
    assert.equal(openAIReq.messages[2]?.tool_calls?.[0]?.id, "call_123");
    assert.equal(openAIReq.messages[2]?.tool_calls?.[0]?.function.name, "bash");
    assert.equal(
        openAIReq.messages[2]?.tool_calls?.[0]?.function.arguments,
        '{"command":"pnpm test"}'
    );

    // Tool result
    assert.equal(openAIReq.messages[3]?.role, "tool");
    assert.equal(openAIReq.messages[3]?.tool_call_id, "call_123");
    assert.equal(openAIReq.messages[3]?.content, "Tests passed: 20");

    // Tools schema
    assert.equal(openAIReq.tools?.length, 1);
    assert.equal(openAIReq.tools?.[0]?.function.name, "bash");
    assert.deepEqual(openAIReq.tools?.[0]?.function.parameters, {
        type: "object",
        properties: { command: { type: "string" } },
        required: ["command"]
    });
});

test("openAIToAnthropicResponse maps OpenAI response to Anthropic message format", () => {
    const openAIRes: ChatCompletionResponse = {
        id: "chatcmpl-test-123",
        object: "chat.completion",
        created: 1786759000,
        model: "claude-3-7-sonnet-20250219",
        choices: [
            {
                index: 0,
                message: {
                    role: "assistant",
                    content: "I ran the tests.",
                    tool_calls: [
                        {
                            id: "call_abc",
                            type: "function",
                            function: {
                                name: "read_file",
                                arguments: '{"path":"main.ts"}'
                            }
                        }
                    ]
                },
                finish_reason: "tool_calls"
            }
        ],
        usage: {
            prompt_tokens: 150,
            completion_tokens: 45,
            total_tokens: 195
        }
    };

    const antRes = OpenAIToAnthropicResponse(openAIRes, "claude-3-7-sonnet-20250219");
    assert.equal(antRes.type, "message");
    assert.equal(antRes.role, "assistant");
    assert.equal(antRes.stop_reason, "tool_use");
    assert.equal(antRes.content.length, 2);

    assert.equal(antRes.content[0]?.type, "text");
    assert.equal(antRes.content[0]?.text, "I ran the tests.");

    assert.equal(antRes.content[1]?.type, "tool_use");
    assert.equal(antRes.content[1]?.id, "call_abc");
    assert.equal(antRes.content[1]?.name, "read_file");
    assert.deepEqual(antRes.content[1]?.input, { path: "main.ts" });

    assert.equal(antRes.usage.input_tokens, 150);
    assert.equal(antRes.usage.output_tokens, 45);
});

test("openAIToAnthropicStream translates streaming chunks into Anthropic SSE events", async () => {
    async function* mockStream(): AsyncGenerator<ChatCompletionChunk> {
        yield {
            id: "chatcmpl-stream-1",
            object: "chat.completion.chunk",
            created: 1786759000,
            model: "claude-3-7-sonnet-20250219",
            choices: [
                {
                    index: 0,
                    delta: { role: "assistant", content: "Hello " },
                    finish_reason: null
                }
            ],
            usage: { prompt_tokens: 20, completion_tokens: 0, total_tokens: 20 }
        };
        yield {
            id: "chatcmpl-stream-1",
            object: "chat.completion.chunk",
            created: 1786759000,
            model: "claude-3-7-sonnet-20250219",
            choices: [
                {
                    index: 0,
                    delta: { content: "world!" },
                    finish_reason: null
                }
            ]
        };
        yield {
            id: "chatcmpl-stream-1",
            object: "chat.completion.chunk",
            created: 1786759000,
            model: "claude-3-7-sonnet-20250219",
            choices: [
                {
                    index: 0,
                    delta: {},
                    finish_reason: "stop"
                }
            ]
        };
    }

    const events: unknown[] = [];
    for await (const event of OpenAIToAnthropicStream(mockStream(), "claude-3-7-sonnet-20250219")) {
        events.push(event);
    }

    assert.equal(events.length, 7);
    assert.equal((events[0] as { type: string }).type, "message_start");
    assert.equal((events[1] as { type: string }).type, "content_block_start");
    assert.equal((events[2] as { type: string; delta: { text: string } }).delta.text, "Hello ");
    assert.equal((events[3] as { type: string; delta: { text: string } }).delta.text, "world!");
    assert.equal((events[4] as { type: string }).type, "content_block_stop");
    assert.equal(
        (events[5] as { type: string; delta: { stop_reason: string } }).delta.stop_reason,
        "end_turn"
    );
    assert.equal((events[6] as { type: string }).type, "message_stop");
});
