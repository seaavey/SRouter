export interface ToolConfigContext {
    base_url: string;
    api_key?: string;
    model?: string;
    opus_model?: string;
    sonnet_model?: string;
    haiku_model?: string;
    available_models?: string[];
    dry_run?: boolean;
}

export interface ToolStatus {
    id: string;
    name: string;
    installed: boolean;
    linked: boolean;
    config_path?: string;
    current_base_url?: string;
    current_model?: string;
    current_opus_model?: string;
    current_sonnet_model?: string;
    current_haiku_model?: string;
}

export interface LinkResult {
    backup_path?: string;
    modified_path: string;
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
    tool_id: string;
    original_path: string;
    backup_path: string;
    timestamp: number;
}

export interface CLIConfig {
    default_base_url: string;
    default_api_key?: string;
    default_model?: string;
    default_opus_model?: string;
    default_sonnet_model?: string;
    default_haiku_model?: string;
    backups: BackupEntry[];
    last_setup_at?: number;
}

export interface AdapterLock {
    version: 1;
    adapter: string;
    base_url: string;
    model?: string;
    configured_at: number;
}
