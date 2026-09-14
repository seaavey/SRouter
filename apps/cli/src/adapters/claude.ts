import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { AbstractToolAdapter } from "./base.js";
import type { LinkResult, ToolConfigContext, ToolStatus } from "../types/index.js";
import { ConfigStore, defaultStore } from "../lib/store.js";
import { getClaudeConfigPath, isExecutableInPath } from "../lib/platform.js";

function parseJsonSafe(content: string): Record<string, any> {
    try {
        const clean = content
            .replace(/\/\*[\s\S]*?\*\//g, "")
            .replace(/\/\/.*$/gm, "")
            .replace(/,\s*([\]}])/g, "$1");
        return JSON.parse(clean);
    } catch {
        try {
            return JSON.parse(content);
        } catch {
            return {};
        }
    }
}

export class ClaudeAdapter extends AbstractToolAdapter {
    readonly id = "claude";
    readonly name = "Claude Code";
    readonly description = "Anthropic's official CLI tool for agentic coding";

    private customConfigPath?: string;

    constructor(store: ConfigStore = defaultStore, customConfigPath?: string) {
        super(store);
        this.customConfigPath = customConfigPath;
    }

    getConfigPath(): string {
        if (this.customConfigPath) {
            return this.customConfigPath;
        }
        return getClaudeConfigPath();
    }

    async isInstalled(): Promise<boolean> {
        return isExecutableInPath("claude");
    }

    async getStatus(): Promise<ToolStatus> {
        const config_path = this.getConfigPath();
        const installed = await this.isInstalled();

        // Check primary config_path. If customConfigPath is not set, also check fallback candidate paths.
        const candidatePaths = [config_path];
        if (!this.customConfigPath) {
            const homeClaudeJson = path.join(os.homedir(), ".claude.json");
            const homeClaudeSettings = path.join(os.homedir(), ".claude", "settings.json");
            if (!candidatePaths.includes(homeClaudeJson)) candidatePaths.push(homeClaudeJson);
            if (!candidatePaths.includes(homeClaudeSettings))
                candidatePaths.push(homeClaudeSettings);
        }

        let unlinkedModel: string | undefined;
        let unlinkedBaseUrl: string | undefined;

        for (const targetPath of candidatePaths) {
            try {
                const raw = await fs.readFile(targetPath, "utf-8");
                const parsed = parseJsonSafe(raw);
                const base_url =
                    parsed.env?.ANTHROPIC_BASE_URL ||
                    parsed.ANTHROPIC_BASE_URL ||
                    parsed.base_url ||
                    undefined;
                const model =
                    parsed.env?.ANTHROPIC_DEFAULT_MODEL ||
                    parsed.env?.ANTHROPIC_MODEL ||
                    parsed.model ||
                    parsed.ANTHROPIC_MODEL ||
                    undefined;
                const opus_model =
                    parsed.env?.ANTHROPIC_DEFAULT_OPUS_MODEL ||
                    parsed.ANTHROPIC_DEFAULT_OPUS_MODEL ||
                    parsed.env?.ANTHROPIC_OPUS_MODEL ||
                    parsed.ANTHROPIC_OPUS_MODEL ||
                    undefined;
                const sonnet_model =
                    parsed.env?.ANTHROPIC_DEFAULT_SONNET_MODEL ||
                    parsed.ANTHROPIC_DEFAULT_SONNET_MODEL ||
                    parsed.env?.ANTHROPIC_SONNET_MODEL ||
                    parsed.ANTHROPIC_SONNET_MODEL ||
                    undefined;
                const haiku_model =
                    parsed.env?.ANTHROPIC_DEFAULT_HAIKU_MODEL ||
                    parsed.ANTHROPIC_DEFAULT_HAIKU_MODEL ||
                    parsed.env?.ANTHROPIC_HAIKU_MODEL ||
                    parsed.ANTHROPIC_HAIKU_MODEL ||
                    undefined;
                const linked = Boolean(
                    base_url &&
                    (base_url.includes("localhost") ||
                        base_url.includes("127.0.0.1") ||
                        base_url.includes("srouter"))
                );

                if (linked) {
                    return {
                        id: this.id,
                        name: this.name,
                        installed,
                        linked: true,
                        config_path: targetPath,
                        current_base_url: base_url,
                        current_model: model,
                        current_opus_model: opus_model,
                        current_sonnet_model: sonnet_model,
                        current_haiku_model: haiku_model
                    };
                }

                if (!unlinkedModel && model) unlinkedModel = model;
                if (!unlinkedBaseUrl && base_url) unlinkedBaseUrl = base_url;
            } catch {
                // check next candidate
            }
        }

        return {
            id: this.id,
            name: this.name,
            installed,
            linked: false,
            config_path,
            current_base_url: unlinkedBaseUrl,
            current_model: unlinkedModel
        };
    }

    async link(context: ToolConfigContext): Promise<LinkResult> {
        const config_path = this.getConfigPath();
        const backup_path = context.dry_run
            ? undefined
            : await this.store.createBackup(this.id, config_path);

        let data: Record<string, any> = {};
        try {
            const raw = await fs.readFile(config_path, "utf-8");
            data = parseJsonSafe(raw);
        } catch {
            data = {};
        }

        const default_model = context.model || "claude-3-7-sonnet";
        const api_key = context.api_key || "sk-local-srouter";
        // Anthropic SDK automatically appends /v1/messages, so base url should be origin (e.g. http://localhost:3000)
        const anthropicBaseUrl = context.base_url.replace(/\/v1\/?$/, "");

        // Claude Code v2 settings.json uses "env" object
        data.env = data.env || {};
        data.env.ANTHROPIC_BASE_URL = anthropicBaseUrl;
        data.env.ANTHROPIC_API_KEY = api_key;
        data.env.ANTHROPIC_AUTH_TOKEN = api_key;
        data.env.ANTHROPIC_DEFAULT_MODEL = default_model;
        data.env.ANTHROPIC_MODEL = default_model;
        data.env.ANTHROPIC_DEFAULT_OPUS_MODEL = context.opus_model || default_model;
        data.env.ANTHROPIC_DEFAULT_SONNET_MODEL = context.sonnet_model || default_model;
        data.env.ANTHROPIC_DEFAULT_HAIKU_MODEL = context.haiku_model || default_model;
        // Suppress "not a model Claude Code recognizes" warning for unknown models
        data.env.CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT = "1";

        // Clean out legacy SCODEX or old vendor keys if present
        if (data.env.ANTHROPIC_DEFAULT_FABLE_MODEL) {
            delete data.env.ANTHROPIC_DEFAULT_FABLE_MODEL;
        }

        // Top-level fallbacks for older Claude Code versions
        data.ANTHROPIC_BASE_URL = anthropicBaseUrl;
        data.ANTHROPIC_API_KEY = api_key;
        data.model = default_model;
        data.ANTHROPIC_DEFAULT_OPUS_MODEL = context.opus_model || default_model;
        data.ANTHROPIC_DEFAULT_SONNET_MODEL = context.sonnet_model || default_model;
        data.ANTHROPIC_DEFAULT_HAIKU_MODEL = context.haiku_model || default_model;

        if (!context.dry_run) {
            await fs.mkdir(path.dirname(config_path), { recursive: true });
            await fs.writeFile(config_path, JSON.stringify(data, null, 2), "utf-8");

            // Also keep ~/.claude.json in sync if it exists or config_path is settings.json
            const homeClaudeJson = path.join(os.homedir(), ".claude.json");
            if (config_path !== homeClaudeJson) {
                try {
                    let rootData: Record<string, any> = {};
                    try {
                        rootData = parseJsonSafe(await fs.readFile(homeClaudeJson, "utf-8"));
                    } catch {
                        rootData = {};
                    }
                    rootData.ANTHROPIC_BASE_URL = context.base_url;
                    rootData.ANTHROPIC_API_KEY = api_key;
                    rootData.model = default_model;
                    rootData.ANTHROPIC_DEFAULT_OPUS_MODEL = context.opus_model || default_model;
                    rootData.ANTHROPIC_DEFAULT_SONNET_MODEL = context.sonnet_model || default_model;
                    rootData.ANTHROPIC_DEFAULT_HAIKU_MODEL = context.haiku_model || default_model;
                    await fs.writeFile(homeClaudeJson, JSON.stringify(rootData, null, 2), "utf-8");
                } catch {
                    // Ignore secondary file sync error
                }
            }

            await this.store.writeAdapterLock(config_path, {
                version: 1,
                adapter: this.id,
                base_url: context.base_url,
                ...(context.model ? { model: context.model } : {}),
                configured_at: Date.now()
            });
        }

        return {
            backup_path,
            modified_path: config_path
        };
    }

    async unlink(): Promise<boolean> {
        const restored = await this.store.restoreLatestBackup(this.id);
        if (restored) {
            await this.store.removeAdapterLock(this.getConfigPath());
            return true;
        }

        const config_path = this.getConfigPath();
        try {
            const raw = await fs.readFile(config_path, "utf-8");
            const data = parseJsonSafe(raw);
            delete data.ANTHROPIC_BASE_URL;
            delete data.ANTHROPIC_API_KEY;
            delete data.ANTHROPIC_DEFAULT_OPUS_MODEL;
            delete data.ANTHROPIC_DEFAULT_SONNET_MODEL;
            delete data.ANTHROPIC_DEFAULT_HAIKU_MODEL;
            delete data.model;
            if (data.env && typeof data.env === "object") {
                delete data.env.ANTHROPIC_BASE_URL;
                delete data.env.ANTHROPIC_API_KEY;
                delete data.env.ANTHROPIC_AUTH_TOKEN;
                delete data.env.ANTHROPIC_DEFAULT_MODEL;
                delete data.env.ANTHROPIC_MODEL;
                delete data.env.ANTHROPIC_DEFAULT_OPUS_MODEL;
                delete data.env.ANTHROPIC_DEFAULT_SONNET_MODEL;
                delete data.env.ANTHROPIC_DEFAULT_HAIKU_MODEL;
                delete data.env.ANTHROPIC_DEFAULT_FABLE_MODEL;
                delete data.env.CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT;
            }
            await fs.writeFile(config_path, JSON.stringify(data, null, 2), "utf-8");
            await this.store.removeAdapterLock(config_path);
            return true;
        } catch {
            return false;
        }
    }

    getEnv(context: ToolConfigContext): Record<string, string> {
        const default_model = context.model || "claude-3-7-sonnet";
        const api_key = context.api_key || "sk-local-srouter";
        const anthropicBaseUrl = context.base_url.replace(/\/v1\/?$/, "");

        const env: Record<string, string> = {
            ANTHROPIC_BASE_URL: anthropicBaseUrl,
            ANTHROPIC_API_KEY: api_key,
            ANTHROPIC_AUTH_TOKEN: api_key,
            ANTHROPIC_DEFAULT_MODEL: default_model,
            ANTHROPIC_MODEL: default_model,
            ANTHROPIC_DEFAULT_OPUS_MODEL: context.opus_model || default_model,
            ANTHROPIC_DEFAULT_SONNET_MODEL: context.sonnet_model || default_model,
            ANTHROPIC_DEFAULT_HAIKU_MODEL: context.haiku_model || default_model,
            CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT: "1"
        };
        return env;
    }
}
