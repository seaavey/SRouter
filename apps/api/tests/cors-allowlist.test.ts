import assert from "node:assert/strict";
import { test } from "node:test";
import { Hono } from "hono";
import { CreateCorsMiddleware, GetAllowedOrigin, ParseAllowedOrigins } from "../src/middleware/Cors.js";

function createTestApp(Allowlist = new Set<string>()) {
    const app = new Hono();
    app.use("/*", CreateCorsMiddleware(Allowlist));
    app.get("/v1/models", (c) => c.json({ ok: true }));
    app.post("/v1/chat/completions", (c) => c.json({ ok: true }));
    return app;
}

test("origin allowlist parsing trims and drops empties", () => {
    const Set = ParseAllowedOrigins(" https://dash.example.com , http://localhost:5173,, ");
    assert.deepEqual([...Set], ["https://dash.example.com", "http://localhost:5173"]);
    assert.equal(ParseAllowedOrigins(undefined).size, 0);
});

test("GetAllowedOrigin: loopback passes, allowlisted passes, unknown and missing fail", () => {
    const Allow = new Set(["https://dash.example.com"]);
    assert.equal(GetAllowedOrigin("http://localhost:5173", Allow), "http://localhost:5173");
    assert.equal(GetAllowedOrigin("https://127.0.0.1:3000", Allow), "https://127.0.0.1:3000");
    assert.equal(GetAllowedOrigin("https://dash.example.com", Allow), "https://dash.example.com");
    assert.equal(GetAllowedOrigin("https://evil.example.com", Allow), null);
    assert.equal(GetAllowedOrigin(undefined, Allow), null);
});

test("arbitrary public origin gets no CORS headers", async () => {
    const app = createTestApp();
    const res = await app.request("/v1/models", {
        headers: { Origin: "https://evil.example.com" }
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("access-control-allow-origin"), null);
});

test("preflight from arbitrary origin is not approved", async () => {
    const app = createTestApp();
    const res = await app.request("/v1/chat/completions", {
        method: "OPTIONS",
        headers: {
            Origin: "https://evil.example.com",
            "Access-Control-Request-Method": "POST"
        }
    });
    assert.equal(res.headers.get("access-control-allow-origin"), null);
});

test("allowlisted origin receives reflected origin with credentials", async () => {
    const app = createTestApp(new Set(["https://dash.example.com"]));
    const res = await app.request("/v1/models", {
        headers: { Origin: "https://dash.example.com" }
    });
    assert.equal(res.headers.get("access-control-allow-origin"), "https://dash.example.com");
    assert.equal(res.headers.get("access-control-allow-credentials"), "true");
});

test("loopback dev origins keep working", async () => {
    const app = createTestApp();
    const res = await app.request("/v1/models", {
        headers: { Origin: "http://localhost:5173" }
    });
    assert.equal(res.headers.get("access-control-allow-origin"), "http://localhost:5173");
});
