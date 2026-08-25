import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
    deleteProviderDB,
    fetchCodeBuddyCNLiveQuota,
    saveOAuthSessionDB,
    upsertProviderDB
} from "@srouter/db";
import { CODEBUDDY_CN_BASE_URL, providerById } from "@srouter/constants";
import type { ProviderConfig } from "@srouter/types";
import { AuthLogic } from "../src/logic/auth.logic.js";
import { AuthHandlers } from "../src/services/authHandlers.js";
import { CodeBuddyCNOAuth } from "@srouter/providers";
import { ProvidersLogic } from "../src/logic/providers.logic.js";

const createdIds: string[] = [];
const originalFetch = globalThis.fetch;

afterEach(() => {
    globalThis.fetch = originalFetch;
    for (const id of createdIds.splice(0)) deleteProviderDB(id);
});

test("saved CodeBuddy connections instantiate CodeBuddyExecutor and list models", async () => {
    const id = `codebuddy_test_${Date.now()}`;
    const fixtureKey = "codebuddy-test-token";
    createdIds.push(id);

    const config: ProviderConfig = {
        id,
        providerId: "codebuddy",
        name: "CodeBuddy Test",
        category: "oauth",
        protocol: "openai",
        accessToken: fixtureKey,
        enabled: true,
        createdAt: Date.now()
    };
    upsertProviderDB(config);

    const { loadSavedProvidersFromDB, registry } = await import("../src/services/registry.js");
    loadSavedProvidersFromDB();
    const provider = registry.getProvider(id);
    assert.ok(provider);
    const models = await provider.listModels();

    assert.ok(models.length > 0);
    assert.ok(models.some((m) => m.id === "codebuddy/glm-5.2"));

    registry.unregisterProvider(id);
});

test("processCodeBuddyTokenImport creates and registers CodeBuddy provider config", () => {
    const config = AuthLogic.processCodeBuddyTokenImport({
        accessToken: "test-codebuddy-key",
        name: "My CodeBuddy Account"
    });

    createdIds.push(config.id);

    assert.match(config.id, /^codebuddy_\d+$/);
    assert.equal(config.name, "My CodeBuddy Account");
    assert.equal(config.category, "oauth");
    assert.equal(config.protocol, "openai");
    assert.equal(config.baseUrl, "https://www.codebuddy.ai/v2/chat/completions");
    assert.equal(config.accessToken, "test-codebuddy-key");
    assert.equal(config.enabled, true);
    assert.equal(
        AuthHandlers.CodeBuddy.tokenImportMessage,
        "CodeBuddy Access Token registered and saved directly to SQLite database!"
    );
});

test("CodeBuddy CN is registered as a connectable OAuth provider", () => {
    const provider = providerById("codebuddy-cn");

    assert.ok(provider);
    assert.equal(provider.name, "CodeBuddy CN");
    assert.equal(provider.baseUrl, CODEBUDDY_CN_BASE_URL);
    assert.equal(provider.websiteUrl, "https://www.codebuddy.cn");
    assert.equal(provider.requiresOAuth, true);
});

test("CodeBuddy CN token import creates a CN provider connection", () => {
    const config = AuthLogic.processProviderTokenImport("codebuddy-cn", {
        accessToken: "test-codebuddy-cn-token",
        name: "My CodeBuddy CN Account"
    });

    createdIds.push(config.id);

    assert.match(config.id, /^codebuddy-cn_\d+$/);
    assert.equal(config.providerId, "codebuddy-cn");
    assert.equal(config.name, "My CodeBuddy CN Account");
    assert.equal(config.baseUrl, CODEBUDDY_CN_BASE_URL);
    assert.equal(config.accessToken, "test-codebuddy-cn-token");
    assert.equal(
        AuthHandlers.CodeBuddyCN.tokenImportMessage,
        "CodeBuddy CN Access Token registered and saved directly to SQLite database!"
    );
});

test("CodeBuddy CN connections stay grouped under the CN catalog entry", () => {
    const before = ProvidersLogic.ListProviders();
    const cnBefore =
        before.find((provider) => provider.id === "codebuddy-cn")?.status.connectedCount ?? 0;
    const globalBefore =
        before.find((provider) => provider.id === "codebuddy")?.status.connectedCount ?? 0;

    const config = AuthLogic.processProviderTokenImport("codebuddy-cn", {
        accessToken: "test-codebuddy-cn-catalog-token"
    });
    createdIds.push(config.id);

    const catalog = ProvidersLogic.ListProviders();
    const global = catalog.find((provider) => provider.id === "codebuddy");
    const cn = catalog.find((provider) => provider.id === "codebuddy-cn");

    assert.equal(cn?.status.connectedCount, cnBefore + 1);
    assert.equal(global?.status.connectedCount, globalBefore);
});

test("initiateCodeBuddyCNOAuth uses Tencent's CN auth endpoint", async () => {
    let requestedUrl = "";
    let requestedOrigin = "";
    let requestedUserAgent = "";
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        requestedUrl = String(input);
        requestedOrigin = new Headers(init?.headers).get("origin") ?? "";
        requestedUserAgent = new Headers(init?.headers).get("user-agent") ?? "";
        return new Response(
            JSON.stringify({
                code: 0,
                msg: "ok",
                data: {
                    state: "test-codebuddy-cn-state",
                    authUrl: "https://copilot.tencent.com/login?state=test-codebuddy-cn-state"
                }
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
        );
    };

    const result = await AuthLogic.initiateCodeBuddyCNOAuth();

    assert.equal(
        requestedUrl,
        "https://copilot.tencent.com/v2/plugin/auth/state?platform=CLI&ioa=1"
    );
    assert.equal(requestedOrigin, "https://www.codebuddy.cn");
    assert.equal(requestedUserAgent, "CLI/2.96.0 CodeBuddy/2.96.0");
    assert.equal(result.state, "test-codebuddy-cn-state");
});

test("CodeBuddy CN refresh authenticates with the refresh token as bearer", async () => {
    let authorization = "";
    globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
        authorization = new Headers(init?.headers).get("authorization") ?? "";
        return new Response(
            JSON.stringify({
                code: 0,
                data: { accessToken: "new-cn-token", refreshToken: "new-cn-refresh" }
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
        );
    };

    const result = await new CodeBuddyCNOAuth().refreshTokens("old-cn-refresh");

    assert.equal(authorization, "Bearer old-cn-refresh");
    assert.equal(result.accessToken, "new-cn-token");
});

test("CodeBuddy CN refresh failure rejects instead of replacing the access token", async () => {
    globalThis.fetch = async () => new Response("Unauthorized", { status: 401 });

    await assert.rejects(
        () => new CodeBuddyCNOAuth().refreshTokens("old-cn-refresh"),
        /CodeBuddy token refresh failed/
    );
});

test("initiateCodeBuddyOAuth requests state and creates session", async () => {
    globalThis.fetch = async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/v2/plugin/auth/state")) {
            return new Response(
                JSON.stringify({
                    code: 0,
                    msg: "ok",
                    data: {
                        state: "test-codebuddy-state-123",
                        authUrl: "https://www.codebuddy.ai/login?state=test-codebuddy-state-123"
                    }
                }),
                { status: 200, headers: { "Content-Type": "application/json" } }
            );
        }
        return new Response("Not found", { status: 404 });
    };

    const result = await AuthLogic.initiateCodeBuddyOAuth();
    assert.equal(result.state, "test-codebuddy-state-123");
    assert.equal(
        result.authorizeUrl,
        "https://www.codebuddy.ai/login?state=test-codebuddy-state-123"
    );
});

test("pollCodeBuddyDeviceToken polls upstream and creates provider when user authorizes", async () => {
    globalThis.fetch = async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/v2/plugin/auth/token")) {
            return new Response(
                JSON.stringify({
                    code: 0,
                    msg: "ok",
                    data: {
                        accessToken: "cb-access-token-xyz",
                        refreshToken: "cb-refresh-token-xyz",
                        tokenType: "Bearer",
                        expiresIn: 86400
                    }
                }),
                { status: 200, headers: { "Content-Type": "application/json" } }
            );
        }
        return new Response("Not found", { status: 404 });
    };

    const state = "cb-test-state-auth";
    saveOAuthSessionDB({
        state,
        codeVerifier: "",
        clientId: "",
        redirectUri: "",
        createdAt: Date.now()
    });

    const result = await AuthLogic.pollCodeBuddyDeviceToken(state);
    assert.equal(result.status, "ok");
    assert.ok(result.provider);
    createdIds.push(result.provider.id);

    assert.equal(result.provider.providerId, "codebuddy");
    assert.equal(result.provider.category, "oauth");
    assert.equal(result.provider.accessToken, "cb-access-token-xyz");
    assert.equal(result.provider.refreshToken, "cb-refresh-token-xyz");
});

test("pollCodeBuddyCNDeviceToken creates a CN connection after browser authorization", async () => {
    let requestedUrl = "";
    globalThis.fetch = async (input: RequestInfo | URL) => {
        requestedUrl = String(input);
        return new Response(
            JSON.stringify({
                code: 0,
                data: {
                    accessToken: "cb-cn-access-token",
                    refreshToken: "cb-cn-refresh-token",
                    expiresIn: 86400
                }
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
        );
    };

    const state = "cb-cn-test-state-auth";
    saveOAuthSessionDB({
        state,
        codeVerifier: "",
        clientId: "",
        redirectUri: "",
        createdAt: Date.now()
    });

    const result = await AuthLogic.pollCodeBuddyCNDeviceToken(state);
    assert.equal(requestedUrl, `https://copilot.tencent.com/v2/plugin/auth/token?state=${state}`);
    assert.equal(result.status, "ok");
    assert.equal(result.provider?.providerId, "codebuddy-cn");
    assert.equal(result.provider?.baseUrl, CODEBUDDY_CN_BASE_URL);
    if (result.provider) createdIds.push(result.provider.id);
});
test("CodeBuddy CN live quota splits refill and bonus packs", async () => {
    const now = Date.now();
    const iso = (ms: number) => new Date(ms).toISOString();
    let capturedHeaders: Headers | undefined;
    globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
        capturedHeaders = new Headers(init?.headers);
        return new Response(
            JSON.stringify({
                code: 0,
                data: {
                    Response: {
                        Data: {
                            Accounts: [
                                {
                                    PackageName: "基础体验包",
                                    CycleStartTime: iso(now - 10 * 86400000),
                                    CycleEndTime: iso(now + 20 * 86400000),
                                    DeductionEndTime: now + 300 * 86400000,
                                    CycleCapacityUsedPrecise: "6.54",
                                    CycleCapacitySizePrecise: "500"
                                },
                                {
                                    PackageName: "活动赠送包",
                                    CycleStartTime: iso(now - 5 * 86400000),
                                    CycleEndTime: iso(now + 5 * 86400000),
                                    DeductionEndTime: now + 5 * 86400000,
                                    CapacityUsed: 25,
                                    CapacitySize: 100
                                }
                            ]
                        }
                    }
                }
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
        );
    };

    const account = await fetchCodeBuddyCNLiveQuota("codebuddy-cn_1", "CN Account", "cn-token");

    assert.equal(capturedHeaders?.get("authorization"), "Bearer cn-token");
    assert.equal(capturedHeaders?.get("x-ide-type"), "CLI");
    assert.equal(account.quotaType, "live_provider_quota");
    assert.match(account.provider, /基础体验包/);
    assert.equal(account.quotas?.length, 2);

    const monthly = account.quotas?.[0];
    assert.equal(monthly?.name, "Monthly");
    assert.equal(monthly?.used, 6.54);
    assert.equal(monthly?.limit, 500);
    assert.match(monthly?.resetIn ?? "", /^\d+d \d+h$/);

    const bonus = account.quotas?.[1];
    assert.equal(bonus?.name, "Bonus Pack 1");
    assert.equal(bonus?.used, 25);
    assert.equal(bonus?.limit, 100);
});

test("CodeBuddy CN live quota rejects on upstream error code", async () => {
    globalThis.fetch = async () =>
        new Response(JSON.stringify({ code: 11140, msg: "request illegal" }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
        });

    await assert.rejects(
        () => fetchCodeBuddyCNLiveQuota("codebuddy-cn_1", "CN Account", "bad-token"),
        /CodeBuddy CN quota error: request illegal/
    );
});
