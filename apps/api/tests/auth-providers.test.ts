import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { deleteProviderDB, getProviderByIdDB } from "@srouter/db";
import type { AIProvider, ProviderConfig } from "@srouter/types";
import { registry } from "../src/services/registry.js";
import { AuthLogic } from "../src/logic/auth.logic.js";
import {
    commandCodeAuthHandler,
    openaiCodexAuthHandler,
    type AuthProviderHandler,
} from "../src/logic/auth.providers.js";

const createdIds: string[] = [];

afterEach(() => {
    for (const id of createdIds.splice(0)) {
        deleteProviderDB(id);
        registry.unregisterProvider(id);
    }
});

test("processTokenImport stores an OAuth provider with accountId (Codex shape)", () => {
    const config = AuthLogic.processTokenImport({
        accessToken: "codex-token",
        refreshToken: "codex-refresh",
        accountId: "u_test_account",
    });

    createdIds.push(config.id);

    assert.match(config.id, /^openai_codex_\d+$/);
    assert.match(config.name, /^OpenAI Codex \(Account #\d+\)$/);
    assert.equal(config.category, "oauth");
    assert.equal(config.protocol, "openai");
    assert.equal(config.accessToken, "codex-token");
    assert.equal(config.accountId, "u_test_account");
    assert.equal(config.enabled, true);

    const saved = getProviderByIdDB(config.id);
    assert.equal(saved?.accessToken, "codex-token");
    assert.equal(saved?.accountId, "u_test_account");
});

test("processTokenImport stores an api_key provider with baseUrl (CommandCode shape)", () => {
    const config = AuthLogic.processCommandCodeTokenImport({
        accessToken: "cc-token",
        baseUrl: "https://api.commandcode.example/alpha/generate",
        name: "My Command Code",
    });

    createdIds.push(config.id);

    assert.match(config.id, /^commandcode_\d+$/);
    assert.equal(config.name, "My Command Code");
    assert.equal(config.category, "api_key");
    assert.equal(config.protocol, "openai");
    assert.equal(config.baseUrl, "https://api.commandcode.example/alpha/generate");
    assert.equal(config.apiKey, "cc-token");
    assert.equal(config.accessToken, undefined);
});

test("generic logic (initiatePKCEFor) produces an authorizeUrl with expected state/client", () => {
    const { authorizeUrl, state, codeVerifier, redirectUri } = AuthLogic.initiateOAuthPKCE({});

    assert.ok(authorizeUrl.startsWith("https://auth.openai.com/oauth/authorize"));
    assert.ok(authorizeUrl.includes("code_challenge_method=S256"));
    assert.ok(authorizeUrl.includes(`state=${encodeURIComponent(state)}`));
    assert.ok(codeVerifier.length > 0);
    assert.equal(redirectUri, "http://localhost:1455/auth/callback");
});

test("auth provider handlers carry preserved per-provider messages", () => {
    assert.equal(openaiCodexAuthHandler.oauthSuccessMessage, "Login OpenAI Codex Berhasil!");
    assert.equal(commandCodeAuthHandler.tokenImportMessage, "Command Code API Key registered and saved directly to SQLite database!");
});

test("processTokenImportFor honors provided id and name", () => {
    const handler: AuthProviderHandler = openaiCodexAuthHandler;
    // Uses AuthLogic.processTokenImport (Codex handler) with explicit id/name
    const config = AuthLogic.processTokenImport({
        id: "my-custom-id",
        name: "Custom Label",
        accessToken: "tok",
    });

    createdIds.push(config.id);
    assert.equal(config.id, "my-custom-id");
    assert.equal(config.name, "Custom Label");
});

// Registry cleanup helper is inline above; ensure the executor is actually registered.
test("processTokenImport registers a live executor in the registry", () => {
    const config = AuthLogic.processTokenImport({ accessToken: "live-token" });
    createdIds.push(config.id);

    const instance = registry.getProvider(config.id) as AIProvider | undefined;
    assert.ok(instance, "expected a registered executor");
    assert.equal(instance.id, config.id);
});
