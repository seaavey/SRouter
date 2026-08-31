import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
    addCreditAPIKeyDB,
    createAPIKeyDB,
    deleteAPIKeyDB,
    getAPIKeyByKeyDB,
    incrementAPIKeyUsageDB
} from "@srouter/db";

const createdIds: string[] = [];

afterEach(() => {
    for (const id of createdIds.splice(0)) {
        deleteAPIKeyDB(id);
    }
});

test("createAPIKeyDB stores creditLimit and usageCost default to 0", () => {
    const key = createAPIKeyDB({
        name: "Test Credit Key",
        credit_limit: 15.5
    });
    createdIds.push(key.id);

    assert.equal(key.credit_limit, 15.5);
    assert.equal(key.usage_cost, 0);

    const lookup = getAPIKeyByKeyDB(key.key);
    assert.ok(lookup);
    assert.equal(lookup?.credit_limit, 15.5);
    assert.equal(lookup?.usage_cost, 0);
});

test("incrementAPIKeyUsageDB increments tokens and dollar cost", () => {
    const key = createAPIKeyDB({
        name: "Usage Test Key",
        credit_limit: 20
    });
    createdIds.push(key.id);

    incrementAPIKeyUsageDB(key.id, 500, 0.025);

    const lookup = getAPIKeyByKeyDB(key.key);
    assert.ok(lookup);
    assert.equal(lookup?.usage_tokens, 500);
    assert.equal(Math.round((lookup?.usage_cost ?? 0) * 1000) / 1000, 0.025);
});

test("addCreditAPIKeyDB increases creditLimit", () => {
    const key = createAPIKeyDB({
        name: "Add Credit Test Key",
        credit_limit: 10
    });
    createdIds.push(key.id);

    const updated = addCreditAPIKeyDB(key.id, 5.25);
    assert.ok(updated);
    assert.equal(updated?.credit_limit, 15.25);

    const lookup = getAPIKeyByKeyDB(key.key);
    assert.equal(lookup?.credit_limit, 15.25);
});
