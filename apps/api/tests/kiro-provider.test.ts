import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { deleteProviderDB, getProviderByIdDB, upsertProviderDB } from "@srouter/db";
import type { ProviderConfig } from "@srouter/types";

const createdIds: string[] = [];

afterEach(() => {
    for (const id of createdIds.splice(0)) deleteProviderDB(id);
});

test("Kiro provider metadata survives SQLite round-trip", () => {
    const id = `kiro_test_${Date.now()}`;
    createdIds.push(id);
    const config: ProviderConfig = {
        id,
        providerId: "kiro",
        name: "Kiro Test",
        category: "api_key",
        protocol: "custom",
        accessToken: "test-token",
        providerSpecificData: {
            authMethod: "api_key",
            region: "eu-west-1",
            profileArn: "arn:aws:codewhisperer:eu-west-1:123:profile/test",
        },
        enabled: true,
        createdAt: Date.now(),
    };

    upsertProviderDB({ ...config, category: "api_key", protocol: "custom" });
    const saved = getProviderByIdDB(id);

    assert.deepEqual(saved?.providerSpecificData, config.providerSpecificData);
});
