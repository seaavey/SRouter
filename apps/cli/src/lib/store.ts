import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { AdapterLock, BackupEntry, CLIConfig } from "../types/index.js";

export const DEFAULT_CLI_CONFIG: CLIConfig = {
    default_base_url: "http://localhost:3000/v1",
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

    async loadConfig(): Promise<CLIConfig> {
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

    async saveConfig(partial: Partial<CLIConfig>): Promise<CLIConfig> {
        await this.ensureDirs();
        const current = await this.loadConfig();
        const updated: CLIConfig = {
            ...current,
            ...partial,
            backups: partial.backups ?? current.backups
        };
        await fs.writeFile(this.configPath, JSON.stringify(updated, null, 4), "utf-8");
        return updated;
    }

    async createBackup(tool_id: string, original_path: string): Promise<string | undefined> {
        try {
            await fs.access(original_path);
        } catch {
            return undefined;
        }

        await this.ensureDirs();
        const timestamp = Date.now();
        const ext = path.extname(original_path) || ".json";
        const backupFileName = `${tool_id}-${timestamp}${ext}`;
        const backup_path = path.join(this.backupsDir, backupFileName);

        await fs.copyFile(original_path, backup_path);

        const config = await this.loadConfig();
        const entry: BackupEntry = {
            tool_id: tool_id,
            original_path: original_path,
            backup_path: backup_path,
            timestamp
        };

        await this.saveConfig({
            backups: [...config.backups, entry]
        });

        return backup_path;
    }

    async getLatestBackup(tool_id: string): Promise<BackupEntry | undefined> {
        const config = await this.loadConfig();
        const entries = config.backups.filter((b) => b.tool_id === tool_id);
        if (entries.length === 0) return undefined;
        return entries.sort((a, b) => b.timestamp - a.timestamp)[0];
    }

    async restoreLatestBackup(tool_id: string): Promise<boolean> {
        const latest = await this.getLatestBackup(tool_id);
        if (!latest) {
            return false;
        }

        try {
            await fs.mkdir(path.dirname(latest.original_path), { recursive: true });
            await fs.copyFile(latest.backup_path, latest.original_path);

            const config = await this.loadConfig();
            const updatedBackups = config.backups.filter(
                (b) => b.backup_path !== latest.backup_path
            );
            await this.saveConfig({ backups: updatedBackups });

            await fs.rm(latest.backup_path, { force: true });
            return true;
        } catch {
            return false;
        }
    }

    async writeAdapterLock(configPath: string, lock: AdapterLock): Promise<string> {
        const lockPath = path.join(path.dirname(configPath), "srouter.lock");
        await fs.mkdir(path.dirname(lockPath), { recursive: true });
        await fs.writeFile(lockPath, `${JSON.stringify(lock, null, 4)}\n`, "utf-8");
        return lockPath;
    }

    async removeAdapterLock(configPath: string): Promise<void> {
        const lockPath = path.join(path.dirname(configPath), "srouter.lock");
        await fs.rm(lockPath, { force: true });
    }
}

export const defaultStore = new ConfigStore();
