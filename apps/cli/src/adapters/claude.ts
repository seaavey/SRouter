import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { AbstractToolAdapter } from "./base.js";
import type { LinkResult, ToolConfigContext, ToolStatus } from "../types/index.js";
import { ConfigStore, defaultStore } from "../lib/configStore.js";
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
        const configPath = this.getConfigPath();
        const installed = await this.isInstalled();

        // Check primary configPath. If customConfigPath is not set, also check fallback candidate paths.
        const candidatePaths = [configPath];
        if (!this.customConfigPath) {
            const homeClaudeJson = path.join(os.homedir(), ".claude.json");
            const homeClaudeSettings = path.join(os.homedir(), ".claude", "settings.json");
            if (!candidatePaths.includes(homeClaudeJson)) candidatePaths.push(homeClaudeJson);
            if (!candidatePaths.includes(homeClaudeSettings)) candidatePaths.push(homeClaudeSettings);
        }

        let unlinkedModel: string | undefined;
        let unlinkedBaseUrl: string | undefined;

        for (const targetPath of candidatePaths) {
            try {
                const raw = await fs.readFile(targetPath, "utf-8");
                const parsed = parseJsonSafe(raw);
                const baseUrl =
                    parsed.env?.ANTHROPIC_BASE_URL ||
                    parsed.ANTHROPIC_BASE_URL ||
                    parsed.baseUrl ||
                    undefined;
                const model =
                    parsed.env?.ANTHROPIC_DEFAULT_MODEL ||
                    parsed.env?.ANTHROPIC_MODEL ||
                    parsed.model ||
                    parsed.ANTHROPIC_MODEL ||
                    undefined;
                const opusModel =
                    parsed.env?.ANTHROPIC_DEFAULT_OPUS_MODEL ||
                    parsed.ANTHROPIC_DEFAULT_OPUS_MODEL ||
                    parsed.env?.ANTHROPIC_OPUS_MODEL ||
                    parsed.ANTHROPIC_OPUS_MODEL ||
                    undefined;
                const sonnetModel =
                    parsed.env?.ANTHROPIC_DEFAULT_SONNET_MODEL ||
                    parsed.ANTHROPIC_DEFAULT_SONNET_MODEL ||
                    parsed.env?.ANTHROPIC_SONNET_MODEL ||
                    parsed.ANTHROPIC_SONNET_MODEL ||
                    undefined;
                const haikuModel =
                    parsed.env?.ANTHROPIC_DEFAULT_HAIKU_MODEL ||
                    parsed.ANTHROPIC_DEFAULT_HAIKU_MODEL ||
                    parsed.env?.ANTHROPIC_HAIKU_MODEL ||
                    parsed.ANTHROPIC_HAIKU_MODEL ||
                    undefined;
                const linked = Boolean(
                    baseUrl &&
                    (baseUrl.includes("localhost") ||
                        baseUrl.includes("127.0.0.1") ||
                        baseUrl.includes("srouter"))
                );

                if (linked) {
                    return {
                        id: this.id,
                        name: this.name,
                        installed,
                        linked: true,
                        configPath: targetPath,
                        currentBaseUrl: baseUrl,
                        currentModel: model,
                        currentOpusModel: opusModel,
                        currentSonnetModel: sonnetModel,
                        currentHaikuModel: haikuModel
                    };
                }

                if (!unlinkedModel && model) unlinkedModel = model;
                if (!unlinkedBaseUrl && baseUrl) unlinkedBaseUrl = baseUrl;
            } catch {
                // check next candidate
            }
        }

        return {
            id: this.id,
            name: this.name,
            installed,
            linked: false,
            configPath,
            currentBaseUrl: unlinkedBaseUrl,
            currentModel: unlinkedModel
        };
    }

    async link(context: ToolConfigContext): Promise<LinkResult> {
        const configPath = this.getConfigPath();
        const backupPath = context.dryRun
            ? undefined
            : await this.store.createBackup(this.id, configPath);

        let data: Record<string, any> = {};
        try {
            const raw = await fs.readFile(configPath, "utf-8");
            data = parseJsonSafe(raw);
        } catch {
            data = {};
        }

        const defaultModel = context.model || "claude-3-7-sonnet";
        const apiKey = context.apiKey || "sk-local-srouter";
        // Anthropic SDK automatically appends /v1/messages, so base url should be origin (e.g. http://localhost:3000)
        const anthropicBaseUrl = context.baseUrl.replace(/\/v1\/?$/, "");

        // Claude Code v2 settings.json uses "env" object
        data.env = data.env || {};
        data.env.ANTHROPIC_BASE_URL = anthropicBaseUrl;
        data.env.ANTHROPIC_API_KEY = apiKey;
        data.env.ANTHROPIC_AUTH_TOKEN = apiKey;
        data.env.ANTHROPIC_DEFAULT_MODEL = defaultModel;
        data.env.ANTHROPIC_MODEL = defaultModel;
        data.env.ANTHROPIC_DEFAULT_OPUS_MODEL = context.opusModel || defaultModel;
        data.env.ANTHROPIC_DEFAULT_SONNET_MODEL = context.sonnetModel || defaultModel;
        data.env.ANTHROPIC_DEFAULT_HAIKU_MODEL = context.haikuModel || defaultModel;
        // Suppress "not a model Claude Code recognizes" warning for unknown models
        data.env.CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT = "1";

        // Clean out legacy SCODEX or old vendor keys if present
        if (data.env.ANTHROPIC_DEFAULT_FABLE_MODEL) {
            delete data.env.ANTHROPIC_DEFAULT_FABLE_MODEL;
        }

        // Top-level fallbacks for older Claude Code versions
        data.ANTHROPIC_BASE_URL = anthropicBaseUrl;
        data.ANTHROPIC_API_KEY = apiKey;
        data.model = defaultModel;
        data.ANTHROPIC_DEFAULT_OPUS_MODEL = context.opusModel || defaultModel;
        data.ANTHROPIC_DEFAULT_SONNET_MODEL = context.sonnetModel || defaultModel;
        data.ANTHROPIC_DEFAULT_HAIKU_MODEL = context.haikuModel || defaultModel;

        if (!context.dryRun) {
            await fs.mkdir(path.dirname(configPath), { recursive: true });
            await fs.writeFile(configPath, JSON.stringify(data, null, 2), "utf-8");

            // Also keep ~/.claude.json in sync if it exists or configPath is settings.json
            const homeClaudeJson = path.join(os.homedir(), ".claude.json");
            if (configPath !== homeClaudeJson) {
                try {
                    let rootData: Record<string, any> = {};
                    try {
                        rootData = parseJsonSafe(await fs.readFile(homeClaudeJson, "utf-8"));
                    } catch {
                        rootData = {};
                    }
                    rootData.ANTHROPIC_BASE_URL = context.baseUrl;
                    rootData.ANTHROPIC_API_KEY = apiKey;
                    rootData.model = defaultModel;
                    rootData.ANTHROPIC_DEFAULT_OPUS_MODEL = context.opusModel || defaultModel;
                    rootData.ANTHROPIC_DEFAULT_SONNET_MODEL = context.sonnetModel || defaultModel;
                    rootData.ANTHROPIC_DEFAULT_HAIKU_MODEL = context.haikuModel || defaultModel;
                    await fs.writeFile(homeClaudeJson, JSON.stringify(rootData, null, 2), "utf-8");
                } catch {
                    // Ignore secondary file sync error
                }
            }
        }

        return {
            backupPath,
            modifiedPath: configPath
        };
    }

    async unlink(): Promise<boolean> {
        const restored = await this.store.restoreLatestBackup(this.id);
        if (restored) {
            return true;
        }

        const configPath = this.getConfigPath();
        try {
            const raw = await fs.readFile(configPath, "utf-8");
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
            await fs.writeFile(configPath, JSON.stringify(data, null, 2), "utf-8");
            return true;
        } catch {
            return false;
        }
    }

    getEnv(context: ToolConfigContext): Record<string, string> {
        const defaultModel = context.model || "claude-3-7-sonnet";
        const apiKey = context.apiKey || "sk-local-srouter";
        const anthropicBaseUrl = context.baseUrl.replace(/\/v1\/?$/, "");

        const env: Record<string, string> = {
            ANTHROPIC_BASE_URL: anthropicBaseUrl,
            ANTHROPIC_API_KEY: apiKey,
            ANTHROPIC_AUTH_TOKEN: apiKey,
            ANTHROPIC_DEFAULT_MODEL: defaultModel,
            ANTHROPIC_MODEL: defaultModel,
            ANTHROPIC_DEFAULT_OPUS_MODEL: context.opusModel || defaultModel,
            ANTHROPIC_DEFAULT_SONNET_MODEL: context.sonnetModel || defaultModel,
            ANTHROPIC_DEFAULT_HAIKU_MODEL: context.haikuModel || defaultModel,
            CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT: "1"
        };
        return env;
    }
}
