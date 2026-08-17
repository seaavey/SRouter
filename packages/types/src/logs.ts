export interface RequestLogEntry {
    id: string;
    apiKeyId?: string;
    providerId: string;
    model: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    statusCode: number;
    latencyMs: number;
    cachedTokens?: number;
    cacheCreationTokens?: number;
    reasoningTokens?: number;
    estimatedCost?: number;
    fallbackOccurred?: boolean;
    fallbackPath?: string;
    fallbackReason?: string;
    createdAt: number;
}

export interface UsageSummary {
    totalRequests: number;
    totalTokens: number;
    totalPromptTokens: number;
    totalCompletionTokens: number;
    totalCachedTokens: number;
    totalCacheCreationTokens: number;
    totalReasoningTokens: number;
    totalEstimatedCost: number;
    // 9router-style aliases
    totalInputTokens: number;
    totalOutputTokens: number;
}

export interface UsageByModelRow {
    model: string;
    totalRequests: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCachedTokens: number;
    estCost: number;
}

export interface ModelUsageSummaryRow {
    model: string;
    totalRequests: number;
    totalTokens: number;
    promptTokens: number;
    completionTokens: number;
    cachedTokens: number;
    estimatedCost: number;
    lastUsedAt: number | null;
}

export interface UsageStats extends UsageSummary {
    object: "usage";
    costLabel: string;
    estimated: boolean;
    byModel: UsageByModelRow[];
}
