import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { deleteProviderDB, upsertProviderDB } from "@srouter/db";
import type { ProviderConfig } from "@srouter/types";
import { AuthLogic } from "../src/logic/auth.logic.js";
import { goRouterAuthHandler } from "../src/services/authHandlers.js";

const createdIds: string[] = [];
const originalFetch = globalThis.fetch;

afterEach(() => {
    globalThis.fetch = originalFetch;
    for (const id of createdIds.splice(0)) deleteProviderDB(id);
});

test("saved GoRouter connections use the official URL and bearer auth", async () => {
    const id = `gorouter_test_${Date.now()}`;
    const fixtureKey = "fixture-key-not-a-secret";
    createdIds.push(id);

    const config: ProviderConfig = {
        id,
        providerId: "gorouter",
        name: "GoRouter Test",
        category: "api_key",
        protocol: "openai",
        accessToken: fixtureKey,
        enabled: true,
        createdAt: Date.now()
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

    assert.equal(requestUrl, "https://gorouter.app/v1/models");
    assert.equal(authorization.startsWith("Bearer "), true);
    assert.equal(authorization.endsWith(fixtureKey), true);

    registry.unregisterProvider(id);
});

test("processGoRouterTokenImport creates and registers GoRouter provider config", () => {
    const config = AuthLogic.processGoRouterTokenImport({
        accessToken: "test-gorouter-key",
        name: "My GoRouter Account"
    });

    createdIds.push(config.id);

    assert.match(config.id, /^gorouter_\d+$/);
    assert.equal(config.name, "My GoRouter Account");
    assert.equal(config.category, "api_key");
    assert.equal(config.protocol, "openai");
    assert.equal(config.baseUrl, "https://gorouter.app/v1");
    assert.equal(config.apiKey, "test-gorouter-key");
    assert.equal(config.enabled, true);
    assert.equal(
        goRouterAuthHandler.tokenImportMessage,
        "GoRouter API Key registered and saved directly to SQLite database!"
    );
});
