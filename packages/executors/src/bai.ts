import { BAI_BASE_URL, BAI_DEFAULT_MODELS } from "@srouter/constants";
import type { ModelObject } from "@srouter/types";
import { OpenAIExecutor, type OpenAIExecutorOptions } from "./openai.js";

export interface BAIExecutorOptions extends OpenAIExecutorOptions {}

export class BAIExecutor extends OpenAIExecutor {
    constructor(options: BAIExecutorOptions = {}) {
        super({
            id: options.id ?? "bai",
            name: options.name ?? "B.AI",
            baseUrl: options.baseUrl ?? BAI_BASE_URL,
            apiKey: options.apiKey,
            accessToken: options.accessToken
        });
    }

    override async listModels(): Promise<ModelObject[]> {
        const liveModels = await super.listModels();
        if (liveModels && liveModels.length > 0) {
            return liveModels;
        }

        const baseId = this.id.split("_")[0]?.split("-")[0] ?? this.id;
        return BAI_DEFAULT_MODELS.map((m) => ({
            id: `${baseId}/${m.id}`,
            object: "model",
            owned_by: baseId
        }));
    }
}
