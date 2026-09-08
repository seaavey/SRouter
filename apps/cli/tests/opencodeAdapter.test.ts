import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { ConfigStore } from "../src/lib/configStore.js";
import { OpenCodeAdapter, formatModelDisplayName } from "../src/adapters/opencode.js";
import { getAllAdapters, getAdapter } from "../src/adapters/index.js";

test("OpenCodeAdapter - link and unlink lifecycle", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "srouter-opencode-test-"));
    try {
        const store = new ConfigStore(tempDir);
        const customConfigPath = path.join(tempDir, "config.json");

        // Create initial config
        await fs.writeFile(
            customConfigPath,
            JSON.stringify({ model: "default-model", auto_run: true })
        );

        const adapter = new OpenCodeAdapter(store, customConfigPath);

        const statusBefore = await adapter.getStatus();
        assert.equal(statusBefore.linked, false);
        assert.equal(statusBefore.currentModel, "default-model");

        // Link with SRouter and custom availableModels
        const result = await adapter.link({
            baseUrl: "http://localhost:3000/v1",
            apiKey: "sk-srouter-key",
            model: "claude-3-7-sonnet",
            availableModels: [
                "antigravity/gemini-2.5-pro",
                "openai_codex/gpt-4o",
                "nemotron-3.5-lightning-free"
            ]
        });

        assert.ok(result.backupPath);
        assert.equal(result.modifiedPath, customConfigPath);

        const statusAfter = await adapter.getStatus();
        assert.equal(statusAfter.linked, true);
        assert.equal(statusAfter.currentBaseUrl, "http://localhost:3000/v1");
        assert.equal(statusAfter.currentModel, "srouter/claude-3-7-sonnet");

        // Check OpenCode config structure
        const savedConfig = JSON.parse(await fs.readFile(customConfigPath, "utf-8"));
        assert.equal(savedConfig.provider.srouter.name, "SRouter");
        assert.equal(savedConfig.provider.srouter.options.baseURL, "http://localhost:3000/v1");
        assert.equal(savedConfig.provider.srouter.options.apiKey, "sk-srouter-key");

        // Verify models category is populated with all models & readable names
        const models = savedConfig.provider.srouter.models;
        assert.ok(models["claude-3-7-sonnet"]);
        assert.equal(models["claude-3-7-sonnet"].name, "Claude 3.7 Sonnet");
        assert.equal(models["claude-3-7-sonnet"].attachment, true);
        assert.deepEqual(models["claude-3-7-sonnet"].modalities, {
            input: ["text", "image"],
            output: ["text"]
        });
        assert.ok(models["antigravity/gemini-2.5-pro"]);
        assert.equal(models["antigravity/gemini-2.5-pro"].name, "Gemini 2.5 Pro (Antigravity)");
        assert.equal(models["antigravity/gemini-2.5-pro"].attachment, true);
        assert.ok(models["openai_codex/gpt-4o"]);
        assert.equal(models["openai_codex/gpt-4o"].name, "GPT-4o (OpenAI Codex)");
        assert.equal(models["openai_codex/gpt-4o"].attachment, true);
        assert.ok(models["nemotron-3.5-lightning-free"]);
        assert.equal(models["nemotron-3.5-lightning-free"].name, "Nemotron 3.5 Lightning Free");

        // Check getEnv
        const env = adapter.getEnv({
            baseUrl: "http://localhost:3000/v1",
            apiKey: "sk-srouter-key",
            model: "claude-3-7-sonnet"
        });
        assert.equal(env.OPENAI_BASE_URL, "http://localhost:3000/v1");
        assert.equal(env.OPENAI_API_KEY, "sk-srouter-key");

        // Unlink & restore
        const unlinked = await adapter.unlink();
        assert.equal(unlinked, true);

        const restoredContent = JSON.parse(await fs.readFile(customConfigPath, "utf-8"));
        assert.equal(restoredContent.model, "default-model");
        assert.equal(restoredContent.openai_base_url, undefined);
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
    }
});

test("formatModelDisplayName correctly formats standard and namespaced model IDs", () => {
    assert.equal(formatModelDisplayName("claude-3-7-sonnet"), "Claude 3.7 Sonnet");
    assert.equal(formatModelDisplayName("gpt-4o"), "GPT-4o");
    assert.equal(
        formatModelDisplayName("antigravity/gemini-2.5-pro"),
        "Gemini 2.5 Pro (Antigravity)"
    );
    assert.equal(formatModelDisplayName("openai_codex/gpt-4o"), "GPT-4o (OpenAI Codex)");
    assert.equal(formatModelDisplayName("qoder/qwen-2.5-coder-32b"), "Qwen 2.5 Coder 32B (Qoder)");
    assert.equal(formatModelDisplayName("combo/flagship"), "Flagship Cascade (Combo)");
});

test("Adapter Registry - retrieves registered adapters", () => {
    const adapters = getAllAdapters();
    assert.ok(adapters.length >= 2);

    const claude = getAdapter("claude");
    assert.ok(claude);
    assert.equal(claude?.id, "claude");

    const opencode = getAdapter("opencode");
    assert.ok(opencode);
    assert.equal(opencode?.id, "opencode");

    const nonexistent = getAdapter("nonexistent");
    assert.equal(nonexistent, undefined);
});
