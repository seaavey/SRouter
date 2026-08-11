import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { deleteProviderDB, getProviderByIdDB, upsertProviderDB } from "@srouter/db";
import { CodexExecutor } from "@srouter/executors";
import type { ProviderConfig } from "@srouter/types";
import { registry } from "../src/services/registry.js";
import {
    isDueForRefresh,
    refreshProviderToken,
    startTokenRefreshSweeper,
    stopTokenRefreshSweeper,
} from "../src/services/tokenRefresh.js";

const originalFetch = globalThis.fetch;
const createdIds: string[] = [];

afterEach(() => {
    globalThis.fetch = originalFetch;
    stopTokenRefreshSweeper();
    for (const id of createdIds.splice(0)) deleteProviderDB(id);
});

function oauthProvider(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
    return {
        id: "openai_codex_test",
        providerId: "openai_codex",
        name: "Codex Test",
        category: "oauth",
        protocol: "openai",
        accessToken: "old-access",
        refreshToken: "old-refresh",
        enabled: true,
        createdAt: Date.now(),
        ...overrides,
    };
}

test("isDueForRefresh respects expiry lead time and stale missing expiry", () => {
    const now = 1_000_000;
    assert.equal(isDueForRefresh(oauthProvider({ tokenExpiresAt: now + 10 * 60_000 }), now), false);
    assert.equal(isDueForRefresh(oauthProvider({ tokenExpiresAt: now + 4 * 60_000 }), now), true);
    assert.equal(isDueForRefresh(oauthProvider({ tokenExpiresAt: undefined, lastRefreshedAt: now - 13 * 60 * 60_000 }), now), true);
    assert.equal(isDueForRefresh(oauthProvider({ refreshToken: undefined }), now), false);
});

test("refreshProviderToken deduplicates concurrent refreshes and updates DB plus live executor", async () => {
    const id = `openai_codex_test_${Date.now()}`;
    createdIds.push(id);
    const config = oauthProvider({ id, tokenExpiresAt: Date.now() - 1_000 });
    upsertProviderDB({ ...config, category: "oauth", protocol: "openai" });

    const executor = new CodexExecutor({ id, accessToken: config.accessToken, refreshToken: config.refreshToken });
    registry.registerProvider(executor);

    let refreshCalls = 0;
    let modelAuthorization = "";
    globalThis.fetch = async (input, init) => {
        const url = String(input);
        if (url.includes("/codex/models")) {
            modelAuthorization = new Headers(init?.headers).get("Authorization") ?? "";
            return new Response(JSON.stringify({ models: [] }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            });
        }

        refreshCalls++;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return new Response(
            JSON.stringify({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600, token_type: "Bearer" }),
            { status: 200, headers: { "Content-Type": "application/json" } },
        );
    };

    const [first, second] = await Promise.all([refreshProviderToken(id), refreshProviderToken(id)]);
    assert.equal(first.success, true);
    assert.equal(second.success, true);
    assert.equal(refreshCalls, 1);

    const saved = getProviderByIdDB(id);
    assert.equal(saved?.accessToken, "new-access");
    assert.equal(saved?.refreshToken, "new-refresh");
    assert.ok((saved?.tokenExpiresAt ?? 0) > Date.now() + 50 * 60_000);
    assert.ok((saved?.lastRefreshedAt ?? 0) > 0);

    await executor.listModels();
    assert.equal(modelAuthorization, "Bearer new-access");
});

test("sweeper timers do not keep the process alive and can be stopped", () => {
    startTokenRefreshSweeper(60_000);
    stopTokenRefreshSweeper();
    assert.ok(true);
});
