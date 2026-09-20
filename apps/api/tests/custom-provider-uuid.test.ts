import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { deleteProviderDB, getProviderByIdDB, getAllProvidersDB } from "@srouter/db";
import { providerBaseId } from "@srouter/constants";
import { ProvidersLogic } from "../src/logic/providers.logic.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const createdIds: string[] = [];

afterEach(async () => {
    for (const id of createdIds.splice(0)) {
        await await deleteProviderDB(id);
    }
});

test("AddProvider generates a UUID v4 as immutable internal ID", async () => {
    const result = await await ProvidersLogic.AddProvider({
        name: "My Gateway",
        category: "custom_provider",
        protocol: "openai",
        base_url: "https://example.com/api/v1",
        api_key: "sk-test-key"
    });

    createdIds.push(result.id);

    // 1. UUID v4 format
    assert.match(result.id, UUID_RE);

    // 2. id === providerId (persisted as the same immutable identity)
    const savedForProviderId = await await getProviderByIdDB(result.id);
    assert.equal(savedForProviderId?.providerId, result.id);

    // 3. Name preserved as display name
    assert.equal(result.name, "My Gateway");

    // 4. Persisted in DB
    const saved = await await getProviderByIdDB(result.id);
    assert.ok(saved, "Provider must exist in DB");
    assert.equal(saved?.id, result.id);
    assert.equal(saved?.name, "My Gateway");
});

test("UUID provider appears in catalog as its own entry", async () => {
    const result = await await ProvidersLogic.AddProvider({
        name: "Custom Gateway",
        category: "custom_provider",
        protocol: "openai",
        base_url: "https://example.com/gateway/v1",
        api_key: "«redacted:sk-…»"
    });
    createdIds.push(result.id);

    const catalog = await await ProvidersLogic.GetCatalog();
    const apiKeyProviders = catalog.categories.custom_provider;
    const found = apiKeyProviders.find((p) => p.id === result.id);

    // 5. Provider appears in catalog under custom_provider category
    assert.ok(found, "Custom provider must appear in catalog");
    assert.equal(found?.name, "Custom Gateway");
    assert.equal(found?.category, "custom_provider");
    assert.equal(found?.protocol, "openai");
});

test("UUID provider is found by GetProviderById", async () => {
    const result = await await ProvidersLogic.AddProvider({
        name: "Searchable Provider",
        category: "custom_provider",
        protocol: "openai",
        base_url: "https://example.com/search/v1",
        api_key: "«redacted:sk-…»"
    });
    createdIds.push(result.id);

    const found = await await ProvidersLogic.GetProviderById(result.id);
    assert.ok(found, "Provider must be found by UUID");
    assert.equal(found?.name, "Searchable Provider");
});

test("providerBaseId preserves UUID instead of truncating on dash", async () => {
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    const baseId = providerBaseId(uuid);
    // 6. UUID must not be truncated by dash-split
    assert.equal(baseId, uuid, "providerBaseId must return the full UUID");
});

test("built-in provider IDs are unchanged by the UUID migration", async () => {
    // 7. Built-in providers keep their original IDs
    const catalog = await await ProvidersLogic.GetCatalog();
    const allIds = [
        ...catalog.categories.api_key,
        ...catalog.categories.oauth,
        ...catalog.categories.free_tier
    ].map((p) => p.id);

    // Known seed provider IDs
    assert.ok(allIds.includes("bai"), "bai must still exist");
    assert.ok(allIds.includes("neosantara"), "neosantara must still exist");
    assert.ok(allIds.includes("kiro"), "kiro must still exist");
});

test("ListProviders lists UUID provider", async () => {
    const result = await await ProvidersLogic.AddProvider({
        name: "Listed Provider",
        category: "custom_provider",
        protocol: "openai",
        base_url: "https://example.com/listme/v1",
        api_key: "sk-list-key"
    });
    createdIds.push(result.id);

    const list = await await ProvidersLogic.ListProviders();
    const found = list.find((p) => p.id === result.id);
    // 8. Found in list
    assert.ok(found, "UUID provider must be in ListProviders response");
    assert.equal(found?.name, "Listed Provider");
});

test("UUID persists across GetCatalog calls (no re-generation)", async () => {
    const result = await await ProvidersLogic.AddProvider({
        name: "Stable UUID",
        category: "custom_provider",
        protocol: "openai",
        base_url: "https://example.com/stable/v1",
        api_key: "«redacted:sk-…»"
    });
    createdIds.push(result.id);

    // Call catalog multiple times
    const ids1 = await await ProvidersLogic.GetCatalog();
    const ids2 = await await ProvidersLogic.GetCatalog();
    const ids3 = await await ProvidersLogic.GetCatalog();

    const findIn = (data: typeof ids1) => {
        const all = [
            ...data.categories.api_key,
            ...data.categories.custom_provider,
            ...data.categories.oauth,
            ...data.categories.free_tier
        ];
        return all.find((p) => p.id === result.id);
    };

    // 9. UUID is stable — same across multiple catalog reads
    assert.equal(findIn(ids1)?.id, result.id);
    assert.equal(findIn(ids2)?.id, result.id);
    assert.equal(findIn(ids3)?.id, result.id);
});

test("custom provider with UUID does not collide with seed provider IDs", async () => {
    const seedIds = [
        "openai",
        "anthropic",
        "bai",
        "neosantara",
        "tokenrouter"
    ];

    // 10. UUID custom provider should not conflict with seed IDs
    const result = await await ProvidersLogic.AddProvider({
        name: "No Collision",
        category: "custom_provider",
        protocol: "openai",
        base_url: "https://example.com/nocollide/v1",
        api_key: "«redacted:sk-…»"
    });
    createdIds.push(result.id);

    // UUID must not match any seed ID
    assert.equal(
        seedIds.includes(result.id),
        false,
        "UUID must not collide with seed provider IDs"
    );
    // UUID still valid
    assert.match(result.id, UUID_RE);
});

test("duplicate names are allowed for different UUID providers", async () => {
    const first = await await ProvidersLogic.AddProvider({
        name: "Duplicate Name",
        category: "custom_provider",
        protocol: "openai",
        base_url: "https://example.com/first-dup/v1",
        api_key: "sk-first-dup"
    });
    createdIds.push(first.id);

    const second = await await ProvidersLogic.AddProvider({
        name: "Duplicate Name",
        category: "custom_provider",
        protocol: "openai",
        base_url: "https://example.com/second-dup/v1",
        api_key: "«redacted:sk-…»"
    });
    createdIds.push(second.id);

    // 11. Both providers with same name allowed
    assert.notEqual(first.id, second.id, "IDs must differ even with same name");
    assert.equal(first.name, second.name, "Both have same name");

    // Both appear in catalog
    const catalog = await await ProvidersLogic.ListProviders();
    const withDupName = catalog.filter((p) => p.name === "Duplicate Name");
    assert.equal(withDupName.length, 2, "Both duplicate-name providers must exist");
});

test("delete provider by UUID works", async () => {
    const result = await await ProvidersLogic.AddProvider({
        name: "Delete Me",
        category: "custom_provider",
        protocol: "openai",
        base_url: "https://example.com/deleteme/v1",
        api_key: "«redacted:sk-…»"
    });
    createdIds.push(result.id);

    // Verify it exists
    assert.ok(await await getProviderByIdDB(result.id), "Provider must exist before delete");

    // Delete by UUID
    const deleted = await await deleteProviderDB(result.id);
    assert.ok(deleted, "deleteProviderDB must return true");

    // Verify deleted
    assert.equal(
        await await getProviderByIdDB(result.id),
        null,
        "Provider must be gone after delete"
    );
    // Remove from cleanup list since already deleted
    createdIds.splice(createdIds.indexOf(result.id), 1);
});
