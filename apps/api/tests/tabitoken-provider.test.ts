import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { deleteProviderDB, upsertProviderDB } from "@srouter/db";
import type { ProviderConfig } from "@srouter/types";
import { AuthLogic } from "../src/logic/auth.logic.js";
import { tabiTokenAuthHandler } from "../src/services/authHandlers.js";

const createdIds: string[] = [];
const originalFetch = globalThis.fetch;

afterEach(() => {
    globalThis.fetch = originalFetch;
    for (const id of createdIds.splice(0)) deleteProviderDB(id);
});

test("saved TabiToken connections use the official URL and bearer auth", async () => {
    const id = `tabitoken_test_${Date.now()}`;
    const fixtureKey = "fixture-key-not-a-secret";
    createdIds.push(id);

    const config: ProviderConfig = {
        id,
        providerId: "tabitoken",
        name: "TabiToken Test",
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

    assert.equal(requestUrl, "https://tabitoken.com/v1/models");
    assert.equal(authorization.startsWith("Bearer "), true);
    assert.equal(authorization.endsWith(fixtureKey), true);

    registry.unregisterProvider(id);
});

test("processTabiTokenTokenImport creates and registers TabiToken provider config", () => {
    const config = AuthLogic.processTabiTokenTokenImport({
        accessToken: "test-tabitoken-key",
        name: "My TabiToken Account"
    });

    createdIds.push(config.id);

    assert.match(config.id, /^tabitoken_\d+$/);
    assert.equal(config.name, "My TabiToken Account");
    assert.equal(config.category, "api_key");
    assert.equal(config.protocol, "openai");
    assert.equal(config.baseUrl, "https://tabitoken.com/v1");
    assert.equal(config.apiKey, "test-tabitoken-key");
    assert.equal(config.enabled, true);
    assert.equal(
        tabiTokenAuthHandler.tokenImportMessage,
        "TabiToken API Key registered and saved directly to SQLite database!"
    );
});
