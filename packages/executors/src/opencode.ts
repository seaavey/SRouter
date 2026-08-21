import { OPENCODE_ZEN_BASE_URL, OPENCODE_ZEN_MODELS } from "@srouter/constants";
import type { ModelObject } from "@srouter/types";
import { OpenAIExecutor, type OpenAIExecutorOptions } from "./openai.js";

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
