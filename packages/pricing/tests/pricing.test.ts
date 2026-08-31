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
    assert.ok(dataset.aliases["deepseek-chat"]);
    assert.equal(dataset.defaults.input, 2.0);

    // Verify provider-grouped array structure
    assert.ok(dataset.providerModels);
    assert.ok(Array.isArray(dataset.providerModels.anthropic));
    assert.ok(dataset.providerModels.anthropic.some((m) => m.id === "claude-sonnet-5"));
    assert.ok(Array.isArray(dataset.providerModels.openai));
    assert.ok(dataset.providerModels.openai.some((m) => m.id === "gpt-5.6-sol"));
});

test("Model name normalization and aliasing", () => {
    const dataset = loadPricingData();

    // 1. Strip provider prefix
    assert.equal(normalizeModelName("commandcode/deepseek/deepseek-v4-flash"), "deepseek-v4-flash");
    assert.equal(normalizeModelName("deepseek/deepseek-v4-flash"), "deepseek-v4-flash");

    // 2. Strip tags
    assert.equal(normalizeModelName("deepseek/deepseek-v4-flash:latest"), "deepseek-v4-flash");

    // 3. Resolve aliases
    assert.equal(normalizeModelName("deepseek-chat", dataset.aliases), "deepseek-v4-flash");
    assert.equal(
        normalizeModelName("claude-3.5-sonnet", dataset.aliases),
        "claude-3-5-sonnet-20241022"
    );
});

test("Pricing resolution across different provider prefixes", () => {
    const directPrice = getPricingForModel(undefined, "deepseek-v4-flash");
    const deepseekPrefixPrice = getPricingForModel("deepseek", "deepseek/deepseek-v4-flash");
    const commandcodePrefixPrice = getPricingForModel(
        "commandcode",
        "commandcode/deepseek-v4-flash"
    );

    assert.equal(directPrice.input, 0.44);
    assert.equal(directPrice.output, 1.32);

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

test("Alias pricing resolution", () => {
    const canonicalPrice = getPricingForModel(undefined, "deepseek-v4-flash");
    const aliasPrice = getPricingForModel(undefined, "deepseek-chat");

    assert.deepEqual(aliasPrice, canonicalPrice);

    const sonnetCanonical = getPricingForModel(undefined, "claude-3-5-sonnet-20241022");
    const sonnetAlias = getPricingForModel(undefined, "claude-3.5-sonnet");
    assert.deepEqual(sonnetAlias, sonnetCanonical);

    const opusCanonical = getPricingForModel(undefined, "claude-opus-5");
    assert.equal(opusCanonical.input, 5.0);
    assert.equal(opusCanonical.output, 25.0);

    const opusAlias = getPricingForModel(undefined, "claude-opus");
    const opusCommandCode = getPricingForModel("commandcode", "commandcode/claude-opus-5");
    assert.deepEqual(opusAlias, opusCanonical);
    assert.deepEqual(opusCommandCode, opusCanonical);

    const gptProPrice = getPricingForModel(undefined, "gpt-5.5-pro");
    assert.equal(gptProPrice.input, 30.0);
    assert.equal(gptProPrice.output, 180.0);

    const gptNanoPrice = getPricingForModel(undefined, "gpt-5.4-nano");
    assert.equal(gptNanoPrice.input, 0.2);
    assert.equal(gptNanoPrice.output, 1.25);
    assert.equal(gptNanoPrice.cached, 0.02);

    const llamaAlias = getPricingForModel(undefined, "meta-llama/Llama-3.3-70B-Instruct");
    assert.equal(llamaAlias.input, 0.13);
    assert.equal(llamaAlias.output, 0.4);

    const mistralAlias = getPricingForModel(undefined, "mistral");
    assert.equal(mistralAlias.input, 2.0);
    assert.equal(mistralAlias.output, 6.0);

    const r1Alias = getPricingForModel(undefined, "deepseek-ai/DeepSeek-R1");
    assert.equal(r1Alias.input, 0.55);
    assert.equal(r1Alias.output, 2.19);
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

test("models.dev dataset loading from models.jsonc", () => {
    const modelsData = loadModelsDevData();
    assert.ok(Object.keys(modelsData).length > 0, "modelsData should not be empty");
    assert.ok(modelsData["minimax/MiniMax-M3"], "Should contain minimax/MiniMax-M3");
    assert.equal(modelsData["minimax/MiniMax-M3"]?.name, "MiniMax-M3");
    assert.equal(modelsData["minimax/MiniMax-M3"]?.family, "minimax");
    assert.ok(modelsData["upstage/solar-pro4"], "Should contain upstage/solar-pro4");
});
