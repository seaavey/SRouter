import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const apiSource = await readFile(new URL("../src/lib/databaseTransfer.ts", import.meta.url), "utf8");
const settingsSource = await readFile(
    new URL("../src/components/settings/settings.data.tsx", import.meta.url),
    "utf8"
);

test("database API contract uses the admin endpoints and authenticated requests", () => {
    assert.match(apiSource, /fetch\("\/v1\/admin\/database\/export"/);
    assert.match(apiSource, /fetch\("\/v1\/admin\/database\/import"/);
    assert.match(apiSource, /credentials: "include"/g);
    assert.match(apiSource, /return response\.blob\(\)/);
    assert.match(apiSource, /const formData = new FormData\(\)/);
    assert.match(apiSource, /formData\.set\("database", file\)/);
    assert.doesNotMatch(apiSource, /Content-Type.*multipart\/form-data/);
});

test("database download contract mounts, removes, and asynchronously revokes its anchor URL", () => {
    assert.match(settingsSource, /downloadDatabaseBlob\(blob\)/);
    const transferSource = apiSource;
    assert.match(transferSource, /document\.body\.append\(link\)/);
    assert.match(transferSource, /link\.click\(\)/);
    assert.match(transferSource, /link\.remove\(\)/);
    assert.match(transferSource, /queueMicrotask\(\(\) => URL\.revokeObjectURL\(url\)\)/);
});

test("settings contract preserves destructive copy and prevents duplicate imports", () => {
    assert.match(settingsSource, /replaces all current SRouter data/);
    assert.match(settingsSource, /API keys and provider credentials/);
    assert.match(settingsSource, /current database will be backed up first/);
    assert.match(settingsSource, /cannot be undone from the dashboard/);
    assert.match(settingsSource, /databaseImportMutation\.isPending/);
    assert.match(settingsSource, /databaseImportMutation\.mutate\(databaseFile\)/);
    assert.match(settingsSource, /fileInput\.value = ""/);
});

// Component execution is not included: apps/web has no DOM test runner or test dependency.
