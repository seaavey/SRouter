import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { BackupEntry, CliConfig } from "../types/index.js";

export const DEFAULT_CLI_CONFIG: CliConfig = {
    defaultBaseUrl: "http://localhost:3000/v1",
    backups: []
};

export class ConfigStore {
    private baseDir: string;
    private configPath: string;
    private backupsDir: string;

    constructor(customBaseDir?: string) {
        this.baseDir = customBaseDir || path.join(os.homedir(), ".srouter");
        this.configPath = path.join(this.baseDir, "cli.json");
        this.backupsDir = path.join(this.baseDir, "backups");
    }

    private async ensureDirs(): Promise<void> {
        await fs.mkdir(this.baseDir, { recursive: true });
        await fs.mkdir(this.backupsDir, { recursive: true });
    }

    async loadConfig(): Promise<CliConfig> {
        try {
            const raw = await fs.readFile(this.configPath, "utf-8");
            const data = JSON.parse(raw);
            return {
                ...DEFAULT_CLI_CONFIG,
                ...data,
                backups: Array.isArray(data?.backups) ? data.backups : []
            };
        } catch {
            return { ...DEFAULT_CLI_CONFIG };
        }
    }

    async saveConfig(partial: Partial<CliConfig>): Promise<CliConfig> {
        await this.ensureDirs();
        const current = await this.loadConfig();
        const updated: CliConfig = {
            ...current,
            ...partial,
            backups: partial.backups ?? current.backups
        };
        await fs.writeFile(this.configPath, JSON.stringify(updated, null, 4), "utf-8");
        return updated;
    }

    async createBackup(toolId: string, originalPath: string): Promise<string | undefined> {
        try {
            await fs.access(originalPath);
        } catch {
            return undefined;
        }

        await this.ensureDirs();
        const timestamp = Date.now();
        const ext = path.extname(originalPath) || ".json";
        const backupFileName = `${toolId}-${timestamp}${ext}`;
        const backupPath = path.join(this.backupsDir, backupFileName);

        await fs.copyFile(originalPath, backupPath);

        const config = await this.loadConfig();
        const entry: BackupEntry = {
            toolId,
            originalPath,
            backupPath,
            timestamp
        };

        await this.saveConfig({
            backups: [...config.backups, entry]
        });

        return backupPath;
    }

    async getLatestBackup(toolId: string): Promise<BackupEntry | undefined> {
        const config = await this.loadConfig();
        const entries = config.backups.filter((b) => b.toolId === toolId);
        if (entries.length === 0) return undefined;
        return entries.sort((a, b) => b.timestamp - a.timestamp)[0];
    }

    async restoreLatestBackup(toolId: string): Promise<boolean> {
        const latest = await this.getLatestBackup(toolId);
        if (!latest) {
            return false;
        }

        try {
            await fs.mkdir(path.dirname(latest.originalPath), { recursive: true });
            await fs.copyFile(latest.backupPath, latest.originalPath);

            const config = await this.loadConfig();
            const updatedBackups = config.backups.filter((b) => b.backupPath !== latest.backupPath);
            await this.saveConfig({ backups: updatedBackups });

            await fs.rm(latest.backupPath, { force: true });
            return true;
        } catch {
            return false;
        }
    }
}

export const defaultStore = new ConfigStore();
