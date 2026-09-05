import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { HindsightAdapter } from "../src/adapters/hindsight.js";
import { ConfigStore } from "../src/lib/configStore.js";
import { getAllAdapters, getAdapter } from "../src/adapters/index.js";

test("HindsightAdapter - link, getStatus, getEnv, and unlink lifecycle", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "srouter-hindsight-test-"));
    const customConfigPath = path.join(tmpDir, ".env");
    const store = new ConfigStore(path.join(tmpDir, "config.json"), path.join(tmpDir, "backups"));

    try {
        await fs.writeFile(
            customConfigPath,
            "# Existing env\nSOME_VAR=hello\nHINDSIGHT_API_PORT=8888\n",
            "utf-8"
        );

        const adapter = new HindsightAdapter(store, customConfigPath);
        const statusBefore = await adapter.getStatus();
        assert.equal(statusBefore.linked, false);
        assert.equal(statusBefore.id, "hindsight");

        const result = await adapter.link({
            baseUrl: "http://localhost:3000/v1",
            apiKey: "sr-live-testkey",
            model: "antigravity/claude-sonnet-4-6"
        });

        assert.equal(result.modifiedPath, customConfigPath);

        const contentAfterLink = await fs.readFile(customConfigPath, "utf-8");
        assert.ok(contentAfterLink.includes('HINDSIGHT_API_LLM_PROVIDER="openai"'));
        assert.ok(contentAfterLink.includes('HINDSIGHT_API_LLM_BASE_URL="http://localhost:3000/v1"'));
        assert.ok(contentAfterLink.includes('HINDSIGHT_API_LLM_API_KEY="sr-live-testkey"'));
        assert.ok(contentAfterLink.includes('HINDSIGHT_API_LLM_MODEL="antigravity/claude-sonnet-4-6"'));
        assert.ok(contentAfterLink.includes("SOME_VAR=hello"));

        const statusAfter = await adapter.getStatus();
        assert.equal(statusAfter.linked, true);
        assert.equal(statusAfter.currentBaseUrl, "http://localhost:3000/v1");
        assert.equal(statusAfter.currentModel, "antigravity/claude-sonnet-4-6");

        const env = adapter.getEnv({
            baseUrl: "http://localhost:3000/v1",
            apiKey: "sr-live-testkey",
            model: "antigravity/claude-sonnet-4-6"
        });
        assert.equal(env.HINDSIGHT_API_LLM_PROVIDER, "openai");
        assert.equal(env.HINDSIGHT_API_LLM_BASE_URL, "http://localhost:3000/v1");
        assert.equal(env.HINDSIGHT_API_LLM_API_KEY, "sr-live-testkey");

        const unlinked = await adapter.unlink();
        assert.equal(unlinked, true);

        const contentAfterUnlink = await fs.readFile(customConfigPath, "utf-8");
        assert.ok(contentAfterUnlink.includes("SOME_VAR=hello"));
        assert.ok(!contentAfterUnlink.includes("HINDSIGHT_API_LLM_PROVIDER"));

        const statusUnlinked = await adapter.getStatus();
        assert.equal(statusUnlinked.linked, false);
    } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
    }
});

test("Adapter Registry - includes hindsight adapter", () => {
    const hindsight = getAdapter("hindsight");
    assert.ok(hindsight);
    assert.equal(hindsight.id, "hindsight");
    assert.equal(hindsight.name, "Hindsight");

    const all = getAllAdapters();
    assert.ok(all.some((a) => a.id === "hindsight"));
});
