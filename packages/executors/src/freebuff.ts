import {
    FREEBUFF_BASE_URL,
    FREEBUFF_MODELS,
    type FreebuffModelDefinition
} from "@srouter/constants";
import type { ModelObject } from "@srouter/types";
import { OpenAIExecutor, type OpenAIExecutorOptions } from "./openai.js";

export interface FreebuffExecutorOptions extends OpenAIExecutorOptions {
    freebuffToken?: string;
}

export class FreebuffExecutor extends OpenAIExecutor {
    private readonly freebuffToken: string;

    constructor(options: FreebuffExecutorOptions = {}) {
        super({
            id: options.id ?? "freebuff",
            name: options.name ?? "Freebuff (Codebuff)",
            baseUrl: options.baseUrl ?? FREEBUFF_BASE_URL,
            apiKey: options.apiKey ?? options.freebuffToken ?? "",
            accessToken: options.accessToken ?? ""
        });
        this.freebuffToken = options.freebuffToken ?? options.apiKey ?? "";
    }

    override async listModels(): Promise<ModelObject[]> {
        const baseId = this.id.split("_")[0]?.split("-")[0] ?? this.id;
        return FREEBUFF_MODELS.map((m: FreebuffModelDefinition) => ({
            id: `${baseId}/${m.id}`,
            object: "model",
            owned_by: baseId
        }));
    }
}
