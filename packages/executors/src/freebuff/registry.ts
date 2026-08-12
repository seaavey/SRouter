import type { ModelObject } from "@srouter/types";
import type { FreebuffModelRegistryState } from "./types.js";

export const FREEBUFF_REGISTRY_SOURCE_FILES = [
    "free-agents.ts",
    "freebuff-model-ids.ts",
    "freebuff-models.ts",
    "gemini.ts",
    "model-config.ts",
] as const;

export const FREEBUFF_REGISTRY_RAW_BASE =
    "https://raw.githubusercontent.com/CodebuffAI/codebuff/main/common/src/constants/";

const FALLBACK_AGENTS: readonly { agent: string; models: readonly string[] }[] = [
    { agent: "base2-free", models: ["deepseek/deepseek-v4-pro", "deepseek/deepseek-v4-flash", "minimax/minimax-m3", "openai/gpt-5.6-luna", "mimo/mimo-v2.5"] },
    { agent: "base2-free-minimax-m3", models: ["minimax/minimax-m3"] },
    { agent: "base2-free-luna", models: ["openai/gpt-5.6-luna"] },
    { agent: "base2-free-deepseek", models: ["deepseek/deepseek-v4-pro"] },
    { agent: "base2-free-deepseek-flash", models: ["deepseek/deepseek-v4-flash"] },
    { agent: "base2-free-mimo", models: ["mimo/mimo-v2.5"] },
    { agent: "base2-free-glm", models: ["z-ai/glm-5.2"] },
    { agent: "base2-free-laguna-s-2-1", models: ["poolside/laguna-s-2.1"] },
    { agent: "base2-free-laguna-s-2-1-openrouter", models: ["openrouter/poolside/laguna-s-2.1"] },
    { agent: "base2-free-ling-3-flash", models: ["inclusionai/ling-3.0-flash:free"] },
    { agent: "base2-free-greg-2-ultra", models: ["crof/greg-2-ultra"] },
    { agent: "base2-free-greg-2-super", models: ["crof/greg-2-super"] },
    { agent: "base2-free-fable", models: ["anthropic/claude-fable-5"] },
    { agent: "file-picker", models: ["google/gemini-2.5-flash-lite"] },
    { agent: "file-picker-max", models: ["google/gemini-3.1-flash-lite", "google/gemini-3.5-flash-lite"] },
    { agent: "file-lister", models: ["google/gemini-3.1-flash-lite", "google/gemini-3.5-flash-lite"] },
    { agent: "researcher-web", models: ["google/gemini-3.1-flash-lite", "google/gemini-3.5-flash-lite"] },
    { agent: "researcher-docs", models: ["google/gemini-3.1-flash-lite", "google/gemini-3.5-flash-lite"] },
    { agent: "basher", models: ["google/gemini-3.1-flash-lite", "google/gemini-3.5-flash-lite"] },
    { agent: "code-reviewer-lite", models: ["deepseek/deepseek-v4-pro", "deepseek/deepseek-v4-flash", "mimo/mimo-v2.5"] },
];

export interface FreebuffModelRegistryOptions {
    readonly modelPrefix?: string;
    readonly sourceUrls?: readonly string[];
    readonly fetchImpl?: typeof fetch;
    readonly refreshIntervalMs?: number;
    readonly requestTimeoutMs?: number;
}

export interface FreebuffRegistrySnapshot extends FreebuffModelRegistryState {
    readonly modelCount: number;
    readonly agentCount: number;
}

interface ParsedRegistry {
    readonly modelToAgent: Readonly<Record<string, string>>;
    readonly agentIds: readonly string[];
}

function isIdentifier(value: string): boolean {
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}

function collectConstants(text: string): {
    literals: Map<string, string>;
    aliases: Map<string, string>;
    sets: Map<string, string[]>;
} {
    const literals = new Map<string, string>();
    const aliases = new Map<string, string>();
    const sets = new Map<string, string[]>();
    const literalPattern = /(?:export\s+)?const\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(["'])(.*?)\2/g;
    for (const match of text.matchAll(literalPattern)) literals.set(match[1] ?? "", match[3] ?? "");
    const setPattern = /(?:export\s+)?const\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*new\s+Set(?:<[^>]+>)?\s*\(\s*\[([\s\S]*?)\]\s*\)/g;
    for (const match of text.matchAll(setPattern)) {
        const members: string[] = [];
        const memberPattern = /(["'])(.*?)\1|\b([A-Za-z_][A-Za-z0-9_]*)\b/g;
        for (const member of (match[2] ?? "").matchAll(memberPattern)) {
            const value = member[2] ?? member[3];
            if (value !== undefined && !["new", "Set"].includes(value)) members.push(value);
        }
        sets.set(match[1] ?? "", members);
    }
    const aliasPattern = /(?:export\s+)?const\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([A-Za-z_][A-Za-z0-9_.]*)\s*(?:as\s+const)?\s*;/g;
    for (const match of text.matchAll(aliasPattern)) {
        const target = match[2] ?? "";
        if (isIdentifier(target) || /^[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*$/.test(target)) aliases.set(match[1] ?? "", target);
    }
    return { literals, aliases, sets };
}

function resolveConstant(name: string, constants: ReturnType<typeof collectConstants>, depth = 0): string {
    if (depth > 8) return "";
    const literal = constants.literals.get(name);
    if (literal !== undefined) return literal;
    const alias = constants.aliases.get(name);
    if (alias === undefined) return "";
    if (alias.includes(".")) return "";
    return resolveConstant(alias, constants, depth + 1);
}

function parseMembers(body: string, constants: ReturnType<typeof collectConstants>): string[] {
    const members: string[] = [];
    const seen = new Set<string>();
    const memberPattern = /(["'])(.*?)\1|\b([A-Za-z_][A-Za-z0-9_]*)\b/g;
    for (const match of body.matchAll(memberPattern)) {
        const raw = match[2] ?? match[3];
        if (raw === undefined) continue;
        const resolved = match[2] !== undefined ? raw : resolveConstant(raw, constants);
        if (resolved !== "" && !seen.has(resolved)) {
            seen.add(resolved);
            members.push(resolved);
        }
    }
    return members;
}

function parseRegistry(texts: readonly string[]): ParsedRegistry {
    const text = texts.join("\n");
    const constants = collectConstants(text);
    const root = new Map<string, string>();
    const rootBlock = /(?:export\s+)?const\s+FREEBUFF_ROOT_AGENT_ID_BY_MODEL\s*=\s*\{([\s\S]*?)\n\}/m.exec(text)?.[1] ?? "";
    const rootPattern = /\[([A-Za-z_][A-Za-z0-9_]*)\]\s*:\s*(["'])(.*?)\2/g;
    for (const match of rootBlock.matchAll(rootPattern)) {
        const model = resolveConstant(match[1] ?? "", constants);
        const agent = match[3] ?? "";
        if (model !== "" && agent !== "") root.set(model, agent);
    }

    const agentEntries: { agent: string; models: string[] }[] = [];
    const agentBlock = /(?:export\s+)?const\s+FREE_MODE_AGENT_MODELS\s*=\s*\{([\s\S]*?)\n\}/m.exec(text)?.[1] ?? "";
    const entryPattern = /(["'])(.*?)\1\s*:\s*(?:new\s+Set(?:<[^>]+>)?\s*\(\s*\[([\s\S]*?)\]\s*\)|([A-Za-z_][A-Za-z0-9_]*))/g;
    for (const match of agentBlock.matchAll(entryPattern)) {
        const agent = match[2] ?? "";
        const models = match[3] !== undefined
            ? parseMembers(match[3], constants)
            : constants.sets.get(match[4] ?? "")?.flatMap((member) => {
                const resolved = resolveConstant(member, constants);
                return resolved === "" ? [member] : [resolved];
            }) ?? [];
        if (agent !== "" && models.length > 0) agentEntries.push({ agent, models });
    }

    const modelToAgent = new Map(root);
    for (const entry of agentEntries) {
        for (const model of entry.models) if (!modelToAgent.has(model)) modelToAgent.set(model, entry.agent);
    }
    return {
        modelToAgent: Object.fromEntries([...modelToAgent.entries()].sort(([a], [b]) => a.localeCompare(b))),
        agentIds: [...new Set(agentEntries.map((entry) => entry.agent))],
    };
}

function fallbackRegistry(): ParsedRegistry {
    const modelToAgent = new Map<string, string>();
    for (const entry of FALLBACK_AGENTS) for (const model of entry.models) if (!modelToAgent.has(model)) modelToAgent.set(model, entry.agent);
    return {
        modelToAgent: Object.fromEntries([...modelToAgent.entries()].sort(([a], [b]) => a.localeCompare(b))),
        agentIds: [...new Set(FALLBACK_AGENTS.map((entry) => entry.agent))],
    };
}

function sourceUrls(options: FreebuffModelRegistryOptions): readonly string[] {
    if (options.sourceUrls && options.sourceUrls.length > 0) return options.sourceUrls;
    return FREEBUFF_REGISTRY_SOURCE_FILES.map((file) => `${FREEBUFF_REGISTRY_RAW_BASE}${file}`);
}

export class FreebuffModelRegistry {
    private readonly prefix: string;
    private readonly urls: readonly string[];
    private readonly fetchImpl: typeof fetch;
    private readonly requestTimeoutMs: number;
    private readonly refreshIntervalMs: number;
    private mapping: ParsedRegistry = fallbackRegistry();
    private fetchedAt = 0;
    private source = "fallback";
    private degraded = true;
    private timer: ReturnType<typeof setInterval> | undefined;

    public constructor(options: FreebuffModelRegistryOptions = {}) {
        this.prefix = options.modelPrefix ?? "freebuff";
        this.urls = sourceUrls(options);
        this.fetchImpl = options.fetchImpl ?? fetch;
        this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
        this.refreshIntervalMs = options.refreshIntervalMs ?? 15 * 60 * 1_000;
        if (!Number.isFinite(this.requestTimeoutMs) || this.requestTimeoutMs <= 0) throw new TypeError("requestTimeoutMs must be positive");
        if (!Number.isFinite(this.refreshIntervalMs) || this.refreshIntervalMs <= 0) throw new TypeError("refreshIntervalMs must be positive");
    }

    public async refresh(signal?: AbortSignal): Promise<void> {
        const texts = await Promise.all(this.urls.map((url) => this.fetchSource(url, signal)));
        const parsed = parseRegistry(texts);
        if (Object.keys(parsed.modelToAgent).length === 0) throw new Error("FreeBuff registry source contained no models");
        this.mapping = parsed;
        this.fetchedAt = Date.now();
        this.source = this.urls.join(",");
        this.degraded = false;
    }

    public models(): ModelObject[] {
        return Object.keys(this.mapping.modelToAgent).map((model) => ({ id: `${this.prefix}/${model}`, object: "model", owned_by: this.prefix }));
    }

    public agentForModel(modelId: string): string | null {
        const bare = modelId.startsWith(`${this.prefix}/`) ? modelId.slice(this.prefix.length + 1) : modelId;
        return this.mapping.modelToAgent[bare] ?? null;
    }

    public agentIds(): string[] { return [...this.mapping.agentIds]; }

    public snapshot(): FreebuffRegistrySnapshot {
        return {
            models: this.mapping.modelToAgent,
            fetchedAt: this.fetchedAt,
            source: this.source,
            degraded: this.degraded,
            modelCount: Object.keys(this.mapping.modelToAgent).length,
            agentCount: this.mapping.agentIds.length,
        };
    }

    public start(signal?: AbortSignal): void {
        this.stop();
        const refresh = (): void => { void this.refresh(signal).catch(() => undefined); };
        this.timer = setInterval(refresh, this.refreshIntervalMs);
        this.timer.unref();
        refresh();
    }

    public stop(): void {
        if (this.timer !== undefined) clearInterval(this.timer);
        this.timer = undefined;
    }

    private async fetchSource(url: string, callerSignal?: AbortSignal): Promise<string> {
        const controller = new AbortController();
        const abortCaller = (): void => controller.abort(callerSignal?.reason);
        if (callerSignal?.aborted) abortCaller();
        else callerSignal?.addEventListener("abort", abortCaller, { once: true });
        const timer = setTimeout(() => controller.abort(new Error("FreeBuff registry request timed out")), this.requestTimeoutMs);
        timer.unref();
        try {
            const response = await this.fetchImpl(url, { signal: controller.signal, headers: { Accept: "text/plain", "User-Agent": "SRouter-FreeBuff/1.0" } });
            if (!response.ok) throw new Error(`FreeBuff registry source returned ${response.status}`);
            return await response.text();
        } finally {
            clearTimeout(timer);
            callerSignal?.removeEventListener("abort", abortCaller);
        }
    }
}

export function parseFreebuffRegistrySources(sources: readonly string[]): Readonly<Record<string, string>> {
    return parseRegistry(sources).modelToAgent;
}

export function fallbackFreebuffRegistry(): Readonly<Record<string, string>> {
    return fallbackRegistry().modelToAgent;
}
