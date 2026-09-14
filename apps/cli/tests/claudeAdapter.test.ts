import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { ConfigStore } from "../src/lib/store.js";
import { ClaudeAdapter } from "../src/adapters/claude.js";

test("ClaudeAdapter - link and unlink lifecycle", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "srouter-claude-test-"));
    try {
        const store = new ConfigStore(tempDir);
        const customConfigPath = path.join(tempDir, ".claude.json");

        // Create initial config
        await fs.writeFile(
            customConfigPath,
            JSON.stringify({ model: "claude-orig", hasCompletedOnboarding: true })
        );

        const adapter = new ClaudeAdapter(store, customConfigPath);

        const statusBefore = await adapter.getStatus();
        assert.equal(statusBefore.linked, false);
        assert.equal(statusBefore.current_model, "claude-orig");

        // Link with SRouter
        const result = await adapter.link({
            base_url: "http://localhost:3000/v1",
            api_key: "sk-srouter-key",
            model: "claude-3-7-sonnet"
        });

        assert.ok(result.backup_path);
        assert.equal(result.modified_path, customConfigPath);
        const lockPath = path.join(tempDir, "srouter.lock");
        const lock = JSON.parse(await fs.readFile(lockPath, "utf-8"));
        assert.equal(lock.adapter, "claude");
        assert.equal(lock.api_key, undefined);

        const statusAfter = await adapter.getStatus();
        assert.equal(statusAfter.linked, true);
        assert.equal(statusAfter.current_base_url, "http://localhost:3000");
        assert.equal(statusAfter.current_model, "claude-3-7-sonnet");

        // Check getEnv
        const env = adapter.getEnv({
            base_url: "http://localhost:3000/v1",
            api_key: "sk-srouter-key",
            model: "claude-3-7-sonnet"
        });
        assert.equal(env.ANTHROPIC_BASE_URL, "http://localhost:3000");
        assert.equal(env.ANTHROPIC_API_KEY, "sk-srouter-key");

        // Unlink & restore
        const unlinked = await adapter.unlink();
        assert.equal(unlinked, true);
        await assert.rejects(fs.access(lockPath));

        const restoredContent = JSON.parse(await fs.readFile(customConfigPath, "utf-8"));
        assert.equal(restoredContent.model, "claude-orig");
        assert.equal(restoredContent.ANTHROPIC_BASE_URL, undefined);
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
    }
});

test("ClaudeAdapter - link with tier models and getEnv", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "srouter-claude-tiers-test-"));
    try {
        const store = new ConfigStore(tempDir);
        const customConfigPath = path.join(tempDir, ".claude.json");

        const adapter = new ClaudeAdapter(store, customConfigPath);

        // Link with tier models
        const result = await adapter.link({
            base_url: "http://localhost:3000/v1",
            api_key: "sk-srouter-key",
            model: "claude-3-7-sonnet",
            opus_model: "claude-3-opus-20240229",
            sonnet_model: "claude-3-7-sonnet-20250219",
            haiku_model: "claude-3-5-haiku-20241022"
        });

        assert.equal(result.modified_path, customConfigPath);

        const status = await adapter.getStatus();
        assert.equal(status.linked, true);
        assert.equal(status.current_base_url, "http://localhost:3000");
        assert.equal(status.current_model, "claude-3-7-sonnet");
        assert.equal(status.current_opus_model, "claude-3-opus-20240229");
        assert.equal(status.current_sonnet_model, "claude-3-7-sonnet-20250219");
        assert.equal(status.current_haiku_model, "claude-3-5-haiku-20241022");

        // Verify written file content
        const savedData = JSON.parse(await fs.readFile(customConfigPath, "utf-8"));
        assert.equal(savedData.ANTHROPIC_BASE_URL, "http://localhost:3000");
        assert.equal(savedData.ANTHROPIC_API_KEY, "sk-srouter-key");
        assert.equal(savedData.ANTHROPIC_DEFAULT_OPUS_MODEL, "claude-3-opus-20240229");
        assert.equal(savedData.ANTHROPIC_DEFAULT_SONNET_MODEL, "claude-3-7-sonnet-20250219");
        assert.equal(savedData.ANTHROPIC_DEFAULT_HAIKU_MODEL, "claude-3-5-haiku-20241022");

        // Verify getEnv
        const env = adapter.getEnv({
            base_url: "http://localhost:3000/v1",
            api_key: "sk-srouter-key",
            model: "claude-3-7-sonnet",
            opus_model: "claude-3-opus-20240229",
            sonnet_model: "claude-3-7-sonnet-20250219",
            haiku_model: "claude-3-5-haiku-20241022"
        });

        assert.equal(env.ANTHROPIC_BASE_URL, "http://localhost:3000");
        assert.equal(env.ANTHROPIC_API_KEY, "sk-srouter-key");
        assert.equal(env.ANTHROPIC_MODEL, "claude-3-7-sonnet");
        assert.equal(env.ANTHROPIC_DEFAULT_OPUS_MODEL, "claude-3-opus-20240229");
        assert.equal(env.ANTHROPIC_DEFAULT_SONNET_MODEL, "claude-3-7-sonnet-20250219");
        assert.equal(env.ANTHROPIC_DEFAULT_HAIKU_MODEL, "claude-3-5-haiku-20241022");
        assert.equal(env.CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT, "1");

        // Unlink manually without backup
        const unlinked = await adapter.unlink();
        assert.equal(unlinked, true);

        const unlinkedData = JSON.parse(await fs.readFile(customConfigPath, "utf-8"));
        assert.equal(unlinkedData.ANTHROPIC_BASE_URL, undefined);
        assert.equal(unlinkedData.ANTHROPIC_API_KEY, undefined);
        assert.equal(unlinkedData.ANTHROPIC_DEFAULT_OPUS_MODEL, undefined);
        assert.equal(unlinkedData.ANTHROPIC_DEFAULT_SONNET_MODEL, undefined);
        assert.equal(unlinkedData.ANTHROPIC_DEFAULT_HAIKU_MODEL, undefined);
        assert.equal(
            unlinkedData.env?.CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT,
            undefined
        );
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
    }
});
