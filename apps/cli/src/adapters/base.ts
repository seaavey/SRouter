import type { BaseToolAdapter, LinkResult, ToolConfigContext, ToolStatus } from "../types/index.js";
import { ConfigStore, defaultStore } from "../lib/configStore.js";

export abstract class AbstractToolAdapter implements BaseToolAdapter {
    abstract readonly id: string;
    abstract readonly name: string;
    abstract readonly description: string;

    protected store: ConfigStore;

    constructor(store: ConfigStore = defaultStore) {
        this.store = store;
    }

    abstract getConfigPath(): string;
    abstract isInstalled(): Promise<boolean>;
    abstract getStatus(): Promise<ToolStatus>;
    abstract link(context: ToolConfigContext): Promise<LinkResult>;
    abstract unlink(): Promise<boolean>;
    abstract getEnv(context: ToolConfigContext): Record<string, string>;
}
