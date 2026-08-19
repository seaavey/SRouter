export interface ToolConfigContext {
    baseUrl: string;
    apiKey?: string;
    model?: string;
    dryRun?: boolean;
}

export interface ToolStatus {
    id: string;
    name: string;
    installed: boolean;
    linked: boolean;
    configPath?: string;
    currentBaseUrl?: string;
    currentModel?: string;
}

export interface LinkResult {
    backupPath?: string;
    modifiedPath: string;
    created?: boolean;
}

export interface BaseToolAdapter {
    readonly id: string;
    readonly name: string;
    readonly description: string;

    isInstalled(): Promise<boolean>;
    getStatus(): Promise<ToolStatus>;
    link(context: ToolConfigContext): Promise<LinkResult>;
    unlink(): Promise<boolean>;
    getEnv(context: ToolConfigContext): Record<string, string>;
}

export interface BackupEntry {
    toolId: string;
    originalPath: string;
    backupPath: string;
    timestamp: number;
}

export interface CliConfig {
    defaultBaseUrl: string;
    defaultApiKey?: string;
    defaultModel?: string;
    backups: BackupEntry[];
    lastSetupAt?: number;
}
