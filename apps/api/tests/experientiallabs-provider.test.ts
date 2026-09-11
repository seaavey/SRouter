import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { deleteProviderDB, upsertProviderDB } from "@srouter/db";
import type { ProviderConfig } from "@srouter/types";

const createdIds: string[] = [];
const originalFetch = globalThis.fetch;

afterEach(async () => {
    globalThis.fetch = originalFetch;
    for (const id of createdIds.splice(0)) await deleteProviderDB(id);
});

test("saved Experiential Labs connections use the default gateway and explabs alias", async () => {
    const id = `experientiallabs_test_${Date.now()}`;
    const fixtureKey = "xpl_fixture_key";
    createdIds.push(id);

    const config: ProviderConfig = {
        id,
        providerId: "experientiallabs",
        name: "Experiential Labs Test",
        alias: "explabs",
        category: "api_key",
        protocol: "openai",
        apiKey: fixtureKey,
        enabled: true,
        createdAt: Date.now()
    };
    await upsertProviderDB(config);

    let requestUrl = "";
    let authorization = "";
    globalThis.fetch = async (input, init) => {
        requestUrl = String(input);
        authorization = new Headers(init?.headers).get("authorization") ?? "";
        return Response.json({ data: [{ id: "gpt-5.6-luna", object: "model" }] });
    };

    const { loadSavedProvidersFromDB, registry } = await import("../src/services/registry.js");
    await loadSavedProvidersFromDB();
    const provider = registry.getProvider(id);
    assert.ok(provider);
    const models = await provider.listModels();

    assert.equal(requestUrl, "https://api.experientiallabs.ai/v1/models");
    assert.equal(authorization, `Bearer ${fixtureKey}`);
    assert.deepEqual(models[0]?.id, "explabs/gpt-5.6-luna");

    registry.unregisterProvider(id);
});
