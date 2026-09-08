import assert from "node:assert/strict";
import test from "node:test";
import { isDatabaseFile } from "../src/components/settings/settings.data.tsx";

test("accepts database files by extension regardless of case", () => {
    assert.equal(isDatabaseFile(new File([], "gateway.db")), true);
    assert.equal(isDatabaseFile(new File([], "GATEWAY.DB")), true);
});

test("rejects missing and non-database files", () => {
    assert.equal(isDatabaseFile(undefined), false);
    assert.equal(isDatabaseFile(new File([], "gateway.json")), false);
    assert.equal(isDatabaseFile(new File([], "gateway.db.bak")), false);
});
