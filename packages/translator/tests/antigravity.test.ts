import assert from "node:assert/strict";
import { test } from "node:test";
import {
    buildAntigravityContents,
    buildAntigravityEnvelope,
    buildAntigravityTools,
    cleanJSONSchemaForAntigravity,
    createGeminiStreamState,
    geminiStreamToOpenAIChunks,
    geminiToOpenAIResponse,
    getAntigravityModelFallbacks,
    parseAntigravityModelName,
    parseAntigravityTextualToolCall,
    parseRetryFromErrorMessage,
    resolveAntigravityOutputCap,
    stripCompetitiveAgentPrompts,
    stripTrailingAssistantTurn,
    stripZeroWidth
} from "../src/antigravity.js";
import type { ChatCompletionRequest } from "@srouter/types";

test("buildAntigravityContents produces valid parts without empty text in oneof functionCall / functionResponse", () => {
    const req: ChatCompletionRequest = {
        model: "antigravity/gemini-2.5-pro",
        messages: [
            { role: "user", content: "What is the weather in Tokyo?" },
            {
                role: "assistant",
                content: null,
                tool_calls: [
                    {
                        id: "call_weather_1",
                        type: "function",
                        function: {
                            name: "get_weather",
                            arguments: JSON.stringify({ location: "Tokyo" })
                        }
                    }
                ]
            },
            {
                role: "tool",
                tool_call_id: "call_weather_1",
                content: JSON.stringify({ temperature: "22C", condition: "Sunny" })
            }
        ]
    };

    const contents = buildAntigravityContents(req);
    assert.equal(contents.length, 3);

    // 1. User message
    assert.equal(contents[0]?.role, "user");
    assert.equal(contents[0]?.parts[0]?.text, "What is the weather in Tokyo?");

    // 2. Assistant message with functionCall
    assert.equal(contents[1]?.role, "model");
    const modelPart = contents[1]?.parts[0];
    assert.ok(modelPart?.functionCall);
    assert.equal(modelPart.functionCall.name, "get_weather");
    assert.deepEqual(modelPart.functionCall.args, { location: "Tokyo" });
    // Verify text is undefined (not empty string) to satisfy protobuf oneof constraint
    assert.equal(modelPart.text, undefined);
    assert.equal(Object.prototype.hasOwnProperty.call(modelPart, "text"), false);

    // 3. Tool response message with functionResponse
    assert.equal(contents[2]?.role, "user");
    const toolPart = contents[2]?.parts[0];
    assert.ok(toolPart?.functionResponse);
    assert.equal(toolPart.functionResponse.name, "get_weather");
    assert.deepEqual(toolPart.functionResponse.response, {
        temperature: "22C",
        condition: "Sunny"
    });
    // Verify text is undefined (not empty string) to satisfy protobuf oneof constraint
    assert.equal(toolPart.text, undefined);
    assert.equal(Object.prototype.hasOwnProperty.call(toolPart, "text"), false);
});

test("cleanJSONSchemaForAntigravity fills missing array items", () => {
    const cleaned = cleanJSONSchemaForAntigravity({
        type: "object",
        properties: {
            choices: { type: "array", description: "Options" },
            tasks: { type: "ARRAY" },
            todos: {
                type: "array",
                prefixItems: [{ type: "object", properties: { id: { type: "string" } } }]
            },
            region: { type: "array", contains: { type: "number" } },
            nested: {
                type: "object",
                properties: { tags: { type: "array" } }
            },
            keep: { type: "array", items: { type: "number" } }
        }
    }) as Record<string, Record<string, Record<string, unknown>>>;

    const props = cleaned.properties;
    assert.deepEqual(props.choices?.items, { type: "string" });
    assert.deepEqual(props.tasks?.items, { type: "string" });
    assert.deepEqual(props.todos?.items, {
        type: "object",
        properties: { id: { type: "string" } }
    });
    assert.equal(Object.prototype.hasOwnProperty.call(props.todos ?? {}, "prefixItems"), false);
    assert.deepEqual(props.region?.items, { type: "number" });
    assert.deepEqual(
        (props.nested?.properties as Record<string, Record<string, unknown>>)?.tags?.items,
        { type: "string" }
    );
    assert.deepEqual(props.keep?.items, { type: "number" });
});

test("buildAntigravityTools emits array items for every declaration", () => {
    const req: ChatCompletionRequest = {
        model: "antigravity/gemini-3.7-flash-high",
        messages: [{ role: "user", content: "hi" }],
        tools: [
            {
                type: "function",
                function: {
                    name: "clarify",
                    description: "Ask a question",
                    parameters: {
                        type: "object",
                        properties: { choices: { type: "array" } },
                        required: ["choices"]
                    }
                }
            }
        ]
    } as ChatCompletionRequest;

    const tools = buildAntigravityTools(req);
    const declarations = tools[0]?.functionDeclarations as Array<{
        parameters: { properties: Record<string, Record<string, unknown>> };
    }>;
    assert.equal(declarations.length, 1);
    assert.deepEqual(declarations[0]?.parameters.properties.choices?.items, { type: "string" });
});

test("parseAntigravityModelName maps public ids to CloudCode internal ids", () => {
    assert.equal(
        parseAntigravityModelName("antigravity/gemini-3.7-flash-high"),
        "gemini-3.7-flash-tiered"
    );
    assert.equal(parseAntigravityModelName("gemini-3.7-flash-medium"), "gemini-3.7-flash-tiered");
    assert.equal(parseAntigravityModelName("gemini-3.7-flash-low"), "gemini-3.7-flash-tiered");
    assert.equal(parseAntigravityModelName("gemini-3.5-flash-high"), "gemini-3-flash-agent");
    assert.equal(parseAntigravityModelName("gemini-3.1-pro-high"), "gemini-pro-agent");
    assert.equal(parseAntigravityModelName("gemini-3.5-flash-medium"), "gemini-3.5-flash-low");
    assert.equal(parseAntigravityModelName("gemini-3.5-flash-low"), "gemini-3.5-flash-extra-low");
    // pass-through
    assert.equal(
        parseAntigravityModelName("antigravity/gemini-3.6-flash-high"),
        "gemini-3.6-flash-high"
    );
});

test("stripCompetitiveAgentPrompts removes Claude / Anthropic identity sentences", () => {
    const raw =
        "You are a Claude agent, built on Anthropic's Claude Agent SDK. Please write Python code.";
    const cleaned = stripCompetitiveAgentPrompts(raw);
    assert.equal(cleaned, "Please write Python code.");

    const raw2 = "You are Claude Code, an interactive CLI tool. Help me fix bugs.";
    const cleaned2 = stripCompetitiveAgentPrompts(raw2);
    assert.equal(cleaned2, "Help me fix bugs.");
});

test("stripZeroWidth removes zero-width characters from strings and objects", () => {
    const withZeroWidth = "Hello\u200BWorld\uFEFF!";
    assert.equal(stripZeroWidth(withZeroWidth), "HelloWorld!");
    assert.deepEqual(stripZeroWidth({ key: "val\u200Cue" }), { key: "value" });
});

test("stripTrailingAssistantTurn removes lone model turn at the end", () => {
    const contents = [
        { role: "user", parts: [{ text: "Hello" }] },
        { role: "model", parts: [{ text: "{" }] }
    ];
    const stripped = stripTrailingAssistantTurn(contents);
    assert.equal(stripped.length, 1);
    assert.equal(stripped[0]?.role, "user");
});

test("parseAntigravityTextualToolCall parses markdown tool call", () => {
    const text = '[Tool call: get_current_weather]\nArguments: {"location": "San Francisco"}';
    const parsed = parseAntigravityTextualToolCall(text);
    assert.ok(parsed);
    assert.equal(parsed.name, "get_current_weather");
    assert.deepEqual(parsed.args, { location: "San Francisco" });
});

test("resolveAntigravityOutputCap and getAntigravityModelFallbacks work correctly", () => {
    assert.equal(resolveAntigravityOutputCap("gemini-3.7-flash-high"), 65536);
    assert.equal(resolveAntigravityOutputCap("claude-opus-4-6-thinking"), 64000);
    assert.equal(resolveAntigravityOutputCap("unknown-model"), 8192);

    const fallbacks = getAntigravityModelFallbacks("gemini-3.1-pro-high");
    assert.deepEqual(fallbacks, ["gemini-pro-agent", "gemini-3.1-pro-high", "gemini-3-pro"]);
});

test("parseRetryFromErrorMessage extracts duration from Google error messages", () => {
    assert.equal(
        parseRetryFromErrorMessage("Your quota will reset after 2h7m23s"),
        (2 * 3600 + 7 * 60 + 23) * 1000
    );
    assert.equal(
        parseRetryFromErrorMessage("Resets in 160h27m24s"),
        (160 * 3600 + 27 * 60 + 24) * 1000
    );
    assert.equal(parseRetryFromErrorMessage("Resets after 0s"), 2000);
    assert.equal(parseRetryFromErrorMessage("Unknown error"), null);
});

test("buildAntigravityEnvelope supports enabledCreditTypes", () => {
    const env = buildAntigravityEnvelope({
        projectId: "test-proj",
        model: "gemini-3.7-flash-tiered",
        requestType: "agent",
        request: { contents: [] },
        enabledCreditTypes: ["GOOGLE_ONE_AI"]
    });
    assert.equal(env.project, "test-proj");
    assert.deepEqual(env.enabledCreditTypes, ["GOOGLE_ONE_AI"]);
});

test("buildAntigravityContents injects skip_thought_signature_validator when missing", () => {
    const req: ChatCompletionRequest = {
        model: "antigravity/gemini-3.7-flash-high",
        messages: [
            { role: "user", content: "List files" },
            {
                role: "assistant",
                content: null,
                tool_calls: [
                    {
                        id: "call_bash_1",
                        type: "function",
                        function: {
                            name: "default_api:bash",
                            arguments: JSON.stringify({ command: "ls -la" })
                        }
                    }
                ]
            },
            {
                role: "tool",
                tool_call_id: "call_bash_1",
                content: "file1.txt\nfile2.txt"
            }
        ]
    };

    const contents = buildAntigravityContents(req);
    assert.equal(contents.length, 3);
    const modelPart = contents[1]?.parts[0];
    assert.ok(modelPart?.functionCall);
    assert.equal(modelPart.functionCall.name, "default_api:bash");
    assert.equal(modelPart.thoughtSignature, "skip_thought_signature_validator");
});

test("buildAntigravityContents preserves existing thoughtSignature", () => {
    const req: ChatCompletionRequest = {
        model: "antigravity/gemini-3.7-flash-high",
        messages: [
            { role: "user", content: "Run bash" },
            {
                role: "assistant",
                content: null,
                tool_calls: [
                    {
                        id: "call_bash_2",
                        type: "function",
                        function: {
                            name: "default_api:bash",
                            arguments: JSON.stringify({ command: "pwd" })
                        },
                        thoughtSignature: "real_encrypted_signature_blob"
                    } as unknown as ChatCompletionRequest["messages"][0]["tool_calls"][0]
                ]
            },
            {
                role: "tool",
                tool_call_id: "call_bash_2",
                content: "/workspace"
            }
        ]
    };

    const contents = buildAntigravityContents(req);
    const modelPart = contents[1]?.parts[0];
    assert.ok(modelPart?.functionCall);
    assert.equal(modelPart.thoughtSignature, "real_encrypted_signature_blob");
});

test("geminiStreamToOpenAIChunks propagates thoughtSignature in tool calls", () => {
    const state = createGeminiStreamState("gemini-3.7-flash-high");
    const rawChunk = {
        response: {
            candidates: [
                {
                    content: {
                        parts: [
                            {
                                functionCall: {
                                    name: "default_api_bash",
                                    args: { command: "uptime" }
                                },
                                thoughtSignature: "sig_12345"
                            }
                        ],
                        role: "model"
                    }
                }
            ]
        }
    };

    const chunks = geminiStreamToOpenAIChunks(rawChunk, state);
    assert.ok(chunks);
    const tcChunk = chunks.find((c) => c.choices[0]?.delta.tool_calls);
    assert.ok(tcChunk);
    const tc = tcChunk.choices[0]?.delta.tool_calls?.[0] as unknown as Record<string, unknown>;
    assert.ok(tc);
    assert.equal(tc.thoughtSignature, "sig_12345");
    assert.equal(tc.thought_signature, "sig_12345");
});

test("geminiToOpenAIResponse and geminiStreamToOpenAIChunks map cachedContentTokenCount correctly", () => {
    const rawResponse = {
        candidates: [
            {
                content: {
                    parts: [{ text: "Hello with cache!" }],
                    role: "model"
                },
                finishReason: "STOP"
            }
        ],
        usageMetadata: {
            promptTokenCount: 5000,
            candidatesTokenCount: 150,
            totalTokenCount: 5150,
            cachedContentTokenCount: 4096
        }
    };

    const res = geminiToOpenAIResponse(rawResponse, "gemini-3.7-flash");
    assert.equal(res.choices[0]?.message.content, "Hello with cache!");
    assert.deepEqual(res.usage, {
        prompt_tokens: 5000,
        completion_tokens: 150,
        total_tokens: 5150,
        prompt_tokens_details: {
            cached_tokens: 4096
        }
    });

    const streamState = createGeminiStreamState("gemini-3.7-flash");
    const streamChunks = geminiStreamToOpenAIChunks(rawResponse, streamState);
    assert.ok(streamChunks);
    const finalChunk = streamChunks.find((c) => c.usage);
    assert.ok(finalChunk);
    assert.deepEqual(finalChunk.usage, {
        prompt_tokens: 5000,
        completion_tokens: 150,
        total_tokens: 5150,
        prompt_tokens_details: {
            cached_tokens: 4096
        }
    });
});
