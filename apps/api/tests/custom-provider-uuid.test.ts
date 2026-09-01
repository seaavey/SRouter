import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { deleteProviderDB, getProviderByIdDB, getAllProvidersDB } from "@srouter/db";
import { providerBaseId } from "@srouter/constants";
import { ProvidersLogic } from "../src/logic/providers.logic.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const createdIds: string[] = [];

afterEach(() => {
    for (const id of createdIds.splice(0)) {
        deleteProviderDB(id);
    }
});

test("AddProvider generates a UUID v4 as immutable internal ID", () => {
    const result = ProvidersLogic.AddProvider({
        name: "My Gateway",
        category: "api_key",
        protocol: "openai",
        base_url: "https://api.example.com/v1",
        api_key: "sk-test-key"
    });

    createdIds.push(result.id);

    // 1. UUID v4 format
    assert.match(result.id, UUID_RE);

    // 2. id === providerId (persisted as the same immutable identity)
    const savedForProviderId = getProviderByIdDB(result.id);
    assert.equal(savedForProviderId?.providerId, result.id);

    // 3. Name preserved as display name
    assert.equal(result.name, "My Gateway");

    // 4. Persisted in DB
    const saved = getProviderByIdDB(result.id);
    assert.ok(saved, "Provider must exist in DB");
    assert.equal(saved?.id, result.id);
    assert.equal(saved?.name, "My Gateway");
});

test("UUID provider appears in catalog as its own entry", () => {
    const result = ProvidersLogic.AddProvider({
        name: "Custom Gateway",
        category: "api_key",
        protocol: "openai",
        base_url: "https://api.gateway.dev/v1",
        api_key: "sk-custom-key"
    });
    createdIds.push(result.id);

    const catalog = ProvidersLogic.GetCatalog();
    const apiKeyProviders = catalog.categories.api_key;
    const found = apiKeyProviders.find((p) => p.id === result.id);

    // 5. Provider appears in catalog
    assert.ok(found, "Custom provider must appear in catalog");
    assert.equal(found?.name, "Custom Gateway");
    assert.equal(found?.category, "api_key");
    assert.equal(found?.protocol, "openai");
});

test("UUID provider is found by GetProviderById", async () => {
    const result = ProvidersLogic.AddProvider({
        name: "Searchable Provider",
        category: "api_key",
        protocol: "openai",
        base_url: "https://search.example.com/v1",
        api_key: "sk-search-key"
    });
    createdIds.push(result.id);

    const found = await ProvidersLogic.GetProviderById(result.id);
    assert.ok(found, "Provider must be found by UUID");
    assert.equal(found?.name, "Searchable Provider");
});

test("providerBaseId preserves UUID instead of truncating on dash", () => {
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    const baseId = providerBaseId(uuid);
    // 6. UUID must not be truncated by dash-split
    assert.equal(baseId, uuid, "providerBaseId must return the full UUID");
});

test("built-in provider IDs are unchanged by the UUID migration", () => {
    // 7. Built-in providers keep their original IDs
    const catalog = ProvidersLogic.GetCatalog();
    const allIds = [
        ...catalog.categories.api_key,
        ...catalog.categories.oauth,
        ...catalog.categories.free_tier
    ].map((p) => p.id);

    // Known seed provider IDs
    assert.ok(allIds.includes("bai"), "bai must still exist");
    assert.ok(allIds.includes("neosantara"), "neosantara must still exist");
    assert.ok(allIds.includes("gorouter"), "gorouter must still exist");
    assert.ok(allIds.includes("kiro"), "kiro must still exist");
    assert.ok(allIds.includes("bluesminds"), "bluesminds must still exist");
    assert.ok(allIds.includes("seekai"), "seekai must still exist");
});

test("ListProviders lists UUID provider", () => {
    const result = ProvidersLogic.AddProvider({
        name: "Listed Provider",
        category: "api_key",
        protocol: "openai",
        base_url: "https://listme.example.com/v1",
        api_key: "sk-list-key"
    });
    createdIds.push(result.id);

    const list = ProvidersLogic.ListProviders();
    const found = list.find((p) => p.id === result.id);
    // 8. Found in list
    assert.ok(found, "UUID provider must be in ListProviders response");
    assert.equal(found?.name, "Listed Provider");
});

test("UUID persists across GetCatalog calls (no re-generation)", () => {
    const result = ProvidersLogic.AddProvider({
        name: "Stable UUID",
        category: "api_key",
        protocol: "openai",
        base_url: "https://stable.example.com/v1",
        api_key: "sk-stable-key"
    });
    createdIds.push(result.id);

    // Call catalog multiple times
    const ids1 = ProvidersLogic.GetCatalog();
    const ids2 = ProvidersLogic.GetCatalog();
    const ids3 = ProvidersLogic.GetCatalog();

    const findIn = (data: typeof ids1) => {
        const all = [
            ...data.categories.api_key,
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

test("custom provider with UUID does not collide with seed provider IDs", () => {
    const seedIds = [
        "openai",
        "anthropic",
        "bai",
        "neosantara",
        "gorouter",
        "bluesminds",
        "seekai",
        "tabitoken",
        "tokenrouter"
    ];

    // 10. UUID custom provider should not conflict with seed IDs
    const result = ProvidersLogic.AddProvider({
        name: "No Collision",
        category: "api_key",
        protocol: "openai",
        base_url: "https://nocollide.example.com/v1",
        api_key: "sk-nocollide-key"
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

test("duplicate names are allowed for different UUID providers", () => {
    const first = ProvidersLogic.AddProvider({
        name: "Duplicate Name",
        category: "api_key",
        protocol: "openai",
        base_url: "https://first.dup.com/v1",
        api_key: "sk-first-dup"
    });
    createdIds.push(first.id);

    const second = ProvidersLogic.AddProvider({
        name: "Duplicate Name",
        category: "api_key",
        protocol: "openai",
        base_url: "https://second.dup.com/v1",
        api_key: "sk-second-dup"
    });
    createdIds.push(second.id);

    // 11. Both providers with same name allowed
    assert.notEqual(first.id, second.id, "IDs must differ even with same name");
    assert.equal(first.name, second.name, "Both have same name");

    // Both appear in catalog
    const catalog = ProvidersLogic.ListProviders();
    const withDupName = catalog.filter((p) => p.name === "Duplicate Name");
    assert.equal(withDupName.length, 2, "Both duplicate-name providers must exist");
});

test("delete provider by UUID works", () => {
    const result = ProvidersLogic.AddProvider({
        name: "Delete Me",
        category: "api_key",
        protocol: "openai",
        base_url: "https://deleteme.example.com/v1",
        api_key: "sk-delete-key"
    });
    createdIds.push(result.id);

    // Verify it exists
    assert.ok(getProviderByIdDB(result.id), "Provider must exist before delete");

    // Delete by UUID
    const deleted = deleteProviderDB(result.id);
    assert.ok(deleted, "deleteProviderDB must return true");

    // Verify deleted
    assert.equal(getProviderByIdDB(result.id), null, "Provider must be gone after delete");
    // Remove from cleanup list since already deleted
    createdIds.splice(createdIds.indexOf(result.id), 1);
});