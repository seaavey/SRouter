import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createFallbackRuleDB, deleteFallbackRuleDB, getFallbackRuleByIdDB } from "@srouter/db";
import { Hono } from "hono";
import { settingsRoute } from "../src/routes/v1/settings.js";
import { ADMIN_SESSION_COOKIE, createAdminSession } from "../src/services/adminAuth.js";

const createdRuleIds: string[] = [];

afterEach(() => {
    for (const id of createdRuleIds.splice(0)) {
        deleteFallbackRuleDB(id);
    }
});

function getAuthHeaders(extraHeaders: Record<string, string> = {}) {
    const sessionToken = createAdminSession();
    return {
        Cookie: `${ADMIN_SESSION_COOKIE}=${sessionToken}`,
        ...extraHeaders
    };
}

test("GET /settings/fallbacks returns all configured fallback rules", async () => {
    const rule = createFallbackRuleDB({
        sourceModel: "test/endpoint-src",
        targetModel: "test/endpoint-dst",
        priority: 1,
        enabled: true
    });
    createdRuleIds.push(rule.id);

    const app = new Hono();
    app.route("/v1", settingsRoute);

    const res = await app.request("/v1/settings/fallbacks", {
        method: "GET",
        headers: getAuthHeaders()
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as { fallbacks: Array<{ id: string; sourceModel: string }> };
    assert.ok(Array.isArray(body.fallbacks));
    assert.ok(body.fallbacks.some((f) => f.id === rule.id));
});

test("POST /settings/fallbacks creates a new fallback rule", async () => {
    const app = new Hono();
    app.route("/v1", settingsRoute);

    const res = await app.request("/v1/settings/fallbacks", {
        method: "POST",
        headers: getAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
            sourceModel: "openai_codex/gpt-4o",
            targetModel: "antigravity/gemini-2.5-pro",
            priority: 2,
            enabled: true,
            triggerOnStatus: [429, 500, 502, 503]
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
    const rule = createFallbackRuleDB({
        sourceModel: "test/to-update-src",
        targetModel: "test/to-update-dst",
        priority: 1,
        enabled: true
    });
    createdRuleIds.push(rule.id);

    const app = new Hono();
    app.route("/v1", settingsRoute);

    // Update rule
    const updateRes = await app.request(`/v1/settings/fallbacks/${rule.id}`, {
        method: "PUT",
        headers: getAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
            targetModel: "test/updated-dst",
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
        headers: getAuthHeaders()
    });

    assert.equal(deleteRes.status, 200);
    assert.equal(getFallbackRuleByIdDB(rule.id), null);
});
