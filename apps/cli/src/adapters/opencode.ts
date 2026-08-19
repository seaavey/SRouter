import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { AbstractToolAdapter } from "./base.js";
import type { LinkResult, ToolConfigContext, ToolStatus } from "../types/index.js";
import { ConfigStore, defaultStore } from "../lib/configStore.js";

const execAsync = promisify(exec);

export class OpenCodeAdapter extends AbstractToolAdapter {
    readonly id = "opencode";
    readonly name = "OpenCode / Interpreter";
    readonly description = "Open-source AI coding CLI and agentic interpreter";

    private customConfigPath?: string;

    constructor(store: ConfigStore = defaultStore, customConfigPath?: string) {
        super(store);
        this.customConfigPath = customConfigPath;
    }

    getConfigPath(): string {
        if (this.customConfigPath) {
            return this.customConfigPath;
        }
        return path.join(os.homedir(), ".config", "opencode", "config.json");
    }

    async isInstalled(): Promise<boolean> {
        try {
            await execAsync("which opencode || which interpreter");
            return true;
        } catch {
            return false;
        }
    }

    async getStatus(): Promise<ToolStatus> {
        const configPath = this.getConfigPath();
        const installed = await this.isInstalled();

        try {
            const raw = await fs.readFile(configPath, "utf-8");
            const parsed = JSON.parse(raw);
            const baseUrl =
                parsed.provider?.srouter?.options?.baseURL ||
                parsed.openai_base_url ||
                parsed.api_base ||
                parsed.baseUrl ||
                parsed.providers?.srouter?.baseUrl ||
                undefined;
            const model = parsed.model || parsed.default_model || undefined;
            const linked = Boolean(
                baseUrl &&
                (baseUrl.includes("localhost") ||
                    baseUrl.includes("127.0.0.1") ||
                    baseUrl.includes("srouter"))
            );

            return {
                id: this.id,
                name: this.name,
                installed,
                linked,
                configPath,
                currentBaseUrl: baseUrl,
                currentModel: model
            };
        } catch {
            return {
                id: this.id,
                name: this.name,
                installed,
                linked: false,
                configPath
            };
        }
    }

    async link(context: ToolConfigContext): Promise<LinkResult> {
        const configPath = this.getConfigPath();
        const backupPath = context.dryRun
            ? undefined
            : await this.store.createBackup(this.id, configPath);

        let data: Record<string, any> = {};
        try {
            const raw = await fs.readFile(configPath, "utf-8");
            data = JSON.parse(raw);
        } catch {
            data = {};
        }

        // Schema declaration
        data["$schema"] = "https://opencode.ai/config.json";

        // OpenCode provider configuration
        data.provider = data.provider || {};
        const existingSrouter = data.provider.srouter || {};
        const existingModels = existingSrouter.models || {};

        const rawModel = context.model || "claude-3-7-sonnet";
        const cleanModelId = rawModel.startsWith("srouter/")
            ? rawModel.replace(/^srouter\//, "")
            : rawModel;

        existingModels[cleanModelId] = {
            id: cleanModelId,
            name: cleanModelId
        };

        data.provider.srouter = {
            name: "SRouter",
            npm: "@ai-sdk/openai",
            options: {
                baseURL: context.baseUrl,
                apiKey: context.apiKey || "sk-local-srouter"
            },
            models: existingModels
        };

        // OpenCode format for active model: "provider/model"
        data.model = `srouter/${cleanModelId}`;

        // Legacy / generic fields for backward compatibility
        data.openai_base_url = context.baseUrl;
        data.api_base = context.baseUrl;
        if (context.apiKey) {
            data.api_key = context.apiKey;
            data.openai_api_key = context.apiKey;
        }

        if (!context.dryRun) {
            await fs.mkdir(path.dirname(configPath), { recursive: true });
            await fs.writeFile(configPath, JSON.stringify(data, null, 4), "utf-8");
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
            const data = JSON.parse(raw);
            if (data.provider?.srouter) {
                delete data.provider.srouter;
            }
            if (data.model?.startsWith("srouter/")) {
                delete data.model;
            }
            delete data.openai_base_url;
            delete data.api_base;
            delete data.openai_api_key;
            if (data.providers?.srouter) {
                delete data.providers.srouter;
            }
            await fs.writeFile(configPath, JSON.stringify(data, null, 4), "utf-8");
            return true;
        } catch {
            return false;
        }
    }

    getEnv(context: ToolConfigContext): Record<string, string> {
        const env: Record<string, string> = {
            OPENAI_BASE_URL: context.baseUrl,
            ANTHROPIC_BASE_URL: context.baseUrl
        };
        if (context.apiKey) {
            env.OPENAI_API_KEY = context.apiKey;
            env.ANTHROPIC_API_KEY = context.apiKey;
        }
        if (context.model) {
            const cleanModelId = context.model.startsWith("srouter/")
                ? context.model.replace(/^srouter\//, "")
                : context.model;
            env.OPENCODE_MODEL = `srouter/${cleanModelId}`;
        }
        return env;
    }
}
