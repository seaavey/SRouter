import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { AbstractToolAdapter } from "./base.js";
import type { LinkResult, ToolConfigContext, ToolStatus } from "../types/index.js";
import { ConfigStore, defaultStore } from "../lib/configStore.js";

const execAsync = promisify(exec);

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
        return path.join(os.homedir(), ".claude.json");
    }

    async isInstalled(): Promise<boolean> {
        try {
            await execAsync("which claude");
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
                parsed.ANTHROPIC_BASE_URL ||
                parsed.baseUrl ||
                parsed.env?.ANTHROPIC_BASE_URL ||
                undefined;
            const model = parsed.model || parsed.env?.ANTHROPIC_MODEL || undefined;
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

        data.ANTHROPIC_BASE_URL = context.baseUrl;
        if (context.apiKey) {
            data.ANTHROPIC_API_KEY = context.apiKey;
        }
        if (context.model) {
            data.model = context.model;
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
            delete data.ANTHROPIC_BASE_URL;
            delete data.ANTHROPIC_API_KEY;
            await fs.writeFile(configPath, JSON.stringify(data, null, 4), "utf-8");
            return true;
        } catch {
            return false;
        }
    }

    getEnv(context: ToolConfigContext): Record<string, string> {
        const env: Record<string, string> = {
            ANTHROPIC_BASE_URL: context.baseUrl
        };
        if (context.apiKey) {
            env.ANTHROPIC_API_KEY = context.apiKey;
        }
        if (context.model) {
            env.ANTHROPIC_MODEL = context.model;
        }
        return env;
    }
}
