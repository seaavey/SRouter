import type { AIProvider, ChatCompletionChunk, ChatCompletionRequest, ChatCompletionResponse, ModelObject, ProviderDefinition } from "@srouter/types";

// Provider base id -> short alias used in model ids (e.g. openai/gpt-4o).
// Multi-account ids (openai_1700000000) resolve to the same alias.
const PROVIDER_ALIASES: Record<string, string> = {
    openai: "openai",
    anthropic: "anthropic",
    antigravity: "antigravity",
    openai_codex: "openai",
    commandcode: "commandcode",
    freebuff: "freebuff",
    gemini: "gemini",
    vertex: "vertex",
};

export function getProviderAlias(providerId: string): string {
    const baseId = providerId.split("_")[0]?.split("-")[0] ?? providerId;
    return PROVIDER_ALIASES[baseId] ?? baseId;
}

// Strip any {alias}/ or {providerId}/ prefix from a model id, returning the bare id.
function stripModelPrefix(modelId: string, alias: string, providerId: string): string {
    if (modelId.startsWith(`${alias}/`)) return modelId.slice(alias.length + 1);
    if (modelId.startsWith(`${providerId}/`)) return modelId.slice(providerId.length + 1);
    return modelId;
}

export const DEFAULT_CATALOG: ProviderDefinition[] = [
    {
        id: "freebuff",
        name: "FreeBuff",
        category: "free_tier",
        protocol: "openai",
        description: "Native FreeBuff/Codebuff provider with live model registry and multi-token failover.",
        icon: "🟢",
        defaultBaseUrl: "https://www.codebuff.com",
        requiresApiKey: false,
        supportsCustomUrl: true,
        status: { state: "no_connections", message: "FreeBuff token missing" },
        models: [],
    },
    {
        id: "openai_codex",
        name: "OpenAI Codex / ChatGPT",
        category: "oauth",
        protocol: "openai",
        description: "OpenAI OAuth driver with GPT-4o, o1, o3-mini & Codex integration.",
        icon: "🤖",
        requiresApiKey: false,
        requiresOAuth: true,
        status: { state: "disconnected", message: "OAuth token missing" },
        models: [
            { id: "gpt-4o", object: "model", owned_by: "openai" },
            { id: "gpt-4o-mini", object: "model", owned_by: "openai" },
            { id: "o1", object: "model", owned_by: "openai" },
            { id: "o1-mini", object: "model", owned_by: "openai" },
            { id: "o3-mini", object: "model", owned_by: "openai" },
            { id: "gpt-4-turbo", object: "model", owned_by: "openai" },
            { id: "chatgpt-4o-latest", object: "model", owned_by: "openai" },
        ],
    },
    {
        id: "anthropic",
        name: "Anthropic Claude",
        category: "oauth",
        protocol: "anthropic",
        description: "Anthropic Claude driver supporting Claude 3.5 Sonnet & Haiku.",
        icon: "🧠",
        requiresApiKey: false,
        requiresOAuth: true,
        status: { state: "disconnected", message: "OAuth token missing" },
        models: [
            { id: "claude-3-5-sonnet-20241022", object: "model", owned_by: "anthropic" },
            { id: "claude-3-5-haiku-20241022", object: "model", owned_by: "anthropic" },
        ],
    },
    {
        id: "antigravity",
        name: "Antigravity Cloud",
        category: "oauth",
        protocol: "openai",
        description: "Google Antigravity LLM Routing Cloud with Gemini 2.0 & Claude 3.5.",
        icon: "🚀",
        requiresApiKey: false,
        requiresOAuth: true,
        status: { state: "disconnected", message: "Antigravity OAuth token missing" },
        models: [
            { id: "gemini-2.0-flash-exp", object: "model", owned_by: "antigravity" },
            { id: "claude-3-5-sonnet-20241022", object: "model", owned_by: "antigravity" },
        ],
    },
    {
        id: "groq",
        name: "Groq Cloud",
        category: "free_tier",
        protocol: "openai",
        description: "Groq Llama 3 & DeepSeek R1 ultra-fast inference driver.",
        icon: "⚡",
        requiresApiKey: true,
        status: { state: "ready" },
        models: [
            { id: "llama-3.3-70b-versatile", object: "model", owned_by: "groq" },
            { id: "deepseek-r1-distill-llama-70b", object: "model", owned_by: "groq" },
        ],
    },
    {
        id: "openrouter",
        name: "OpenRouter Free",
        category: "free_tier",
        protocol: "openai",
        description: "OpenRouter free tier unified LLM routing driver.",
        icon: "🌐",
        requiresApiKey: true,
        status: { state: "ready" },
        models: [
            { id: "meta-llama/llama-3.3-70b-instruct:free", object: "model", owned_by: "openrouter" },
        ],
    },
    {
        id: "openai_api_key",
        name: "OpenAI Platform API Key",
        category: "api_key",
        protocol: "openai",
        description: "Direct OpenAI platform API Key authentication.",
        icon: "🔑",
        requiresApiKey: true,
        status: { state: "ready" },
        models: [
            { id: "gpt-4o", object: "model", owned_by: "openai" },
            { id: "gpt-4o-mini", object: "model", owned_by: "openai" },
        ],
    },
    {
        id: "anthropic_api_key",
        name: "Anthropic Platform API Key",
        category: "api_key",
        protocol: "anthropic",
        description: "Direct Anthropic platform API Key authentication.",
        icon: "🔑",
        requiresApiKey: true,
        status: { state: "ready" },
        models: [
            { id: "claude-3-5-sonnet-20241022", object: "model", owned_by: "anthropic" },
        ],
    },
];

export class ProviderRegistry {
    private providers: Map<string, AIProvider> = new Map();
    private defaultProvider: AIProvider;
    private catalog: ProviderDefinition[] = [...DEFAULT_CATALOG];

    constructor(defaultProvider?: AIProvider) {
        this.defaultProvider = defaultProvider ?? {
            id: "default",
            name: "Default Provider",
            category: "api_key",
            protocol: "openai",
            listModels: async () => [],
            chatCompletion: async (req: ChatCompletionRequest) => {
                throw new Error("No default provider set for chatCompletion");
            },
            chatCompletionStream: async function* (req: ChatCompletionRequest): AsyncGenerator<ChatCompletionChunk, void, void> {
                throw new Error("No default provider set for chatCompletionStream");
            },
        };
        this.registerProvider(this.defaultProvider);
    }


    registerProvider(provider: AIProvider): void {
        this.providers.set(provider.id, provider);
        // Update catalog status if matched (supports prefix for multi-account e.g. antigravity_1700000000)
        const baseId = provider.id.split("_")[0]?.split("-")[0] ?? provider.id;
        const catItem = this.catalog.find((c) => c.id === provider.id || c.id === baseId);
        if (catItem) {
            const connectedCount = Array.from(this.providers.keys()).filter((k) => k === catItem.id || k.startsWith(`${catItem.id}_`) || k.startsWith(`${catItem.id}-`)).length;
            catItem.status = { state: "connected", connectedCount };
        }
    }

    unregisterProvider(providerId: string): void {
        this.providers.delete(providerId);
        const baseId = providerId.split("_")[0]?.split("-")[0] ?? providerId;
        const catItem = this.catalog.find((c) => c.id === providerId || c.id === baseId);
        if (catItem?.id === "freebuff") {
            catItem.status = { state: "no_connections", message: "FreeBuff token missing" };
        }
    }

    getProvider(providerId: string): AIProvider | undefined {
        return this.providers.get(providerId);
    }

    getAllProviders(): Map<string, AIProvider> {
        return this.providers;
    }

    getCatalog(): ProviderDefinition[] {
        return this.catalog;
    }

    async getProviderForModel(modelId: string): Promise<AIProvider> {
        const candidates: AIProvider[] = [];

        // 1. Direct match from registered providers' listModels()
        for (const provider of this.providers.values()) {
            if (provider.id === "default") continue;
            const models = await provider.listModels();
            if (models.some((m) => m.id === modelId)) {
                candidates.push(provider);
            }
        }

        // 2. Prefix matching for provider ID (e.g., antigravity/gemini-3.6-flash -> antigravity_*)
        if (candidates.length === 0) {
            const prefix = modelId.includes("/") ? (modelId.split("/")[0] ?? modelId) : modelId;
            for (const [id, provider] of this.providers.entries()) {
                if (id === "default") continue;
                if (id === prefix || id.startsWith(`${prefix}_`) || id.startsWith(`${prefix}-`)) {
                    candidates.push(provider);
                }
            }
        }

        // 3. Catalog matching across all registered accounts
        if (candidates.length === 0) {
            for (const cat of this.catalog) {
                if (cat.models.some((m) => m.id === modelId)) {
                    for (const [id, provider] of this.providers.entries()) {
                        if (id === "default") continue;
                        if (id === cat.id || id.startsWith(`${cat.id}_`) || id.startsWith(`${cat.id}-`)) {
                            candidates.push(provider);
                        }
                    }
                }
            }
        }

        if (candidates.length > 0) {
            // Round-robin load balancing across all connected accounts
            const index = Math.floor(Math.random() * candidates.length);
            return candidates[index] ?? candidates[0] ?? this.defaultProvider;
        }

        return this.defaultProvider;
    }

    async listAllModels(providerFilter?: string): Promise<ModelObject[]> {
        const allModels: ModelObject[] = [];
        const seenIds = new Set<string>();

        const matchesFilter = (alias: string): boolean => {
            if (!providerFilter) return true;
            const filter = providerFilter.toLowerCase();
            return alias.toLowerCase() === filter || alias.toLowerCase().startsWith(filter);
        };

        const addModel = (model: ModelObject, alias: string, providerId: string): void => {
            if (!matchesFilter(alias)) return;
            const bareId = stripModelPrefix(model.id, alias, providerId);
            const id = `${alias}/${bareId}`;
            if (!seenIds.has(id)) {
                seenIds.add(id);
                allModels.push({ id, object: "model", owned_by: alias });
            }
        };

        // 1. Models from registered/connected providers ONLY
        for (const provider of this.providers.values()) {
            if (provider.id === "default") continue;

            const alias = getProviderAlias(provider.id);

            // Fetch live models from provider endpoint using its accessToken / apiKey
            const liveModels = await provider.listModels();
            for (const model of liveModels) {
                addModel(model, alias, provider.id);
            }

            // Include catalog models corresponding ONLY to connected providers
            const baseId = provider.id.split("_")[0]?.split("-")[0] ?? provider.id;
            const catItem = this.catalog.find((c) => c.id === provider.id || c.id === baseId);
            if (catItem) {
                for (const model of catItem.models) {
                    addModel(model, alias, provider.id);
                }
            }
        }

        // 2. If no active providers connected, return catalog models of providers marked as connected/ready
        if (allModels.length === 0) {
            for (const cat of this.catalog) {
                if (cat.status.state === "connected" || cat.status.state === "ready") {
                    const alias = getProviderAlias(cat.id);
                    for (const model of cat.models) {
                        addModel(model, alias, cat.id);
                    }
                }
            }
        }

        return allModels;
    }

    async chatCompletion(req: ChatCompletionRequest): Promise<ChatCompletionResponse> {
        const provider = await this.getProviderForModel(req.model);
        return provider.chatCompletion(req);
    }

    async *chatCompletionStream(req: ChatCompletionRequest): AsyncGenerator<ChatCompletionChunk, void, void> {
        const provider = await this.getProviderForModel(req.model);
        yield* provider.chatCompletionStream(req);
    }
}
