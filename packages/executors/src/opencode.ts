import { OPENCODE_ZEN_BASE_URL } from "@srouter/constants";
import type { ModelObject } from "@srouter/types";
import { OpenAIExecutor, type OpenAIExecutorOptions } from "./openai.js";

export interface OpenCodeZenModelDefinition {
    id: string;
    name: string;
}

export const OPENCODE_ZEN_MODELS: OpenCodeZenModelDefinition[] = [
    { id: "x-preview-f-free", name: "Ox Alpha Free (Unlimited)" },
    { id: "big-pickle", name: "Big Pickle (Free)" },
    { id: "laguna-s-2.1-free", name: "Poolside Laguna S 2.1 (Free)" },
    { id: "nemotron-3.5-lightning-free", name: "Nemotron 3.5 Lightning (Free)" },
    { id: "nemotron-3-ultra-free", name: "Nemotron 3 Ultra (Free)" },
    { id: "mimo-v2.5-free", name: "Xiaomi MiMo V2.5 (Free)" }
];

export const OPENCODE_ZEN_MODEL_IDS: string[] = OPENCODE_ZEN_MODELS.map((m) => m.id);

export interface OpenCodeZenExecutorOptions extends OpenAIExecutorOptions {}

export class OpenCodeZenExecutor extends OpenAIExecutor {
    constructor(options: OpenCodeZenExecutorOptions = {}) {
        super({
            id: options.id ?? "opencode_zen",
            name: options.name ?? "OpenCode Zen (Free)",
            baseUrl: options.baseUrl ?? OPENCODE_ZEN_BASE_URL,
            apiKey: options.apiKey ?? "",
            accessToken: options.accessToken ?? ""
        });
    }

    override async listModels(): Promise<ModelObject[]> {
        const baseId = this.id.split("_")[0]?.split("-")[0] ?? this.id;
        return OPENCODE_ZEN_MODELS.map((m) => ({
            id: `${baseId}/${m.id}`,
            object: "model",
            owned_by: baseId
        }));
    }
}
