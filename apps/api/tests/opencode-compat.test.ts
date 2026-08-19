import test from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { chatRoute } from "../src/routes/v1/chat.js";
import { modelsRoute } from "../src/routes/v1/models.js";
import { providersRoute } from "../src/routes/v1/providers.js";

test("OpenCode Compatibility - supports both /v1 and root endpoints", async () => {
    const app = new Hono();
    app.route("/v1", modelsRoute);
    app.route("/v1", chatRoute);
    app.route("/v1", providersRoute);
    app.route("/", chatRoute);
    app.route("/", modelsRoute);
    app.route("/", providersRoute);

    // 1. Test GET /models and /v1/models without auth
    const modelsRes = await app.fetch(
        new Request("http://localhost:3000/models", {
            method: "GET"
        })
    );
    assert.equal(modelsRes.status, 200);

    const v1ModelsRes = await app.fetch(
        new Request("http://localhost:3000/v1/models", {
            method: "GET"
        })
    );
    assert.equal(v1ModelsRes.status, 200);

    // 2. Test GET /providers and /v1/providers without auth
    const providersRes = await app.fetch(
        new Request("http://localhost:3000/providers", {
            method: "GET"
        })
    );
    assert.equal(providersRes.status, 200);

    // 3. Test POST /v1/chat/completions (/v1 level)
    const chatRes = await app.fetch(
        new Request("http://localhost:3000/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: "Bearer sk-local-srouter"
            },
            body: JSON.stringify({
                model: "gorouter/claude-opus-4-8",
                messages: [
                    {
                        role: "user",
                        content: "Halo SRouter, tolong jawab singkat 'SRouter siap digunakan!'"
                    }
                ]
            })
        })
    );
    assert.notEqual(chatRes.status, 404);
    assert.notEqual(chatRes.status, 401);
    assert.equal(chatRes.status, 200);
});
