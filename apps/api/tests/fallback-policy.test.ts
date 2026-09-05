import { test } from "node:test";
import assert from "node:assert/strict";
import { ExtractStatusCode, ShouldTriggerFallback } from "../src/logic/fallback.policy.js";
import type { FallbackRule } from "@srouter/types";

test("ExtractStatusCode extracts status from number, object, or string message", () => {
    assert.equal(ExtractStatusCode(null), undefined);
    assert.equal(ExtractStatusCode(undefined), undefined);
    assert.equal(ExtractStatusCode({ status: 429 }), 429);
    assert.equal(ExtractStatusCode({ statusCode: 503 }), 503);
    assert.equal(ExtractStatusCode(new Error("Request failed with status code 404")), 404);
    assert.equal(ExtractStatusCode("rate limit exceeded (429)"), 429);
    assert.equal(ExtractStatusCode("no active provider connection for gemini"), 404);
    assert.equal(ExtractStatusCode(new Error("generic connection drop")), undefined);
});

test("ShouldTriggerFallback adheres to rule settings and error conditions", () => {
    const disabledRule: FallbackRule = {
        id: "1",
        originalModel: "gpt-4o",
        targetModel: "claude-3-5-sonnet",
        enabled: false,
        priority: 1
    };
    assert.equal(ShouldTriggerFallback(disabledRule, new Error("429")), false);

    const wildcardStatusRule: FallbackRule = {
        id: "2",
        originalModel: "gpt-4o",
        targetModel: "claude-3-5-sonnet",
        enabled: true,
        priority: 1,
        triggerOnStatus: []
    };
    assert.equal(ShouldTriggerFallback(wildcardStatusRule, new Error("anything")), true);

    const specificStatusRule: FallbackRule = {
        id: "3",
        originalModel: "gpt-4o",
        targetModel: "claude-3-5-sonnet",
        enabled: true,
        priority: 1,
        triggerOnStatus: [429, 503]
    };
    assert.equal(ShouldTriggerFallback(specificStatusRule, { status: 429 }), true);
    assert.equal(ShouldTriggerFallback(specificStatusRule, { status: 400 }), false);
    assert.equal(ShouldTriggerFallback(specificStatusRule, new Error("quota exceeded")), true);
    assert.equal(ShouldTriggerFallback(specificStatusRule, new Error("unknown unhandled")), true);
});
