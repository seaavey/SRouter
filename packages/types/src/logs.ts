import { z } from "zod";

export interface LogCostBreakdown {
    inputCost: number;
    outputCost: number;
    cacheReadCost: number;
    cacheCreationCost?: number;
    totalCost: number;
}

export interface RequestLogEntry {
    id: string;
    apiKeyId?: string;
    apiKeyName?: string;
    ipAddress?: string;
    userAgent?: string;
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
    costBreakdown?: LogCostBreakdown;
    fallbackOccurred?: boolean;
    fallbackPath?: string;
    fallbackReason?: string;
    resolvedModel?: string;
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

// --- Analytics ---

export type AnalyticsWindow = "1h" | "24h" | "7d" | "30d";

export interface AnalyticsBucket {
    bucketStart: number; // epoch ms, aligned to bucket size
    totalRequests: number;
    successRequests: number;
    errorRequests: number;
    avgLatencyMs: number;
    totalTokens: number;
    promptTokens: number;
    completionTokens: number;
    cachedTokens: number;
}

export type AnalyticsTopModel = Pick<
    UsageByModelRow,
    "model" | "totalRequests" | "estCost"
> & {
    totalTokens: number;
};

export type AnalyticsTopAgent = Pick<
    UsageSummary,
    "totalRequests" | "totalTokens"
> & {
    agent: string;
    rawUserAgent: string;
};

export interface AnalyticsProviderSlice {
    providerId: string;
    totalRequests: number;
}

export interface AnalyticsReport {
    object: "analytics";
    window: AnalyticsWindow;
    bucketSizeMs: number;
    generatedAt: number;
    requestsPerSecond: number; // rolling 60s average
    totalRequests: number;
    errorRate: number; // 0..1 over the window
    p95LatencyMs: number;
    buckets: AnalyticsBucket[];
    topModels: AnalyticsTopModel[];
    topAgents?: AnalyticsTopAgent[];
    providers: AnalyticsProviderSlice[];
}

export const AnalyticsQuerySchema = z.object({
    window: z.enum(["1h", "24h", "7d", "30d"]).default("24h")
});
export type AnalyticsQuery = z.infer<typeof AnalyticsQuerySchema>;
