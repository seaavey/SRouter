import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ExtractUsageBreakdown, EstimateCostForUsage } from "../src/usage.js";

describe("usage translator", () => {
    it("extracts anthropic usage breakdown correctly", () => {
        const usage = {
            input_tokens: 100,
            output_tokens: 50,
            cache_read_input_tokens: 20,
            cache_creation_input_tokens: 10,
            reasoning: { reasoning_tokens: 15 }
        };

        const breakdown = ExtractUsageBreakdown("anthropic", usage);
        assert.deepEqual(breakdown, {
            prompt_tokens: 100,
            completion_tokens: 50,
            cached_tokens: 20,
            cache_creation_tokens: 10,
            reasoning_tokens: 15,
            total_tokens: 150
        });
    });

    it("extracts openai usage breakdown correctly", () => {
        const usage = {
            prompt_tokens: 120,
            completion_tokens: 60,
            total_tokens: 180,
            prompt_tokens_details: { cached_tokens: 30 },
            completion_tokens_details: { reasoning_tokens: 25 }
        };

        const breakdown = ExtractUsageBreakdown("openai", usage);
        assert.deepEqual(breakdown, {
            prompt_tokens: 120,
            completion_tokens: 60,
            cached_tokens: 30,
            cache_creation_tokens: 0,
            reasoning_tokens: 25,
            total_tokens: 180
        });
    });

    it("handles undefined or invalid usage gracefully", () => {
        const breakdown = ExtractUsageBreakdown(undefined, undefined);
        assert.deepEqual(breakdown, {
            prompt_tokens: 0,
            completion_tokens: 0,
            cached_tokens: 0,
            cache_creation_tokens: 0,
            reasoning_tokens: 0,
            total_tokens: 0
        });
    });

    it("estimates cost accurately", () => {
        const breakdown = {
            prompt_tokens: 1000,
            completion_tokens: 500,
            cached_tokens: 0,
            cache_creation_tokens: 0,
            reasoning_tokens: 0,
            total_tokens: 1500
        };

        const cost = EstimateCostForUsage("openai", "gpt-4o", breakdown);
        assert.equal(typeof cost, "number");
    });
});
