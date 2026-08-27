import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createAPIKeyDB, deleteAPIKeyDB, getAPIKeyByKeyDB } from "@srouter/db";
import { IsModelAllowed } from "@/middleware/ModelAccess.js";

const createdIds: string[] = [];

afterEach(() => {
    for (const id of createdIds.splice(0)) {
        deleteAPIKeyDB(id);
    }
});

test("createAPIKeyDB persists allowed_models and round-trips via lookup", () => {
    const created = createAPIKeyDB({
        name: "Restricted Key",
        allowed_models: ["gpt-4o", "claude-3-5-sonnet-20241022"]
    });
    createdIds.push(created.id);

    assert.deepEqual(created.allowed_models, ["gpt-4o", "claude-3-5-sonnet-20241022"]);

    const lookup = getAPIKeyByKeyDB(created.key);
    assert.ok(lookup);
    assert.deepEqual(lookup?.allowed_models, ["gpt-4o", "claude-3-5-sonnet-20241022"]);
});

test("createAPIKeyDB normalizes empty allowed_models to null (unrestricted)", () => {
    const created = createAPIKeyDB({
        name: "Open Key",
        allowed_models: []
    });
    createdIds.push(created.id);

    assert.equal(created.allowed_models, null);

    const lookup = getAPIKeyByKeyDB(created.key);
    assert.equal(lookup?.allowed_models, null);
});

test("createAPIKeyDB defaults allowed_models to null when omitted", () => {
    const created = createAPIKeyDB({ name: "Default Key" });
    createdIds.push(created.id);

    assert.equal(created.allowed_models, null);
});

test("IsModelAllowed permits any model when list is null or empty", () => {
    assert.equal(IsModelAllowed(null, "gpt-4o"), true);
    assert.equal(IsModelAllowed([], "gpt-4o"), true);
    assert.equal(IsModelAllowed(undefined, "gpt-4o"), true);
});

test("IsModelAllowed enforces allow-list membership", () => {
    const Allowed = ["gpt-4o", "claude-3-5-sonnet-20241022"];
    assert.equal(IsModelAllowed(Allowed, "gpt-4o"), true);
    assert.equal(IsModelAllowed(Allowed, "gpt-4o-mini"), false);
    assert.equal(IsModelAllowed(Allowed, "claude-3-5-sonnet-20241022"), true);
});

test("IsModelAllowed ignores srouter/ prefix when matching", () => {
    assert.equal(IsModelAllowed(["gpt-4o"], "srouter/gpt-4o"), true);
    assert.equal(IsModelAllowed(["srouter/gpt-4o"], "gpt-4o"), true);
});
