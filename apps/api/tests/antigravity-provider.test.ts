import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { deleteProviderDB, getProviderByIdDB } from "@srouter/db";
import type { AIProvider } from "@srouter/types";
import { registry } from "../src/services/registry.js";
import { AuthLogic } from "../src/logic/auth.logic.js";

const createdIds: string[] = [];

afterEach(() => {
    for (const id of createdIds.splice(0)) {
        deleteProviderDB(id);
        registry.unregisterProvider(id);
    }
});

test("saved Antigravity connections initialize AntigravityExecutor and list models", async () => {
    const config = AuthLogic.processAntigravityTokenImport({
        accessToken: "ya29.test_antigravity_token",
        refreshToken: "1//test_refresh_token"
    });

    createdIds.push(config.id);

    assert.match(config.id, /^antigravity_\d+$/);
    assert.equal(config.category, "oauth");
    assert.equal(config.protocol, "openai");
    assert.equal(config.accessToken, "ya29.test_antigravity_token");
    assert.equal(config.refreshToken, "1//test_refresh_token");

    const saved = getProviderByIdDB(config.id);
    assert.equal(saved?.accessToken, "ya29.test_antigravity_token");
    assert.equal(saved?.refreshToken, "1//test_refresh_token");

    const instance = registry.getProvider(config.id) as AIProvider | undefined;
    assert.ok(instance, "expected a registered Antigravity executor");
    const models = await instance.listModels();
    assert.ok(models.length > 0);
    assert.ok(models.some((m) => m.id === "gemini-3.7-flash-high"));
});

test("initiateAntigravityOAuth generates valid Antigravity authorization parameters", () => {
    const { authorizeUrl, state, codeVerifier, redirectUri } =
        AuthLogic.initiateAntigravityOAuthPKCE({});

    assert.ok(authorizeUrl.startsWith("https://accounts.google.com/o/oauth2/v2/auth"));
    assert.ok(authorizeUrl.includes("code_challenge_method=S256"));
    assert.ok(authorizeUrl.includes(`state=${encodeURIComponent(state)}`));
    assert.ok(codeVerifier.length > 0);
    assert.equal(redirectUri, "http://localhost:1455/auth/antigravity/callback");
});
