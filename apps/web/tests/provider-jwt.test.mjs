import assert from "node:assert/strict";
import test from "node:test";

import {
    extractJwtEmail,
    getConnectionDisplayName
} from "../src/utils/provider-credentials.utils.ts";

function base64UrlEncode(payload) {
    const json = typeof payload === "string" ? payload : JSON.stringify(payload);
    return Buffer.from(json, "utf8")
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
}

function makeToken(payload) {
    return `eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.${base64UrlEncode(payload)}.sig`;
}

test("extractJwtEmail reads emails from unpadded base64url JWT payloads", () => {
    // 112 chars of payload → length % 4 === 0 setelah encode base64, jadi ini memaksa
    // kasus tanpa padding sama sekali.
    const token = makeToken({ email: "a@example.com" });
    assert.equal(extractJwtEmail(token), "a@example.com");
});

test("extractJwtEmail restores base64url padding for every residue class", () => {
    // Panjang base64url ter-enkode hanya pernah ≡ 0, 2, atau 3 (mod 4) — ≡ 1
    // tidak mungkin. Kasus mod 2 dan 3 butuh 1–2 char "=" yang dipangkas JWT;
    // dulu atob throw dan gagal diam-diam di catch kosong. Local-part email
    // divariasikan agar panjang byte payload bergeser tepat satu per langkah:
    // 27, 28, 29 byte → residu ter-enkode 0, 2, 3.
    const residues = new Set();
    for (const n of [0, 1, 2]) {
        const email = `pad${"x".repeat(n)}@example.com`;
        const segment = base64UrlEncode(JSON.stringify({ email }));
        residues.add(segment.length % 4);
        assert.equal(extractJwtEmail(`eyJhbGciOiJub25lIn0.${segment}.sig`), email, `n=${n}`);
    }
    assert.deepEqual([...residues].sort(), [0, 2, 3]);
});

test("extractJwtEmail falls back through provider-specific email fields", () => {
    const token = makeToken({
        "https://api.openai.com/profile": { email: "codex@example.com" }
    });
    assert.equal(extractJwtEmail(token), "codex@example.com");

    assert.equal(
        extractJwtEmail(makeToken({ user_metadata: { email: "meta@example.com" } })),
        "meta@example.com"
    );
    assert.equal(
        extractJwtEmail(makeToken({ preferred_username: "user@example.com" })),
        "user@example.com"
    );
    assert.equal(
        extractJwtEmail(makeToken({ unique_name: "named@example.com" })),
        "named@example.com"
    );
});

test("extractJwtEmail ignores non-email and malformed tokens", () => {
    assert.equal(extractJwtEmail(makeToken({ preferred_username: "not-an-email" })), undefined);
    assert.equal(extractJwtEmail("sk-plain-api-key"), undefined);
    assert.equal(extractJwtEmail("eyJno-dot"), undefined);
    assert.equal(extractJwtEmail("hdr.@bad-base64!.sig"), undefined);
    assert.equal(extractJwtEmail(undefined), undefined);
    assert.equal(extractJwtEmail(""), undefined);
});

test("getConnectionDisplayName prefers explicit email-named connections, then JWT, then name", () => {
    const jwt = makeToken({ email: "jwt@example.com" });

    assert.equal(
        getConnectionDisplayName({ name: "direct@example.com", accessToken: jwt }),
        "direct@example.com"
    );
    assert.equal(getConnectionDisplayName({ accessToken: jwt }), "jwt@example.com");
    assert.equal(getConnectionDisplayName({ name: "My Key" }), "My Key");
    assert.equal(getConnectionDisplayName({ name: "My Key" }, "Fallback"), "My Key");
    assert.equal(getConnectionDisplayName({}, "Fallback"), "Fallback");
    assert.equal(getConnectionDisplayName({}), undefined);
});

test("getConnectionDisplayName extracts email from apiKey when accessToken is absent", () => {
    const jwt = makeToken({ email: "key@example.com" });
    assert.equal(getConnectionDisplayName({ apiKey: jwt }), "key@example.com");
});
