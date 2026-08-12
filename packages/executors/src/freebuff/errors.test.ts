import assert from "node:assert/strict";
import test from "node:test";
import { FreebuffAuthError, FreebuffRateLimitError, FreebuffUpstreamError, parseUpstreamError } from "./errors.js";

test("maps authentication rejection without exposing credentials", () => {
    const token = "freebuff-auth-token";
    const authorization = ["Bearer", token].join(" ");
    const error = parseUpstreamError(401, `token=${token}`, { authorization });
    assert.ok(error instanceof FreebuffAuthError);
    assert.equal(error.code, "AUTH_REJECTED");
    assert.equal(error.message.includes(token), false);
});

test("parses quota reset and retry-after values", () => {
    const error = parseUpstreamError(429, '{"message":"quota exceeded"}', { "retry-after": "12", "x-ratelimit-reset": "1700000012" });
    assert.ok(error instanceof FreebuffRateLimitError);
    assert.equal(error.retryAfterSeconds, 12);
    assert.equal(error.resetAt, 1700000012000);
});

test("maps bans, waiting rooms, invalid sessions, and invalid runs", () => {
    assert.equal(parseUpstreamError(403, '{"error":"banned","resumesAt":1700000012}', {}).code, "BANNED");
    assert.equal(parseUpstreamError(503, '{"error":"waiting room","position":4}', {}).code, "WAITING_ROOM");
    assert.equal(parseUpstreamError(400, '{"error":"session-invalid"}', {}).code, "SESSION_INVALID");
    assert.equal(parseUpstreamError(400, '{"error":"run-invalid"}', {}).code, "RUN_INVALID");
});

test("bounds and redacts opaque upstream body text", () => {
    const token = "freebuff-secret-token";
    const authorization = ["Bearer", token].join(" ");
    const error = parseUpstreamError(500, `${token} ${"x".repeat(5000)}`, { authorization });
    assert.ok(error instanceof FreebuffUpstreamError);
    assert.equal(error.body.length <= 2048, true);
    assert.equal(error.message.includes(token), false);
    assert.equal(error.message.includes("x".repeat(100)), true);
});

test("supports Error.cause and unwrap-equivalent predicates", () => {
    const cause = new Error("transport failed");
    const error = parseUpstreamError(502, "bad gateway", {}, cause);
    assert.equal(error.cause, cause);
    assert.equal(error.is("UPSTREAM"), true);
    assert.equal(error.is("AUTH_REJECTED"), false);
});
