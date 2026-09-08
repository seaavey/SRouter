import assert from "node:assert/strict";
import { test } from "node:test";
import { isImageGenerationSupported } from "../src/pricing.js";

test("isImageGenerationSupported returns true for models with output: image in pricing.jsonc", () => {
    assert.equal(isImageGenerationSupported("google/gemini-3-pro-image"), true);
    assert.equal(isImageGenerationSupported("google/gemini-3.1-flash-image"), true);
    assert.equal(isImageGenerationSupported("openai/gpt-image-1.5"), true);
    assert.equal(isImageGenerationSupported("openai/gpt-image-2"), true);
    assert.equal(isImageGenerationSupported("minimax/image-01"), true);
    assert.equal(isImageGenerationSupported("xai/grok-imagine-image-2.0"), true);
});

test("isImageGenerationSupported returns false for text-only models in pricing.jsonc", () => {
    assert.equal(isImageGenerationSupported("deepseek/deepseek-chat"), false);
    assert.equal(isImageGenerationSupported("anthropic/claude-sonnet-4-20250514"), false);
    assert.equal(isImageGenerationSupported("openai/gpt-4o"), false);
});

test("isImageGenerationSupported handles img2img check using input/output modalities in pricing.jsonc", () => {
    // google/gemini-3-pro-image has input: ["text", "image"], output: ["text", "image"]
    assert.equal(isImageGenerationSupported("google/gemini-3-pro-image", true), true);
    // minimax/image-01 has input: ["text", "image"], output: ["image"]
    assert.equal(isImageGenerationSupported("minimax/image-01", true), true);
});
