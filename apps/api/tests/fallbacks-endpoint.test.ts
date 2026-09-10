import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createFallbackRuleDB, deleteFallbackRuleDB, getFallbackRuleByIdDB } from "@srouter/db";
import { Hono } from "hono";
import { SettingsRouter } from "../src/routes/v1/settings.js";
import { ADMIN_SESSION_COOKIE, createAdminSession } from "../src/services/adminAuth.js";

const createdRuleIds: string[] = [];

afterEach(async () => {
    for (const id of createdRuleIds.splice(0)) {
        await await deleteFallbackRuleDB(id);
    }
});

async function getAuthHeaders(extraHeaders: Record<string, string> = {}) {
    const sessionToken = await createAdminSession();
    return {
        Cookie: `${ADMIN_SESSION_COOKIE}=${sessionToken}`,
        ...extraHeaders
    };
}

test("GET /settings/fallbacks returns all configured fallback rules", async () => {
    const rule = await await createFallbackRuleDB({
        sourceModel: "test/endpoint-src",
        targetModel: "test/endpoint-dst",
        priority: 1,
        enabled: true
    });
    createdRuleIds.push(rule.id);

    const app = new Hono();
    app.route("/v1", SettingsRouter);

    const res = await app.request("/v1/settings/fallbacks", {
        method: "GET",
        headers: await getAuthHeaders()
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as { fallbacks: Array<{ id: string; sourceModel: string }> };
    assert.ok(Array.isArray(body.fallbacks));
    assert.ok(body.fallbacks.some((f) => f.id === rule.id));
});

test("POST /settings/fallbacks creates a new fallback rule", async () => {
    const app = new Hono();
    app.route("/v1", SettingsRouter);

    const res = await app.request("/v1/settings/fallbacks", {
        method: "POST",
        headers: await getAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
            source_model: "openai_codex/gpt-4o",
            target_model: "antigravity/gemini-2.5-pro",
            priority: 2,
            enabled: true,
            trigger_on_status: [429, 500, 502, 503]
        })
    });

    assert.equal(res.status, 201);
    const body = (await res.json()) as {
        fallback: { id: string; sourceModel: string; targetModel: string };
    };
    assert.ok(body.fallback.id);
    createdRuleIds.push(body.fallback.id);
    assert.equal(body.fallback.sourceModel, "openai_codex/gpt-4o");
    assert.equal(body.fallback.targetModel, "antigravity/gemini-2.5-pro");
});

test("PUT and DELETE /settings/fallbacks/:id updates and removes fallback rule", async () => {
    const rule = await await createFallbackRuleDB({
        sourceModel: "test/to-update-src",
        targetModel: "test/to-update-dst",
        priority: 1,
        enabled: true
    });
    createdRuleIds.push(rule.id);

    const app = new Hono();
    app.route("/v1", SettingsRouter);

    // Update rule
    const updateRes = await app.request(`/v1/settings/fallbacks/${rule.id}`, {
        method: "PUT",
        headers: await getAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
            target_model: "test/updated-dst",
            enabled: false
        })
    });

    assert.equal(updateRes.status, 200);
    const updatedBody = (await updateRes.json()) as {
        fallback: { targetModel: string; enabled: boolean };
    };
    assert.equal(updatedBody.fallback.targetModel, "test/updated-dst");
    assert.equal(updatedBody.fallback.enabled, false);

    // Delete rule
    const deleteRes = await app.request(`/v1/settings/fallbacks/${rule.id}`, {
        method: "DELETE",
        headers: await getAuthHeaders()
    });

    assert.equal(deleteRes.status, 200);
    assert.equal(await await getFallbackRuleByIdDB(rule.id), null);
});

test("POST /settings/fallbacks rejects camelCase request keys", async () => {
    const app = new Hono();
    app.route("/v1", SettingsRouter);

    const res = await app.request("/v1/settings/fallbacks", {
        method: "POST",
        headers: await getAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
            sourceModel: "openai/gpt-4o",
            targetModel: "anthropic/claude-3-5-sonnet"
        })
    });

    assert.equal(res.status, 400);
});