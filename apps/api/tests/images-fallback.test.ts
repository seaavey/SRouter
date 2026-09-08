import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createFallbackRuleDB, deleteFallbackRuleDB, deleteLogsByProviderDB } from "@srouter/db";
import type { ImageGenerationResponse } from "@srouter/types";
import { ImagesLogic } from "../src/logic/images.logic.js";
import { registry } from "../src/services/registry.js";

const createdRuleIds: string[] = [];
const response: ImageGenerationResponse = {
    created: 1725408000,
    data: [{ url: "https://example.com/generated.png" }]
};
const defaults = {
    n: 1,
    quality: "auto" as const,
    response_format: "url" as const,
    size: "1024x1024"
};

afterEach(async () => {
    for (const id of createdRuleIds.splice(0)) {
        await deleteFallbackRuleDB(id);
    }
    await deleteLogsByProviderDB("openai");
});

test("ImagesLogic returns the primary image response", async () => {
    const originalGenerateImage = registry.generateImage;
    let calls = 0;
    registry.generateImage = async () => {
        calls += 1;
        return response;
    };

    try {
        const result = await ImagesLogic.generate(
            { ...defaults, model: "openai/gpt-image-1.5", prompt: "primary" },
            Date.now()
        );
        assert.deepEqual(result, response);
        assert.equal(calls, 1);
    } finally {
        registry.generateImage = originalGenerateImage;
    }
});

test("ImagesLogic falls back after an eligible primary failure", async () => {
    const rule = await createFallbackRuleDB({
        sourceModel: "openai/gpt-image-1.5",
        targetModel: "openai/gpt-image-2",
        priority: 1,
        enabled: true,
        triggerOnStatus: [429]
    });
    createdRuleIds.push(rule.id);

    const originalGenerateImage = registry.generateImage;
    const models: string[] = [];
    registry.generateImage = async (request) => {
        models.push(request.model);
        if (request.model === "openai/gpt-image-1.5") {
            throw new Error("429 image quota exceeded");
        }
        return response;
    };

    try {
        const result = await ImagesLogic.generate(
            { ...defaults, model: "openai/gpt-image-1.5", prompt: "fallback" },
            Date.now()
        );
        assert.deepEqual(result, response);
        assert.deepEqual(models, ["openai/gpt-image-1.5", "openai/gpt-image-2"]);
    } finally {
        registry.generateImage = originalGenerateImage;
    }
});

test("ImagesLogic skips a fallback rule when the error does not match its trigger", async () => {
    const rule = await createFallbackRuleDB({
        sourceModel: "openai/gpt-image-1.5",
        targetModel: "openai/gpt-image-2",
        priority: 1,
        enabled: true,
        triggerOnStatus: [400]
    });
    createdRuleIds.push(rule.id);

    const originalGenerateImage = registry.generateImage;
    let calls = 0;
    registry.generateImage = async () => {
        calls += 1;
        throw new Error("500 image provider failure");
    };

    try {
        await assert.rejects(
            () =>
                ImagesLogic.generate(
                    { ...defaults, model: "openai/gpt-image-1.5", prompt: "skip" },
                    Date.now()
                ),
            /500 image provider failure/
        );
        assert.equal(calls, 1);
    } finally {
        registry.generateImage = originalGenerateImage;
    }
});

test("ImagesLogic validates image capability before provider execution", async () => {
    const originalGenerateImage = registry.generateImage;
    let called = false;
    registry.generateImage = async () => {
        called = true;
        return response;
    };

    try {
        await assert.rejects(
            () =>
                ImagesLogic.generate(
                    { ...defaults, model: "openai/gpt-4o", prompt: "invalid" },
                    Date.now()
                ),
            (error: unknown) =>
                error instanceof Error &&
                error.message.includes("does not support image generation")
        );
        assert.equal(called, false);
    } finally {
        registry.generateImage = originalGenerateImage;
    }
});
