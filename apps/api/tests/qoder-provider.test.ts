import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { deleteProviderDB, getProviderByIdDB, upsertProviderDB } from "@srouter/db";
import type { ProviderConfig } from "@srouter/types";
import { AuthLogic } from "../src/logic/auth.logic.js";
import { AuthHandlers } from "../src/services/authHandlers.js";

const createdIds: string[] = [];
const originalFetch = globalThis.fetch;

afterEach(async () => {
    globalThis.fetch = originalFetch;
    const { registry } = await import("../src/services/registry.js");
    for (const id of createdIds.splice(0)) {
        deleteProviderDB(id);
        registry.unregisterProvider(id);
    }
});

test("saved Qoder connections initialize QoderExecutor on startup", async () => {
    const id = `qoder_test_${Date.now()}`;
    const fixtureToken = "dt-fixture-token";
    createdIds.push(id);

    const config: ProviderConfig = {
        id,
        providerId: "qoder",
        name: "Qoder Test Connection",
        category: "oauth",
        protocol: "openai",
        accessToken: fixtureToken,
        enabled: true,
        createdAt: Date.now()
    };
    upsertProviderDB(config);

    const { loadSavedProvidersFromDB, registry } = await import("../src/services/registry.js");
    loadSavedProvidersFromDB();

    const provider = registry.getProvider(id);
    assert.ok(provider);
    assert.equal(provider.id, id);
    assert.equal(provider.name, "Qoder Test Connection");
});

test("processQoderTokenImport stores Qoder provider and registers in registry", async () => {
    const config = AuthLogic.processQoderTokenImport({
        accessToken: "pt-my-pat-token",
        name: "My Qoder Account"
    });
    createdIds.push(config.id);

    assert.match(config.id, /^qoder_\d+$/);
    assert.equal(config.name, "My Qoder Account");
    assert.equal(config.category, "oauth");
    assert.equal(config.protocol, "openai");
    assert.equal(config.accessToken, "pt-my-pat-token");

    const saved = getProviderByIdDB(config.id);
    assert.equal(saved?.accessToken, "pt-my-pat-token");

    const { registry } = await import("../src/services/registry.js");
    const instance = registry.getProvider(config.id);
    assert.ok(instance);
});

test("initiateQoderOAuthPKCE generates valid Qoder authorization parameters", () => {
    const { authorizeUrl, state, codeVerifier } = AuthLogic.initiateQoderOAuthPKCE({});

    assert.ok(authorizeUrl.startsWith("https://qoder.com/device/selectAccounts"));
    assert.ok(authorizeUrl.includes("challenge_method=S256"));
    assert.ok(authorizeUrl.includes(`nonce=${encodeURIComponent(state)}`));
    assert.ok(codeVerifier.length > 0);
    assert.equal(AuthHandlers.Qoder.oauthSuccessMessage, "Login Qoder Berhasil!");
});

test("pollQoderDeviceToken polls upstream and creates provider when user authorizes", async () => {
    const { state } = AuthLogic.initiateQoderOAuthPKCE({});

    globalThis.fetch = async (input) => {
        const urlStr = String(input);
        if (urlStr.includes("/deviceToken/poll")) {
            return Response.json({
                token: "dt-polled-device-token",
                refresh_token: "rt-polled-device-token",
                user_id: "user-polled-id",
                expires_in: 86400
            });
        }
        if (urlStr.includes("/userinfo")) {
            return Response.json({
                name: "Seaavey Dev",
                email: "seaavey@example.com"
            });
        }
        return Response.json({});
    };

    const pollResult = await AuthLogic.pollQoderDeviceToken(state);
    assert.equal(pollResult.status, "ok");
    assert.ok(pollResult.provider);
    createdIds.push(pollResult.provider.id);

    assert.equal(pollResult.provider.accessToken, "dt-polled-device-token");
    assert.equal(pollResult.provider.name, "Qoder (Seaavey Dev)");
});
