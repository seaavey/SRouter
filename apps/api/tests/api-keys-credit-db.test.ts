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
        creditLimit: 15.5
    });
    createdIds.push(key.id);

    assert.equal(key.creditLimit, 15.5);
    assert.equal(key.usageCost, 0);

    const lookup = getAPIKeyByKeyDB(key.key);
    assert.ok(lookup);
    assert.equal(lookup?.creditLimit, 15.5);
    assert.equal(lookup?.usageCost, 0);
});

test("incrementAPIKeyUsageDB increments tokens and dollar cost", () => {
    const key = createAPIKeyDB({
        name: "Usage Test Key",
        creditLimit: 20
    });
    createdIds.push(key.id);

    incrementAPIKeyUsageDB(key.id, 500, 0.025);

    const lookup = getAPIKeyByKeyDB(key.key);
    assert.ok(lookup);
    assert.equal(lookup?.usageTokens, 500);
    assert.equal(Math.round((lookup?.usageCost ?? 0) * 1000) / 1000, 0.025);
});

test("addCreditAPIKeyDB increases creditLimit", () => {
    const key = createAPIKeyDB({
        name: "Add Credit Test Key",
        creditLimit: 10
    });
    createdIds.push(key.id);

    const updated = addCreditAPIKeyDB(key.id, 5.25);
    assert.ok(updated);
    assert.equal(updated?.creditLimit, 15.25);

    const lookup = getAPIKeyByKeyDB(key.key);
    assert.equal(lookup?.creditLimit, 15.25);
});
