import assert from "node:assert/strict";
import { test } from "node:test";
import { Hono } from "hono";
import { AnthropicMessageRequestSchema, ChatCompletionRequestSchema } from "@srouter/types";
import { CreateBodyLimitMiddleware, MAX_BODY_BYTES } from "../src/middleware/BodyLimit.js";
import { ValidateJson } from "../src/middleware/Validation.js";
import { IsPrivateIpAddress } from "../src/utils/ssrf.js";

function createTestApp() {
    const app = new Hono();
    app.use("/v1/*", CreateBodyLimitMiddleware());
    app.post("/v1/chat/completions", ValidateJson(ChatCompletionRequestSchema), (c) =>
        c.json({ ok: true })
    );
    return app;
}

test("body limit middleware rejects oversized Content-Length with 413", async () => {
    const app = createTestApp();
    const res = await app.request("/v1/chat/completions", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Content-Length": String(MAX_BODY_BYTES + 1)
        },
        body: "{}"
    });
    assert.equal(res.status, 413);
    const body = (await res.json()) as { error: { code: string } };
    assert.equal(body.error.code, "request_too_large");
});

test("chat schema rejects oversized structural payloads", () => {
    const base = { model: "gpt-test", messages: [{ role: "user" as const, content: "hi" }] };

    assert.ok(
        ChatCompletionRequestSchema.safeParse({ ...base, max_tokens: 999_999_999 }).success ===
            false
    );
    assert.ok(ChatCompletionRequestSchema.safeParse({ ...base, n: 100 }).success === false);
    assert.ok(
        ChatCompletionRequestSchema.safeParse({
            ...base,
            messages: Array.from({ length: 1001 }, () => ({ role: "user", content: "x" }))
        }).success === false
    );
    assert.ok(
        ChatCompletionRequestSchema.safeParse({ ...base, model: "m".repeat(301) }).success === false
    );
    assert.ok(
        ChatCompletionRequestSchema.safeParse({
            ...base,
            tools: Array.from({ length: 129 }, () => ({
                type: "function",
                function: { name: "t" }
            }))
        }).success === false
    );
    assert.ok(ChatCompletionRequestSchema.safeParse({ ...base, max_tokens: 4096 }).success);
});

test("anthropic schema keeps valid shapes and rejects runaway payloads", () => {
    const valid = {
        model: "claude-test",
        max_tokens: 1024,
        messages: [
            { role: "user", content: "hi" },
            {
                role: "assistant",
                content: [
                    { type: "text", text: "sure" },
                    { type: "tool_use", id: "tu_1", name: "search", input: { q: "x" } }
                ]
            },
            {
                role: "user",
                content: [{ type: "tool_result", tool_use_id: "tu_1", content: "ok" }]
            }
        ],
        system: "be nice",
        tools: [{ name: "search", input_schema: { type: "object", properties: {} } }],
        tool_choice: { type: "auto" },
        thinking: { type: "enabled", budget_tokens: 512 }
    };
    assert.ok(AnthropicMessageRequestSchema.safeParse(valid).success);

    assert.ok(
        AnthropicMessageRequestSchema.safeParse({
            ...valid,
            messages: Array.from({ length: 1001 }, () => ({ role: "user", content: "x" }))
        }).success === false
    );
    assert.ok(
        AnthropicMessageRequestSchema.safeParse({ ...valid, max_tokens: 10_000_000 }).success ===
            false
    );
    assert.ok(
        AnthropicMessageRequestSchema.safeParse({
            ...valid,
            messages: [{ role: "hacker", content: "x" }]
        }).success === false
    );
});

test("SSRF: private, loopback, link-local, CGNAT, and multicast addresses are blocked", () => {
    for (const Address of [
        "127.0.0.1",
        "127.9.9.9",
        "10.1.2.3",
        "172.16.0.1",
        "172.31.255.255",
        "192.168.1.1",
        "169.254.169.254",
        "100.64.0.1",
        "0.0.0.0",
        "224.0.0.1",
        "::1",
        "::",
        "fe80::1",
        "fc00::1",
        "ff02::1",
        "::ffff:127.0.0.1",
        "not-an-ip"
    ]) {
        assert.equal(IsPrivateIpAddress(Address), true, `${Address} should be blocked`);
    }
    for (const Address of ["8.8.8.8", "1.1.1.1", "172.15.0.1", "100.128.0.1", "2606:4700:4700::1111"]) {
        assert.equal(IsPrivateIpAddress(Address), false, `${Address} should be allowed`);
    }
});

test("messages route rejects chunked oversized bodies with 413 (no Content-Length trust)", async () => {
    const { setRequireApiKeyDB } = await import("@srouter/db");
    setRequireApiKeyDB(false);
    const { MessagesRouter } = await import("../src/routes/v1/messages.js");
    const app = new Hono();
    app.route("/v1", MessagesRouter);

    const Padding = "a".repeat(MAX_BODY_BYTES + 64);
    const res = await app.request("/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            model: "claude-test",
            max_tokens: 8,
            messages: [{ role: "user", content: Padding }]
        })
    });
    assert.equal(res.status, 413);
    const payload = (await res.json()) as { error: { message: string } };
    assert.match(payload.error.message, /too large/i);
});
