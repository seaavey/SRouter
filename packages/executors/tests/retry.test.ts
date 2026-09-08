import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { CreateRequestAttemptBudget } from "@srouter/types";
import { fetchWithRetry } from "../src/retry.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
    globalThis.fetch = originalFetch;
});

test("fetchWithRetry does not retry permanent client errors", async () => {
    let calls = 0;
    globalThis.fetch = async () => {
        calls += 1;
        return new Response(JSON.stringify({ error: { message: "invalid request" } }), {
            status: 400,
            headers: { "content-type": "application/json" }
        });
    };

    const response = await fetchWithRetry("https://upstream.test/chat", {}, {}, 3);

    assert.equal(response.status, 400);
    assert.equal(calls, 1);
});

test("fetchWithRetry counts transient transport attempts separately from fallback attempts", async () => {
    let calls = 0;
    globalThis.fetch = async () => {
        calls += 1;
        return new Response(JSON.stringify({ error: { message: "temporarily unavailable" } }), {
            status: 503,
            headers: { "content-type": "application/json" }
        });
    };

    const response = await fetchWithRetry("https://upstream.test/chat", {}, {}, 2);
    assert.equal(response.status, 503);
    assert.equal(calls, 2);
});

test("fetchWithRetry stops at the request-level attempt budget", async () => {
    let calls = 0;
    globalThis.fetch = async () => {
        calls += 1;
        return new Response(JSON.stringify({ error: { message: "temporarily unavailable" } }), {
            status: 503,
            headers: { "content-type": "application/json" }
        });
    };

    const budget = CreateRequestAttemptBudget(2);
    const response = await fetchWithRetry("https://upstream.test/chat", {}, {}, 3, budget);
    assert.equal(response.status, 503);
    assert.equal(calls, 2);
    assert.equal(budget.used, 2);
    assert.equal(budget.remaining, 0);
});
