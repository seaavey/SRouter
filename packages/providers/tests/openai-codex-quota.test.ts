import assert from "node:assert/strict";
import { test } from "node:test";
import { OpenAICodexQuotaFetcher } from "../src/quota/openai-codex.js";

test("OpenAI Codex quota maps primary and secondary windows", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (_input, init) => {
        assert.equal(new Headers(init?.headers).get("ChatGPT-Account-ID"), "acct_123");
        return new Response(
            JSON.stringify({
                plan_type: "plus",
                rate_limit: {
                    primary_window: { used_percent: 25, reset_at: 1_800_000_000 },
                    secondary_window: { used_percent: 60, reset_at: 1_800_100_000 }
                }
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
        );
    };

    try {
        const result = await new OpenAICodexQuotaFetcher().fetchQuota({
            id: "openai_codex_1",
            providerId: "openai_codex",
            name: "Codex account",
            accessToken: "token",
            accountId: "acct_123",
            enabled: true
        });

        assert.equal(result.provider, "OpenAI Codex (plus)");
        assert.deepEqual(
            result.quotas?.map((quota) => [quota.name, quota.percentageValue]),
            [
                ["Codex 5-hour", 75],
                ["Codex Weekly", 40]
            ]
        );
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test("OpenAI Codex quota names a long primary window from its upstream duration", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
        new Response(
            JSON.stringify({
                plan_type: "prolite",
                rate_limit: {
                    primary_window: {
                        used_percent: 12,
                        limit_window_seconds: 2_592_000,
                        reset_at: 1_800_000_000
                    },
                    secondary_window: null
                }
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
        );

    try {
        const result = await new OpenAICodexQuotaFetcher().fetchQuota({
            id: "openai_codex_1",
            providerId: "openai_codex",
            name: "Codex account",
            accessToken: "token",
            enabled: true
        });

        assert.deepEqual(
            result.quotas?.map((quota) => quota.name),
            ["Codex Monthly"]
        );
    } finally {
        globalThis.fetch = originalFetch;
    }
});
