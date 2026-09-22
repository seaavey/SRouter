import assert from "node:assert/strict";
import test from "node:test";

import { authProviderIdOf, splitTokenLines } from "../src/utils/provider-oauth.utils.ts";

test("authProviderIdOf strips instance suffixes from provider ids", () => {
    assert.equal(authProviderIdOf("openai"), "openai");
    assert.equal(authProviderIdOf("openai_codex"), "openai");
    assert.equal(authProviderIdOf("openai-codex"), "openai");
    assert.equal(authProviderIdOf("claude_personal_2"), "claude");
});

test("authProviderIdOf keeps the codebuddy-cn variant intact", () => {
    assert.equal(authProviderIdOf("codebuddy-cn"), "codebuddy-cn");
    assert.equal(authProviderIdOf("codebuddy_cn"), "codebuddy");
});

test("authProviderIdOf returns an empty base for empty input", () => {
    assert.equal(authProviderIdOf(""), "");
});

test("splitTokenLines trims lines, drops blanks, and handles CRLF", () => {
    assert.deepEqual(splitTokenLines("a\nb\n"), ["a", "b"]);
    assert.deepEqual(splitTokenLines("  a  \r\n\r\n b \n\n"), ["a", "b"]);
    assert.deepEqual(splitTokenLines(""), []);
    assert.deepEqual(splitTokenLines("   \n  \n"), []);
});

test("splitTokenLines keeps the optional access,refresh pair on one line", () => {
    assert.deepEqual(splitTokenLines("access,refresh\nplain"), ["access,refresh", "plain"]);
});
