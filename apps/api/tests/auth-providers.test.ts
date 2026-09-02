import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { deleteProviderDB, getProviderByIdDB } from "@srouter/db";
import type { AIProvider, ProviderConfig } from "@srouter/types";
import { registry } from "../src/services/registry.js";
import { AuthLogic } from "../src/logic/auth.logic.js";
import { AuthHandlers } from "../src/services/authHandlers.js";
import type { AuthProviderHandler } from "@srouter/types";
import { GetPublicUrlBase, ResolveCallbackUrl } from "../src/utils/callbackUrl.js";

// CI has no SROUTER_PUBLIC_URL, so redirect URIs resolve to the local
// listener (127.0.0.1:1455) exactly as the handlers default.
const LOCAL_REDIRECT = "http://localhost:1455/auth/callback";
const LOCAL_REDIRECT_ANTIGRAVITY = "http://localhost:1455/auth/antigravity/callback";

const createdIds: string[] = [];

afterEach(async () => {
    for (const id of createdIds.splice(0)) {
        await deleteProviderDB(id);
        registry.unregisterProvider(id);
    }
});

test("processTokenImport stores an OAuth provider with accountId (Codex shape)", async () => {
    const config = await AuthLogic.processTokenImport({
        accessToken: "codex-token",
        refreshToken: "codex-refresh",
        accountId: "u_test_account"
    });

    createdIds.push(config.id);

    assert.match(config.id, /^openai_codex_\d+$/);
    assert.match(config.name, /^OpenAI Codex \(Account #\d+\)$/);
    assert.equal(config.category, "oauth");
    assert.equal(config.protocol, "openai");
    assert.equal(config.accessToken, "codex-token");
    assert.equal(config.accountId, "u_test_account");
    assert.equal(config.enabled, true);

    const saved = await getProviderByIdDB(config.id);
    assert.equal(saved?.accessToken, "codex-token");
    assert.equal(saved?.accountId, "u_test_account");
});

test("processTokenImport stores an api_key provider with baseUrl (CommandCode shape)", async () => {
    const config = await AuthLogic.processCommandCodeTokenImport({
        accessToken: "cc-token",
        baseUrl: "https://api.commandcode.example/alpha/generate",
        name: "My Command Code"
    });

    createdIds.push(config.id);

    assert.match(config.id, /^commandcode_\d+$/);
    assert.equal(config.name, "My Command Code");
    assert.equal(config.category, "api_key");
    assert.equal(config.protocol, "openai");
    assert.equal(config.base_url, "https://api.commandcode.example/alpha/generate");
    assert.equal(config.apiKey, "cc-token");
    assert.equal(config.accessToken, undefined);
});

test("generic logic (initiatePKCEFor) produces an authorizeUrl with expected state/client", async () => {
    const { authorizeUrl, state, codeVerifier, redirectUri } = await AuthLogic.initiateOAuthPKCE({});

    assert.ok(authorizeUrl.startsWith("https://auth.openai.com/oauth/authorize"));
    assert.ok(authorizeUrl.includes("code_challenge_method=S256"));
    assert.ok(authorizeUrl.includes(`state=${encodeURIComponent(state)}`));
    assert.ok(codeVerifier.length > 0);
    assert.equal(redirectUri, LOCAL_REDIRECT);
});

test("auth provider handlers carry preserved per-provider messages", async () => {
    assert.equal(AuthHandlers.OpenAI.oauthSuccessMessage, "Login OpenAI Codex Berhasil!");
    assert.equal(
        AuthHandlers.CommandCode.tokenImportMessage,
        "Command Code API Key registered and saved directly to SQLite database!"
    );
});

test("processTokenImportFor honors provided id and name", async () => {
    const handler: AuthProviderHandler = AuthHandlers.OpenAI;
    // Uses await AuthLogic.processTokenImport (Codex handler) with explicit id/name
    const config = await AuthLogic.processTokenImport({
        id: "my-custom-id",
        name: "Custom Label",
        accessToken: "tok"
    });

    createdIds.push(config.id);
    assert.equal(config.id, "my-custom-id");
    assert.equal(config.name, "Custom Label");
});

// Registry cleanup helper is inline above; ensure the executor is actually registered.
test("processTokenImport registers a live executor in the registry", async () => {
    const config = await AuthLogic.processTokenImport({ accessToken: "live-token" });
    createdIds.push(config.id);

    const instance = registry.getProvider(config.id) as AIProvider | undefined;
    assert.ok(instance, "expected a registered executor");
    assert.equal(instance.id, config.id);
});

test("ResolveCallbackUrl rewrites localhost to SROUTER_PUBLIC_URL and passes custom URIs through", () => {
    const original = process.env.SROUTER_PUBLIC_URL;
    try {
        process.env.SROUTER_PUBLIC_URL = "https://srouter.example.com/";
        assert.equal(
            ResolveCallbackUrl("http://localhost:1455/auth/callback"),
            "https://srouter.example.com/v1/auth/callback"
        );
        assert.equal(
            ResolveCallbackUrl("http://127.0.0.1:1455/auth/antigravity/callback"),
            "https://srouter.example.com/v1/auth/antigravity/callback"
        );
        // User-supplied custom callback must pass through untouched.
        assert.equal(
            ResolveCallbackUrl("https://myapp.example.com/cb"),
            "https://myapp.example.com/cb"
        );
        // A localhost URI already on the main /v1 path must not double up.
        assert.equal(
            ResolveCallbackUrl("http://localhost:3000/v1/auth/callback"),
            "https://srouter.example.com/v1/auth/callback"
        );
        assert.equal(GetPublicUrlBase(), "https://srouter.example.com");
    } finally {
        if (original === undefined) {
            delete process.env.SROUTER_PUBLIC_URL;
        } else {
            process.env.SROUTER_PUBLIC_URL = original;
        }
    }
});

test("ResolveCallbackUrl is a no-op without SROUTER_PUBLIC_URL", () => {
    const original = process.env.SROUTER_PUBLIC_URL;
    try {
        delete process.env.SROUTER_PUBLIC_URL;
        assert.equal(ResolveCallbackUrl("http://localhost:1455/auth/callback"), LOCAL_REDIRECT);
    } finally {
        if (original !== undefined) process.env.SROUTER_PUBLIC_URL = original;
    }
});
