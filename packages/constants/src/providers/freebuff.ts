import type { ProviderMetadata } from "./types.js";

export const FREEBUFF_BASE_URL = "https://www.codebuff.com/api/v1";

export interface FreebuffModelDefinition {
    id: string;
    name: string;
}

export const FREEBUFF_MODELS: FreebuffModelDefinition[] = [
    { id: "meta/muse-spark-1.3-contributor", name: "Meta Muse Spark 1.3 (Freebuff)" },
    { id: "z-ai/glm-5.3-flash", name: "GLM 5.3 Flash (Freebuff)" },
    { id: "deepseek/deepseek-v4-flash", name: "DeepSeek V4 Flash (Freebuff)" },
    { id: "openai/gpt-5.6-luna", name: "GPT-5.6 Luna (Freebuff)" },
    { id: "xiaomi/mimo-v2.5", name: "Xiaomi MiMo 2.5 (Freebuff)" },
    { id: "upstage/solar-pro-4", name: "Solar Pro 4 (Freebuff)" }
];

export const FREEBUFF_MODEL_IDS: string[] = FREEBUFF_MODELS.map((m) => m.id);

export const FREEBUFF_PROVIDER: ProviderMetadata = {
    id: "freebuff",
    name: "Freebuff (Codebuff)",
    category: "free_tier",
    protocol: "openai",
    alias: "freebuff",
    base_url: FREEBUFF_BASE_URL,
    web_url: "https://codebuff.com",
    requires_api_key: false,
    requires_oauth: false,
    supports_custom_url: true,
    status_message: "Freebuff (CLI Authenticated / Reverse Proxied)"
};
