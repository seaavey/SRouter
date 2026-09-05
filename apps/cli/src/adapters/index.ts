import type { BaseToolAdapter } from "../types/index.js";
import { ConfigStore, defaultStore } from "../lib/configStore.js";
import { ClaudeAdapter } from "./claude.js";
import { OpenCodeAdapter } from "./opencode.js";
import { HindsightAdapter } from "./hindsight.js";

export { ClaudeAdapter } from "./claude.js";
export { OpenCodeAdapter } from "./opencode.js";
export { HindsightAdapter } from "./hindsight.js";
export { AbstractToolAdapter } from "./base.js";

export function createAdapters(store: ConfigStore = defaultStore): BaseToolAdapter[] {
    return [new ClaudeAdapter(store), new OpenCodeAdapter(store), new HindsightAdapter(store)];
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
