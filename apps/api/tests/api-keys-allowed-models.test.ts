import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createAPIKeyDB, deleteAPIKeyDB, getAPIKeyByKeyDB } from "@srouter/db";
import { IsModelAllowed } from "@/middleware/ModelAccess.js";

const createdIds: string[] = [];

afterEach(async () => {
    for (const id of createdIds.splice(0)) {
        await deleteAPIKeyDB(id);
    }
});

test("createAPIKeyDB persists allowed_models and round-trips via lookup", async () => {
    const created = await createAPIKeyDB({
        name: "Restricted Key",
        allowed_models: ["gpt-4o", "claude-3-5-sonnet-20241022"]
    });
    createdIds.push(created.id);

    assert.deepEqual(created.allowed_models, ["gpt-4o", "claude-3-5-sonnet-20241022"]);

    const lookup = await getAPIKeyByKeyDB(created.key);
    assert.ok(lookup);
    assert.deepEqual(lookup?.allowed_models, ["gpt-4o", "claude-3-5-sonnet-20241022"]);
});

test("createAPIKeyDB normalizes empty allowed_models to null (unrestricted)", async () => {
    const created = await createAPIKeyDB({
        name: "Open Key",
        allowed_models: []
    });
    createdIds.push(created.id);

    assert.equal(created.allowed_models, null);

    const lookup = await getAPIKeyByKeyDB(created.key);
    assert.equal(lookup?.allowed_models, null);
});

test("createAPIKeyDB defaults allowed_models to null when omitted", async () => {
    const created = await createAPIKeyDB({ name: "Default Key" });
    createdIds.push(created.id);

    assert.equal(created.allowed_models, null);
});

test("IsModelAllowed permits any model when list is null or empty", async () => {
    assert.equal(IsModelAllowed(null, "gpt-4o"), true);
    assert.equal(IsModelAllowed([], "gpt-4o"), true);
    assert.equal(IsModelAllowed(undefined, "gpt-4o"), true);
});

test("IsModelAllowed enforces allow-list membership", async () => {
    const Allowed = ["gpt-4o", "claude-3-5-sonnet-20241022"];
    assert.equal(IsModelAllowed(Allowed, "gpt-4o"), true);
    assert.equal(IsModelAllowed(Allowed, "gpt-4o-mini"), false);
    assert.equal(IsModelAllowed(Allowed, "claude-3-5-sonnet-20241022"), true);
});

test("IsModelAllowed ignores srouter/ prefix when matching", async () => {
    assert.equal(IsModelAllowed(["gpt-4o"], "srouter/gpt-4o"), true);
    assert.equal(IsModelAllowed(["srouter/gpt-4o"], "gpt-4o"), true);
});

test("IsModelAllowed matches models with or without provider prefix", async () => {
    assert.equal(IsModelAllowed(["gpt-4o"], "openai/gpt-4o"), true);
    assert.equal(IsModelAllowed(["openai/gpt-4o"], "gpt-4o"), true);
    assert.equal(IsModelAllowed(["claude-3-5-sonnet"], "anthropic/claude-3-5-sonnet"), true);
    assert.equal(IsModelAllowed(["openai/gpt-4o"], "openai/gpt-4o-mini"), false);
});
