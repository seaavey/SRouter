import assert from "node:assert/strict";
import test from "node:test";
import {
    calculateCostFromTokens,
    DEFAULT_PRICING,
    formatCost,
    getPricingForModel,
    loadModelsDevData,
    loadPricingData,
    normalizeModelName,
    stripJsonComments
} from "../src/index.js";

test("JSONC comment stripping and loading", () => {
    const rawJsonc = `
    {
        // This is a single line comment
        "test": "value", /* inline comment */
        "arr": [1, 2, 3,] // trailing comma test
    }
    `;
    const clean = stripJsonComments(rawJsonc);
    const parsed = JSON.parse(clean);
    assert.equal(parsed.test, "value");
    assert.deepEqual(parsed.arr, [1, 2, 3]);

    const dataset = loadPricingData();
    assert.ok(dataset.models["deepseek-v4-flash"]);
    assert.equal(dataset.defaults.input, 2.0);

    // Verify provider-grouped array structure
    assert.ok(dataset.providerModels);
    assert.ok(Array.isArray(dataset.providerModels.anthropic));
    assert.ok(dataset.providerModels.anthropic.some((m) => m.id === "anthropic/claude-sonnet-5"));
    assert.ok(Array.isArray(dataset.providerModels.openai));
    assert.ok(dataset.providerModels.openai.some((m) => m.id === "openai/gpt-5-pro"));
});

test("Model name normalization and aliasing", () => {
    const dataset = loadPricingData();

    // 1. Strip provider prefix
    assert.equal(normalizeModelName("commandcode/deepseek/deepseek-v4-flash"), "deepseek-v4-flash");
    assert.equal(normalizeModelName("deepseek/deepseek-v4-flash"), "deepseek-v4-flash");

    // 2. Strip tags
    assert.equal(normalizeModelName("deepseek/deepseek-v4-flash:latest"), "deepseek-v4-flash");

    // 3. Preserve model names when the models.dev dataset has no custom aliases
    assert.equal(normalizeModelName("deepseek-chat", dataset.aliases), "deepseek/deepseek-chat");
    assert.equal(normalizeModelName("claude-3.5-sonnet", dataset.aliases), "claude-3.5-sonnet");
});

test("Pricing resolution across different provider prefixes", () => {
    const directPrice = getPricingForModel(undefined, "deepseek-v4-flash");
    const deepseekPrefixPrice = getPricingForModel("deepseek", "deepseek/deepseek-v4-flash");
    const commandcodePrefixPrice = getPricingForModel(
        "commandcode",
        "commandcode/deepseek-v4-flash"
    );

    assert.equal(directPrice.input, 0.14);
    assert.equal(directPrice.output, 0.28);

    // All variations resolve to the exact same price
    assert.deepEqual(deepseekPrefixPrice, directPrice);
    assert.deepEqual(commandcodePrefixPrice, directPrice);
});

test("Free model pricing returns 0 cost", () => {
    const freeTagPrice = getPricingForModel(
        "commandcode",
        "commandcode/deepseek/deepseek-v4-flash:free"
    );
    assert.equal(freeTagPrice.input, 0);
    assert.equal(freeTagPrice.output, 0);

    const freeModel = getPricingForModel(undefined, "deepseek-r1:free");
    assert.equal(freeModel.input, 0);
    assert.equal(freeModel.output, 0);

    const openrouterFree = getPricingForModel(undefined, "meta-llama/llama-3.3-70b-instruct:free");
    assert.equal(openrouterFree.input, 0);
    assert.equal(openrouterFree.output, 0);

    const nameWithFree = getPricingForModel(undefined, "gemini-2.5-flash-free");
    assert.equal(nameWithFree.input, 0);
    assert.equal(nameWithFree.output, 0);
});

test("Pricing resolution for canonical models", () => {
    const canonicalPrice = getPricingForModel(undefined, "deepseek-v4-flash");
    const prefixedPrice = getPricingForModel("deepseek", "deepseek/deepseek-v4-flash");
    assert.deepEqual(prefixedPrice, canonicalPrice);

    const gptProPrice = getPricingForModel(undefined, "gpt-5-pro");
    assert.equal(gptProPrice.input, 15.0);
    assert.equal(gptProPrice.output, 120.0);
});

test("Unknown model fallback to DEFAULT_PRICING", () => {
    const unknownPrice = getPricingForModel(undefined, "non-existent-model-xyz");
    assert.deepEqual(unknownPrice, DEFAULT_PRICING);
});

test("Cost calculation and formatting", () => {
    const pricing = {
        input: 3.0,
        output: 15.0,
        cached: 0.3,
        reasoning: 15.0,
        cache_creation: 3.75
    };

    // 1M non-cached input + 1M output = $3 + $15 = $18
    const cost = calculateCostFromTokens(
        {
            prompt_tokens: 1_000_000,
            completion_tokens: 1_000_000
        },
        pricing
    );
    assert.equal(cost, 18.0);
    assert.equal(formatCost(cost), "$18.00");

    // Cached tokens test (500k non-cached, 500k cached) -> 500k * 3/1M + 500k * 0.3/1M = 1.5 + 0.15 = $1.65
    const cachedCost = calculateCostFromTokens(
        {
            prompt_tokens: 1_000_000,
            cached_tokens: 500_000,
            completion_tokens: 0
        },
        pricing
    );
    assert.equal(cachedCost, 1.65);
});

test("models.dev dataset loading from pricing.jsonc", () => {
    const modelsData = loadModelsDevData();
    assert.ok(Object.keys(modelsData).length > 0, "modelsData should not be empty");
    assert.ok(modelsData["minimax/MiniMax-M3"], "Should contain minimax/MiniMax-M3");
    assert.equal(modelsData["minimax/MiniMax-M3"]?.name, "MiniMax-M3");
    assert.equal(modelsData["minimax/MiniMax-M3"]?.family, "minimax");
    assert.ok(modelsData["upstage/solar-pro4"], "Should contain upstage/solar-pro4");

    // Verify pricing data loaded from pricing.jsonc
    const modelsDevPricing = loadPricingData();
    // Full key: <provider>/<model>
    assert.ok(modelsDevPricing.models["tencent/hy3"]);
    assert.ok(modelsDevPricing.models["tencent/hy3"].input > 0);
    assert.ok(modelsDevPricing.models["tencent/hy3"].output > 0);

    // After provider prefix: <model>
    assert.ok(modelsDevPricing.models["hy3"]);
    assert.equal(modelsDevPricing.models["hy3"].input, modelsDevPricing.models["tencent/hy3"].input);
});
