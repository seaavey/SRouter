import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { deleteProviderDB, upsertProviderDB } from "@srouter/db";
import type { ProviderConfig } from "@srouter/types";

const createdIds: string[] = [];
const originalFetch = globalThis.fetch;

afterEach(() => {
    globalThis.fetch = originalFetch;
    for (const id of createdIds.splice(0)) deleteProviderDB(id);
});

test("saved Neosantara connections use the official URL and bearer auth", async () => {
    const id = `neosantara_test_${Date.now()}`;
    const fixtureKey = "fixture-key-not-a-secret";
    createdIds.push(id);

    const config: ProviderConfig = {
        id,
        providerId: "neosantara",
        name: "Neosantara Test",
        category: "api_key",
        protocol: "openai",
        accessToken: fixtureKey,
        enabled: true,
        createdAt: Date.now(),
    };
    upsertProviderDB(config);

    let requestUrl = "";
    let authorization = "";
    globalThis.fetch = async (input, init) => {
        requestUrl = String(input);
        authorization = new Headers(init?.headers).get("authorization") ?? "";
        return Response.json({ data: [] });
    };

    const { loadSavedProvidersFromDB, registry } = await import("../src/services/registry.js");
    loadSavedProvidersFromDB();
    const provider = registry.getProvider(id);
    assert.ok(provider);
    await provider.listModels();

    assert.equal(requestUrl, "https://api.neosantara.xyz/v1/models");
    assert.equal(authorization.startsWith("Bearer "), true);
    assert.equal(authorization.endsWith(fixtureKey), true);

    registry.unregisterProvider(id);
});
