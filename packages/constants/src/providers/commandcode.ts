import type { ProviderMetadata } from "./types.js";

export const COMMANDCODE_BASE_URL = "https://api.commandcode.ai/alpha/generate";
export const COMMANDCODE_MODELS_URL = "https://api.commandcode.ai/provider/v1/models";

export const COMMANDCODE_PROVIDER: ProviderMetadata = {
    id: "commandcode",
    name: "Command Code",
    category: "api_key",
    protocol: "openai",
    base_url: COMMANDCODE_BASE_URL,
    web_url: "https://commandcode.ai",
    requires_api_key: true,
    supports_custom_url: true,
    status_message: "Command Code API key missing"
};
