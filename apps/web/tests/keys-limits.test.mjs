import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
    compactNumber,
    formatLimitInput,
    groupThousands,
    parseKeyPayload,
    resolveLimitCaret,
    sanitizeLimitInput
} from "../src/components/keys/keys.form-types.ts";

const limitsSource = await readFile(
    new URL("../src/components/keys/keys.form-limits.tsx", import.meta.url),
    "utf8"
);

test("limit inputs reject non-numeric text at the boundary", () => {
    assert.doesNotMatch(limitsSource, /type="number"/);
    assert.match(limitsSource, /inputMode=\{allowDecimal \? "decimal" : "numeric"\}/);
    assert.match(limitsSource, /sanitizeLimitInput\(raw, allowDecimal, allowUnit\)/);
    assert.match(limitsSource, /resolveLimitCaret/);
});

test("sanitizeLimitInput keeps digits, two decimals, and one trailing token unit", () => {
    assert.equal(sanitizeLimitInput("12e3", false), "123");
    assert.equal(sanitizeLimitInput("-5", false), "5");
    assert.equal(sanitizeLimitInput("abc", false), "");
    assert.equal(sanitizeLimitInput("12.5", false), "125");
    assert.equal(sanitizeLimitInput("$1,200.50", true), "1200.50");
    assert.equal(sanitizeLimitInput("1.2.3", true), "1.23");
    assert.equal(sanitizeLimitInput("10.999", true), "10.99");
    assert.equal(sanitizeLimitInput(".", true), "");
    assert.equal(sanitizeLimitInput(".5", true), "0.5");
    assert.equal(sanitizeLimitInput("1.5m", true, true), "1.5M");
    assert.equal(sanitizeLimitInput("12t", false, true), "12T");
    assert.equal(sanitizeLimitInput("1.5X", true, true), "1.5");
});

test("formatLimitInput groups thousands and keeps the unit suffix", () => {
    assert.equal(formatLimitInput("1212121", false), "1,212,121");
    assert.equal(formatLimitInput("999", false), "999");
    assert.equal(formatLimitInput("1000", false), "1,000");
    assert.equal(formatLimitInput("1200.5", true), "1,200.5");
    assert.equal(formatLimitInput("1234.", true), "1,234.");
    assert.equal(formatLimitInput("1500000M", true, true), "1,500,000M");
    assert.equal(formatLimitInput("", false), "");
});

test("compactNumber renders the token shorthand offered to the user", () => {
    assert.equal(compactNumber(999), "999");
    assert.equal(compactNumber(1000), "1K");
    assert.equal(compactNumber(1500), "1.5K");
    assert.equal(compactNumber(1500000), "1.5M");
    assert.equal(compactNumber(2000000000), "2B");
    assert.equal(compactNumber(1212121212121), "1.21T");
});

test("resolveLimitCaret keeps the caret on the digit the user just typed", () => {
    assert.equal(resolveLimitCaret("1,0000", 6, "10,000"), 6);
    assert.equal(resolveLimitCaret("1,00", 4, "100"), 3);
    assert.equal(resolveLimitCaret("1,0500", 4, "10,500"), 4);
    assert.equal(resolveLimitCaret("0", 1, "0"), 1);
    assert.equal(resolveLimitCaret(",", 0, ""), 0);
});

test("grouping and shorthand resolve to the numbers the API expects", () => {
    assert.equal(groupThousands("1212121212121"), "1,212,121,212,121");

    const payload = parseKeyPayload({
        name: "  demo  ",
        enabled: true,
        rate_limit: sanitizeLimitInput("1,000", false),
        quota_limit: sanitizeLimitInput("1.5M", true, true),
        credit_limit: sanitizeLimitInput("$10.99", true),
        model_scope: "all",
        selected_models: []
    });

    assert.deepEqual(payload, {
        name: "demo",
        enabled: true,
        rate_limit: 1000,
        quota_limit: 1500000,
        credit_limit: 10.99,
        allowed_models: null
    });
});
