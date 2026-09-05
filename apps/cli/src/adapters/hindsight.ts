import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import os from "node:os";
import { AbstractToolAdapter } from "./base.js";
import type { LinkResult, ToolConfigContext, ToolStatus } from "../types/index.js";
import { ConfigStore, defaultStore } from "../lib/configStore.js";
import { isExecutableInPath } from "../lib/platform.js";

export function getHindsightConfigPath(): string {
    const cwdEnv = path.join(process.cwd(), ".env");
    const homeHindsightEnv = path.join(os.homedir(), ".hindsight", ".env");

    if (process.env.HINDSIGHT_CONFIG_PATH) {
        return process.env.HINDSIGHT_CONFIG_PATH;
    }

    try {
        if (fsSync.existsSync(cwdEnv)) {
            const content = fsSync.readFileSync(cwdEnv, "utf-8");
            if (content.includes("HINDSIGHT_")) {
                return cwdEnv;
            }
        }
        if (fsSync.existsSync(homeHindsightEnv)) {
            return homeHindsightEnv;
        }
    } catch {
        // ignore and fallback
    }

    return homeHindsightEnv;
}

function parseEnvLines(content: string): Map<string, string> {
    const map = new Map<string, string>();
    const lines = content.split("\n");
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx > 0) {
            const key = trimmed.slice(0, eqIdx).trim();
            let val = trimmed.slice(eqIdx + 1).trim();
            if (
                (val.startsWith('"') && val.endsWith('"')) ||
                (val.startsWith("'") && val.endsWith("'"))
            ) {
                val = val.slice(1, -1);
            }
            map.set(key, val);
        }
    }
    return map;
}

function updateEnvContent(content: string, updates: Record<string, string>): string {
    const lines = content.split("\n");
    const updatedKeys = new Set<string>();
    const newLines = lines.map((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) return line;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx > 0) {
            const key = trimmed.slice(0, eqIdx).trim();
            if (key in updates) {
                updatedKeys.add(key);
                return `${key}="${updates[key]}"`;
            }
        }
        return line;
    });

    for (const [k, v] of Object.entries(updates)) {
        if (!updatedKeys.has(k)) {
            newLines.push(`${k}="${v}"`);
        }
    }

    return newLines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

export class HindsightAdapter extends AbstractToolAdapter {
    readonly id = "hindsight";
    readonly name = "Hindsight";
    readonly description = "Vectorize agent memory system (retain, recall, reflect)";

    private customConfigPath?: string;

    constructor(store: ConfigStore = defaultStore, customConfigPath?: string) {
        super(store);
        this.customConfigPath = customConfigPath;
    }

    getConfigPath(): string {
        if (this.customConfigPath) {
            return this.customConfigPath;
        }
        return getHindsightConfigPath();
    }

    async isInstalled(): Promise<boolean> {
        return (
            (await isExecutableInPath("hindsight")) ||
            Boolean(process.env.HINDSIGHT_API_URL) ||
            Boolean(process.env.HINDSIGHT_API_LLM_PROVIDER)
        );
    }

    async getStatus(): Promise<ToolStatus> {
        const configPath = this.getConfigPath();
        const installed = await this.isInstalled();

        try {
            const raw = await fs.readFile(configPath, "utf-8");
            const envMap = parseEnvLines(raw);
            const baseUrl = envMap.get("HINDSIGHT_API_LLM_BASE_URL");
            const model = envMap.get("HINDSIGHT_API_LLM_MODEL");
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

        let existingContent = "";
        try {
            existingContent = await fs.readFile(configPath, "utf-8");
        } catch {
            existingContent = "# Hindsight Environment Configuration\n";
        }

        const model = context.model || "antigravity/claude-sonnet-4-6";
        const apiKey = context.apiKey || "«redacted:sk-…»";
        const normalizedBaseUrl = context.baseUrl.replace(/\/+$/, "");

        const updates: Record<string, string> = {
            HINDSIGHT_API_LLM_PROVIDER: "openai",
            HINDSIGHT_API_LLM_BASE_URL: normalizedBaseUrl,
            HINDSIGHT_API_LLM_API_KEY: apiKey,
            HINDSIGHT_API_LLM_MODEL: model
        };

        const updatedContent = updateEnvContent(existingContent, updates);

        if (!context.dryRun) {
            await fs.mkdir(path.dirname(configPath), { recursive: true });
            await fs.writeFile(configPath, updatedContent, "utf-8");
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
            const lines = raw.split("\n");
            const filtered = lines.filter((l) => {
                const trimmed = l.trim();
                return (
                    !trimmed.startsWith("HINDSIGHT_API_LLM_PROVIDER=") &&
                    !trimmed.startsWith("HINDSIGHT_API_LLM_BASE_URL=") &&
                    !trimmed.startsWith("HINDSIGHT_API_LLM_API_KEY=") &&
                    !trimmed.startsWith("HINDSIGHT_API_LLM_MODEL=")
                );
            });
            await fs.writeFile(configPath, filtered.join("\n"), "utf-8");
            return true;
        } catch {
            return false;
        }
    }

    getEnv(context: ToolConfigContext): Record<string, string> {
        const model = context.model || "antigravity/claude-sonnet-4-6";
        const apiKey = context.apiKey || "«redacted:sk-…»";
        const normalizedBaseUrl = context.baseUrl.replace(/\/+$/, "");

        return {
            HINDSIGHT_API_LLM_PROVIDER: "openai",
            HINDSIGHT_API_LLM_BASE_URL: normalizedBaseUrl,
            HINDSIGHT_API_LLM_API_KEY: apiKey,
            HINDSIGHT_API_LLM_MODEL: model
        };
    }
}
