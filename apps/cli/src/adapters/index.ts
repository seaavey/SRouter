import type { BaseToolAdapter } from "../types/index.ts";
import { ConfigStore, defaultStore } from "../lib/configStore.ts";
import { ClaudeAdapter } from "./claude.ts";
import { OpenCodeAdapter } from "./opencode.ts";

export { ClaudeAdapter } from "./claude.ts";
export { OpenCodeAdapter } from "./opencode.ts";
export { AbstractToolAdapter } from "./base.ts";

export function createAdapters(store: ConfigStore = defaultStore): BaseToolAdapter[] {
    return [new ClaudeAdapter(store), new OpenCodeAdapter(store)];
}

let cachedAdapters: BaseToolAdapter[] | null = null;

export function getAllAdapters(): BaseToolAdapter[] {
    if (!cachedAdapters) {
        cachedAdapters = createAdapters();
    }
    return cachedAdapters;
}

export function getAdapter(id: string): BaseToolAdapter | undefined {
    const normalized = id.toLowerCase().trim();
    return getAllAdapters().find(
        (a) => a.id.toLowerCase() === normalized || a.name.toLowerCase().includes(normalized)
    );
}
