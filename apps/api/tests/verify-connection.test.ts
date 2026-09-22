import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { Hono } from "hono";
import type { ProviderConfig } from "@srouter/types";
import { deleteProviderDB, upsertProviderDB } from "@srouter/db";
import { ProvidersController } from "../src/controllers/providers.controller.js";
import { ProvidersRouter } from "../src/routes/v1/providers.js";

const createdIds: string[] = [];

afterEach(async () => {
    for (const id of createdIds.splice(0)) {
        await deleteProviderDB(id);
    }
});

/** Full router with real middleware — used to assert the auth gate stays on. */
function AuthedApp() {
    const app = new Hono();
    app.route("/v1", ProvidersRouter);
    return app;
}

/** Controller wired without middleware — covers validation, logic, envelopes. */
function DirectApp() {
    const app = new Hono();
    app.post("/verify-direct", ProvidersController.VerifySavedConnection);
    return app;
}

let nextId = 0;
function SeedConnection(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
    nextId += 1;
    return {
        id: `verify-test-${nextId}`,
        providerId: "openai",
        name: `Verify Test ${nextId}`,
        category: "custom_provider",
        protocol: "openai",
        base_url: "https://nonexistent.invalid/v1",
        apiKey: "sk-test-credential",
        enabled: true,
        createdAt: Date.now(),
        ...overrides
    };
}

test("POST /v1/providers/connections/verify requires admin auth", async () => {
    const res = await AuthedApp().request("/v1/providers/connections/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connection_id: "anything" })
    });
    assert.equal(res.status, 401);
});

test("direct handler rejects empty body and non-string connection_id", async () => {
    const app = DirectApp();

    const empty = await app.request("/verify-direct", {
        method: "POST",
        headers: { "Content-Type": "application/json" }
    });
    assert.equal(empty.status, 400);

    const wrong = await app.request("/verify-direct", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connection_id: 42 })
    });
    assert.equal(wrong.status, 400);
});

test("unknown connection id is reported via 404", async () => {
    const res = await DirectApp().request("/verify-direct", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connection_id: "definitely-not-registered" })
    });
    assert.equal(res.status, 404);
    const body = (await res.json()) as { error?: { message?: string } };
    assert.match(body.error?.message ?? "", /not found/);
});

test("connection without stored credential is reported, not thrown", async () => {
    const Seeded = SeedConnection({ apiKey: undefined, accessToken: undefined });
    await upsertProviderDB({ ...Seeded, category: "custom_provider", protocol: "openai" });
    const app = DirectApp();

    const res = await app.request("/verify-direct", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connection_id: Seeded.id })
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { success: boolean; message: string; connection_id: string };
    assert.equal(body.success, false);
    assert.match(body.message, /no stored credential/);
    assert.equal(body.connection_id, Seeded.id);
});

test("verify probes upstream and fails gracefully on unresolvable host", async () => {
    const Seeded = SeedConnection();
    await upsertProviderDB({ ...Seeded, category: "custom_provider", protocol: "openai" });
    const app = DirectApp();

    const res = await app.request("/verify-direct", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connection_id: Seeded.id })
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { success: boolean; message: string };
    assert.equal(body.success, false);
    // SSRF guard rejects non-resolvable hosts before any fetch is made.
    assert.ok(body.message.length > 0);
});
