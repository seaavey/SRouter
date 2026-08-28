import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BAIExecutor } from "../src/bai.js";
import { BAI_BASE_URL, BAI_DEFAULT_MODELS } from "@srouter/constants";

describe("BAIExecutor", () => {
    it("initializes with default options", () => {
        const executor = new BAIExecutor();
        assert.equal(executor.id, "bai");
        assert.equal(executor.name, "B.AI");
    });

    it("falls back to default models when remote listModels returns empty", async () => {
        const executor = new BAIExecutor({
            baseUrl: "https://invalid-url.mock.bai/v1",
            apiKey: "test-key"
        });
        const models = await executor.listModels();
        assert.equal(models.length, BAI_DEFAULT_MODELS.length);
        assert.equal(models[0].id, "bai/deepseek-v4-flash");
    });
});
