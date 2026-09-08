import fs from "node:fs/promises";
import path from "node:path";
import { AbstractToolAdapter } from "./base.js";
import type { LinkResult, ToolConfigContext, ToolStatus } from "../types/index.js";
import { ConfigStore, defaultStore } from "../lib/configStore.js";
import { getOpenCodeConfigPath, isExecutableInPath } from "../lib/platform.js";
import { fetchAvailableModels } from "../lib/srouterClient.js";
import { getModelMetadata } from "@srouter/pricing";

export interface OpenCodeModelConfig {
    id?: string;
    name: string;
    attachment?: boolean;
    modalities?: {
        input?: string[];
        output?: string[];
    };
}

function createOpenCodeModelConfig(id: string, name?: string): OpenCodeModelConfig {
    const displayName = name || formatModelDisplayName(id);
    const config: OpenCodeModelConfig = {
        id,
        name: displayName
    };

    // Check metadata from @srouter/pricing (pricing.jsonc)
    const meta = getModelMetadata(id);
    if (meta?.modalities?.input?.includes("image") || meta?.attachment) {
        config.attachment = true;
        config.modalities = {
            input: meta.modalities?.input || ["text", "image"],
            output: meta.modalities?.output || ["text"]
        };
    } else {
        // Heuristic fallback for known multimodal model families
        const lower = id.toLowerCase();
        const isKnownVision =
            lower.includes("gemini") ||
            lower.includes("vision") ||
            lower.includes("gpt-4o") ||
            lower.includes("claude-3") ||
            lower.includes("claude-sonnet") ||
            lower.includes("claude-opus") ||
            lower.includes("pixtral");

        if (isKnownVision) {
            config.attachment = true;
            config.modalities = {
                input: ["text", "image"],
                output: ["text"]
            };
        }
    }

    return config;
}

export const DEFAULT_SROUTER_MODELS: Array<{ id: string; name: string }> = [

    { id: "anthropic/claude-3-7-sonnet", name: "Claude 3.7 Sonnet (Anthropic)" },
    { id: "claude-3-7-sonnet", name: "Claude 3.7 Sonnet" },
    { id: "anthropic/claude-3-5-sonnet", name: "Claude 3.5 Sonnet (Anthropic)" },
    { id: "claude-3-5-sonnet", name: "Claude 3.5 Sonnet" },
    { id: "anthropic/claude-3-5-haiku", name: "Claude 3.5 Haiku (Anthropic)" },
    { id: "openai_codex/gpt-4o", name: "GPT-4o (OpenAI Codex)" },
    { id: "gpt-4o", name: "GPT-4o" },
    { id: "openai_codex/gpt-4.5-preview", name: "GPT-4.5 Preview (OpenAI Codex)" },
    { id: "openai_codex/o3-mini", name: "o3-mini (OpenAI Codex)" },
    { id: "openai_codex/o1", name: "o1 (OpenAI Codex)" },
    { id: "antigravity/gemini-2.5-pro", name: "Gemini 2.5 Pro (Antigravity)" },
    { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
    { id: "antigravity/gemini-2.5-flash", name: "Gemini 2.5 Flash (Antigravity)" },
    { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
    { id: "kiro/claude-3-7-sonnet", name: "Claude 3.7 Sonnet (Kiro)" },
    { id: "qoder/qwen-2.5-coder-32b", name: "Qwen 2.5 Coder 32B (Qoder)" },
    { id: "deepseek/deepseek-r1", name: "DeepSeek R1" },
    { id: "deepseek/deepseek-v3", name: "DeepSeek V3" },
    { id: "combo/flagship", name: "Combo: Flagship Cascade" },
    { id: "combo/fast", name: "Combo: Fast Fallback" }
];

export function formatModelDisplayName(modelId: string): string {
    const knownNames: Record<string, string> = {
        "claude-3-7-sonnet": "Claude 3.7 Sonnet",
        "claude-3-5-sonnet": "Claude 3.5 Sonnet",
        "claude-3-5-haiku": "Claude 3.5 Haiku",
        "claude-3-opus": "Claude 3 Opus",
        "gpt-4o": "GPT-4o",
        "gpt-4o-mini": "GPT-4o Mini",
        "gpt-4.5-preview": "GPT-4.5 Preview",
        "o3-mini": "o3-mini",
        o1: "o1",
        "o1-preview": "o1 Preview",
        "gemini-2.5-pro": "Gemini 2.5 Pro",
        "gemini-2.5-flash": "Gemini 2.5 Flash",
        "gemini-2.0-flash": "Gemini 2.0 Flash",
        "deepseek-r1": "DeepSeek R1",
        "deepseek-v3": "DeepSeek V3",
        "deepseek-coder": "DeepSeek Coder",
        "qwen-2.5-coder-32b": "Qwen 2.5 Coder 32B",
        "qwen-2.5-72b-instruct": "Qwen 2.5 72B",
        "qwen3-max": "Qwen 3 Max",
        flagship: "Flagship Cascade",
        fast: "Fast Fallback"
    };

    if (knownNames[modelId]) {
        return knownNames[modelId];
    }

    if (modelId.includes("/")) {
        const [provider, ...rest] = modelId.split("/");
        const baseModel = rest.join("/");
        const baseName = knownNames[baseModel] || humanizeName(baseModel);
        const providerName = formatProviderLabel(provider);
        return `${baseName} (${providerName})`;
    }

    return humanizeName(modelId);
}

function formatProviderLabel(provider: string): string {
    const providerMap: Record<string, string> = {
        anthropic: "Anthropic",
        openai_codex: "OpenAI Codex",
        openai: "OpenAI",
        antigravity: "Antigravity",
        kiro: "Kiro",
        qoder: "Qoder",
        codebuddy: "CodeBuddy",
        deepseek: "DeepSeek",
        gorouter: "GoRouter",
        bluesminds: "BluesMinds",
        seekai: "SeekAI",
        tabitoken: "TabiToken",
        tokenrouter: "TokenRouter",
        commandcode: "CommandCode",
        combo: "Combo"
    };
    return providerMap[provider] || provider.charAt(0).toUpperCase() + provider.slice(1);
}

function humanizeName(str: string): string {
    return str.replace(/[-_]/g, " ").replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

function parseJsonc(content: string): Record<string, any> {
    try {
        const clean = content
            .replace(/\/\*[\s\S]*?\*\//g, "")
            .replace(/\/\/.*$/gm, "")
            .replace(/,\s*([\]}])/g, "$1");
        return JSON.parse(clean);
    } catch {
        try {
            return JSON.parse(content);
        } catch {
            return {};
        }
    }
}

export class OpenCodeAdapter extends AbstractToolAdapter {
    readonly id = "opencode";
    readonly name = "OpenCode";
    readonly description = "Open-source AI coding assistant and agent";

    private customConfigPath?: string;

    constructor(store: ConfigStore = defaultStore, customConfigPath?: string) {
        super(store);
        this.customConfigPath = customConfigPath;
    }

    getConfigPath(): string {
        if (this.customConfigPath) {
            return this.customConfigPath;
        }
        return getOpenCodeConfigPath();
    }

    async isInstalled(): Promise<boolean> {
        const opencode = await isExecutableInPath("opencode");
        if (opencode) return true;
        return isExecutableInPath("interpreter");
    }

    async getStatus(): Promise<ToolStatus> {
        const configPath = this.getConfigPath();
        const installed = await this.isInstalled();

        try {
            const raw = await fs.readFile(configPath, "utf-8");
            const parsed = parseJsonc(raw);
            const baseUrl =
                parsed.provider?.srouter?.options?.baseURL ||
                parsed.openai_base_url ||
                parsed.api_base ||
                parsed.baseUrl ||
                parsed.providers?.srouter?.baseUrl ||
                undefined;
            const model = parsed.model || parsed.default_model || undefined;
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
            data = parseJsonc(raw);
        } catch {
            data = {};
        }

        // Schema declaration
        data["$schema"] = "https://opencode.ai/config.json";

        // Clean any conflicting legacy fields
        delete data.providers;
        delete data.openai_base_url;
        delete data.api_base;
        delete data.api_key;
        delete data.openai_api_key;

        // OpenCode provider configuration
        data.provider = data.provider || {};
        const existingSrouter = data.provider.srouter || {};
        const existingModels = existingSrouter.models || {};

        const modelsMap: Record<string, OpenCodeModelConfig> = {};

        // 1. Seed with default catalog
        for (const m of DEFAULT_SROUTER_MODELS) {
            modelsMap[m.id] = createOpenCodeModelConfig(m.id, m.name);
        }

        // 2. Retain existing models from user config (enriching with vision/capabilities if missing)
        for (const [key, val] of Object.entries(existingModels)) {
            if (val && typeof val === "object") {
                const existingVal = val as OpenCodeModelConfig;
                const fresh = createOpenCodeModelConfig(key, existingVal.name);
                modelsMap[key] = {
                    ...fresh,
                    ...existingVal,
                    ...(fresh.attachment !== undefined && { attachment: fresh.attachment }),
                    ...(fresh.modalities !== undefined && { modalities: fresh.modalities })
                };
            }
        }

        // 3. Fetch live models from SRouter Gateway
        try {
            const liveModels =
                context.availableModels && context.availableModels.length > 0
                    ? context.availableModels
                    : await fetchAvailableModels(context.baseUrl, context.apiKey);

            for (const rawId of liveModels) {
                if (!rawId) continue;
                const cleanId = rawId.startsWith("srouter/")
                    ? rawId.replace(/^srouter\//, "")
                    : rawId;
                modelsMap[cleanId] = createOpenCodeModelConfig(cleanId);
            }
        } catch {
            // Silently fall back to default catalog
        }

        // 4. Ensure current user-selected model is present
        const rawModel = context.model || "claude-3-7-sonnet";
        const cleanModelId = rawModel.startsWith("srouter/")
            ? rawModel.replace(/^srouter\//, "")
            : rawModel;

        modelsMap[cleanModelId] = createOpenCodeModelConfig(
            cleanModelId,
            modelsMap[cleanModelId]?.name
        );

        data.provider.srouter = {
            name: "SRouter",
            npm: "@ai-sdk/openai-compatible",
            options: {
                baseURL: context.baseUrl,
                apiKey: context.apiKey || "sk-local-srouter"
            },
            models: modelsMap
        };

        // OpenCode format for active model: "provider/model"
        data.model = `srouter/${cleanModelId}`;

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
            const data = parseJsonc(raw);
            if (data.provider?.srouter) {
                delete data.provider.srouter;
            }
            if (data.model?.startsWith("srouter/")) {
                delete data.model;
            }
            delete data.openai_base_url;
            delete data.api_base;
            delete data.openai_api_key;
            delete data.api_key;
            delete data.providers;
            await fs.writeFile(configPath, JSON.stringify(data, null, 4), "utf-8");
            return true;
        } catch {
            return false;
        }
    }

    getEnv(context: ToolConfigContext): Record<string, string> {
        const env: Record<string, string> = {
            OPENAI_BASE_URL: context.baseUrl,
            ANTHROPIC_BASE_URL: context.baseUrl
        };
        if (context.apiKey) {
            env.OPENAI_API_KEY = context.apiKey;
            env.ANTHROPIC_API_KEY = context.apiKey;
        }
        if (context.model) {
            const cleanModelId = context.model.startsWith("srouter/")
                ? context.model.replace(/^srouter\//, "")
                : context.model;
            env.OPENCODE_MODEL = `srouter/${cleanModelId}`;
        }
        return env;
    }
}
