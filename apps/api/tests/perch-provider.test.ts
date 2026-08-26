import assert from "node:assert/strict";
import test from "node:test";
import { PERCH_APP_URL } from "@srouter/constants";
import { PerchExecutor, PERCH_MODELS } from "@srouter/executors";

test("PerchExecutor creates correctly and formats model lists", async () => {
    const executor = new PerchExecutor({
        id: "perch",
        name: "Perch AI",
        accessToken: "test-token"
    });

    assert.equal(executor.id, "perch");
    assert.equal(executor.name, "Perch AI");

    const models = await executor.listModels();
    assert.equal(models.length, PERCH_MODELS.length);
    assert.equal(models[0].id, `perch/${PERCH_MODELS[0].id}`);
    assert.equal(models[0].owned_by, "perch");
});
