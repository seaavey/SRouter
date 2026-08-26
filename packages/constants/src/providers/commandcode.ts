import type { KnownProvider } from "./types.js";

export const COMMANDCODE_BASE_URL = "https://api.commandcode.ai/alpha/generate";
export const COMMANDCODE_MODELS_URL = "https://api.commandcode.ai/provider/v1/models";

export const COMMANDCODE_PROVIDER: KnownProvider = {
    id: "commandcode",
    name: "Command Code",
    category: "api_key",
    protocol: "openai",
    baseUrl: COMMANDCODE_BASE_URL,
    websiteUrl: "https://commandcode.ai",
    requiresApiKey: true,
    supportsCustomUrl: true,
    statusMessage: "Command Code API key missing"
};
