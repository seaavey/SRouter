import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { Hono } from "hono";
import imagesRouter from "../src/routes/v1/images.js";
import { registry } from "../src/services/registry.js";
import type { AIProvider, ImageGenerationRequest, ImageGenerationResponse, ModelObject } from "@srouter/types";
import { deleteLogsByProviderDB } from "@srouter/db";

const mockProviderId = "mock-image-prov";

const mockImageProvider: AIProvider = {
    id: mockProviderId,
    name: "Mock Image Provider",
    listModels: async (): Promise<ModelObject[]> => [
        { id: `${mockProviderId}/gpt-image-1.5`, object: "model", owned_by: mockProviderId }
    ],
    chatCompletion: async () => {
        throw new Error("not implemented");
    },
    chatCompletionStream: async function* () {
        throw new Error("not implemented");
    },
    generateImage: async (req: ImageGenerationRequest): Promise<ImageGenerationResponse> => {
        return {
            created: 1725408000,
            data: [
                {
                    url: "https://example.com/mock-generated.png",
                    revised_prompt: `Revised: ${req.prompt}`
                }
            ]
        };
    }
};

beforeEach(() => {
    registry.registerProvider(mockImageProvider);
});

afterEach(async () => {
    registry.unregisterProvider(mockProviderId);
    await deleteLogsByProviderDB(mockProviderId);
});

test("POST /v1/images/generations succeeds with valid image model from pricing.jsonc", async () => {
    const app = new Hono();
    app.route("/v1/images", imagesRouter);

    const res = await app.request("http://localhost/v1/images/generations", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            prompt: "A beautiful mountain",
            model: `${mockProviderId}/gpt-image-1.5`
        })
    });

    assert.equal(res.status, 200);
    const data = (await res.json()) as ImageGenerationResponse;
    assert.equal(data.created, 1725408000);
    assert.equal(data.data[0]?.url, "https://example.com/mock-generated.png");
});

test("POST /v1/images/generations rejects unsupported text models with 400", async () => {
    const app = new Hono();
    app.route("/v1/images", imagesRouter);

    const res = await app.request("http://localhost/v1/images/generations", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            prompt: "Draw a mountain",
            model: "deepseek/deepseek-chat"
        })
    });

    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: { message: string; code?: string } };
    assert.ok(body.error.message.includes("does not support image generation"));
});
