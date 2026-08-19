import test from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { chatRoute } from "../src/routes/v1/chat.js";
import { modelsRoute } from "../src/routes/v1/models.js";
import { providersRoute } from "../src/routes/v1/providers.js";

test("OpenCode Compatibility - chat route accepts unauthenticated local requests", async () => {
    const app = new Hono();
    app.route("/v1", modelsRoute);
    app.route("/v1", chatRoute);
    app.route("/v1", providersRoute);

    // 1. Test GET /v1/models without auth
    const modelsRes = await app.fetch(
        new Request("http://localhost:3000/v1/models", {
            method: "GET"
        })
    );
    assert.equal(modelsRes.status, 200);

    // 2. Test GET /v1/providers without auth
    const providersRes = await app.fetch(
        new Request("http://localhost:3000/v1/providers", {
            method: "GET"
        })
    );
    assert.equal(providersRes.status, 200);

    // 3. Test POST /v1/chat/completions with apiKey "sk-local-srouter" or empty
    const chatRes = await app.fetch(
        new Request("http://localhost:3000/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: "Bearer sk-local-srouter"
            },
            body: JSON.stringify({
                model: "gorouter/claude-opus-4-8",
                messages: [{ role: "user", content: "hello" }]
            })
        })
    );

    // Should NOT return 401 Admin authentication is required
    assert.notEqual(chatRes.status, 401);
    const body = (await chatRes.json()) as any;
    assert.notEqual(body?.error?.message, "Admin authentication is required");
});
