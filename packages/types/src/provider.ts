import type {
    ChatCompletionChunk,
    ChatCompletionRequest,
    ChatCompletionResponse,
    ModelObject
} from "./openai.js";

// --- Provider Spectrum & Catalog Types ---
export type ProviderCategory = "oauth" | "free_tier" | "api_key";

export type ProviderProtocol = "openai" | "anthropic" | "gemini" | "custom";

export type ProviderStatusState =
    "connected" | "disconnected" | "ready" | "no_connections" | "error";

export interface ProviderStatus {
    state: ProviderStatusState;
    message?: string;
    connectedCount?: number;
}

export interface ProviderDefinition {
    id: string;
    name: string;
    category: ProviderCategory;
    protocol: ProviderProtocol;
    description?: string;
    icon?: string;
    default_base_url?: string;
    base_url?: string;
    requires_api_key: boolean;
    requires_oauth?: boolean;
    supports_custom_url?: boolean;
    status: ProviderStatus;
    models: ModelObject[];
    connections?: ProviderConfig[];
}

export interface ProviderConfig {
    id: string;
    providerId: string;
    name: string;
    category?: ProviderCategory;
    protocol?: ProviderProtocol;
    base_url?: string;
    apiKey?: string;
    accessToken?: string;
    refreshToken?: string;
    accountId?: string;
    tokenExpiresAt?: number;
    lastRefreshedAt?: number;
    organizationId?: string;
    customHeaders?: Record<string, string>;
    providerSpecificData?: Record<string, string>;
    enabled: boolean;
    createdAt: number;
}

export interface AIProvider {
    id: string;
    name: string;
    category?: ProviderCategory;
    protocol?: ProviderProtocol;
    listModels(): Promise<ModelObject[]>;
    chatCompletion(req: ChatCompletionRequest): Promise<ChatCompletionResponse>;
    chatCompletionStream(
        req: ChatCompletionRequest
    ): AsyncGenerator<ChatCompletionChunk, void, void>;
}
