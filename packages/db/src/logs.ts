import type {
    ModelUsageSummaryRow,
    RequestLogEntry,
    UsageByModelRow,
    UsageSummary
} from "@srouter/types";
import { db } from "./db.js";
import { generateId, num, optStr, str } from "./row-utils.js";

interface RequestLogRow {
    id?: unknown;
    api_key_id?: unknown;
    provider_id?: unknown;
    model?: unknown;
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
    total_tokens?: unknown;
    status_code?: unknown;
    latency_ms?: unknown;
    cached_tokens?: unknown;
    cache_creation_tokens?: unknown;
    reasoning_tokens?: unknown;
    estimated_cost?: unknown;
    fallback_occurred?: unknown;
    fallback_path?: unknown;
    fallback_reason?: unknown;
    resolved_model?: unknown;
    created_at?: unknown;
}

interface UsageSummaryRow {
    totalRequests?: unknown;
    totalTokens?: unknown;
    totalPromptTokens?: unknown;
    totalCompletionTokens?: unknown;
    totalCachedTokens?: unknown;
    totalCacheCreationTokens?: unknown;
    totalReasoningTokens?: unknown;
    totalEstimatedCost?: unknown;
}

interface ModelUsageDBShape {
    model?: unknown;
    totalRequests?: unknown;
    totalTokens?: unknown;
    promptTokens?: unknown;
    completionTokens?: unknown;
    cachedTokens?: unknown;
    estimatedCost?: unknown;
    lastUsedAt?: unknown;
}

interface UsageByModelDBShape {
    model?: unknown;
    totalRequests?: unknown;
    totalInputTokens?: unknown;
    totalOutputTokens?: unknown;
    totalCachedTokens?: unknown;
    estCost?: unknown;
}

export function logRequestDB(entry: Omit<RequestLogEntry, "id" | "createdAt">): RequestLogEntry {
    const Id = generateId("log");
    const CreatedAt = Date.now();

    const Query = db.prepare(`
        INSERT INTO request_logs (id, api_key_id, provider_id, model, prompt_tokens, completion_tokens, total_tokens, status_code, latency_ms, cached_tokens, cache_creation_tokens, reasoning_tokens, estimated_cost, fallback_occurred, fallback_path, fallback_reason, resolved_model, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    Query.run(
        Id,
        entry.apiKeyId ?? null,
        entry.providerId,
        entry.model,
        entry.promptTokens,
        entry.completionTokens,
        entry.totalTokens,
        entry.statusCode,
        entry.latencyMs,
        entry.cachedTokens ?? 0,
        entry.cacheCreationTokens ?? 0,
        entry.reasoningTokens ?? 0,
        entry.estimatedCost ?? 0,
        entry.fallbackOccurred ? 1 : 0,
        entry.fallbackPath ?? null,
        entry.fallbackReason ?? null,
        entry.resolvedModel ?? null,
        CreatedAt
    );

    return {
        id: Id,
        ...entry,
        createdAt: CreatedAt
    };
}

export function getRecentLogsDB(limit = 50): RequestLogEntry[] {
    const Query = db.prepare("SELECT * FROM request_logs ORDER BY created_at DESC LIMIT ?");
    const Rows = Query.all(limit) as RequestLogRow[];

    return Rows.map(mapLogRow);
}

export function getUsageSummaryDB(): UsageSummary {
    const Query = db.prepare(`
        SELECT 
            COUNT(*) as totalRequests,
            COALESCE(SUM(total_tokens), 0) as totalTokens,
            COALESCE(SUM(prompt_tokens), 0) as totalPromptTokens,
            COALESCE(SUM(completion_tokens), 0) as totalCompletionTokens,
            COALESCE(SUM(cached_tokens), 0) as totalCachedTokens,
            COALESCE(SUM(cache_creation_tokens), 0) as totalCacheCreationTokens,
            COALESCE(SUM(reasoning_tokens), 0) as totalReasoningTokens,
            COALESCE(SUM(estimated_cost), 0) as totalEstimatedCost
        FROM request_logs
    `);

    const Result = Query.get() as UsageSummaryRow | undefined;

    return {
        totalRequests: num(Result?.totalRequests),
        totalTokens: num(Result?.totalTokens),
        totalPromptTokens: num(Result?.totalPromptTokens),
        totalCompletionTokens: num(Result?.totalCompletionTokens),
        totalCachedTokens: num(Result?.totalCachedTokens),
        totalCacheCreationTokens: num(Result?.totalCacheCreationTokens),
        totalReasoningTokens: num(Result?.totalReasoningTokens),
        totalEstimatedCost: num(Result?.totalEstimatedCost),
        totalInputTokens: num(Result?.totalPromptTokens),
        totalOutputTokens: num(Result?.totalCompletionTokens)
    };
}

export function getProviderUsageSummaryDB(providerId: string): UsageSummary {
    const Query = db.prepare(`
        SELECT 
            COUNT(*) as totalRequests,
            COALESCE(SUM(total_tokens), 0) as totalTokens,
            COALESCE(SUM(prompt_tokens), 0) as totalPromptTokens,
            COALESCE(SUM(completion_tokens), 0) as totalCompletionTokens,
            COALESCE(SUM(cached_tokens), 0) as totalCachedTokens,
            COALESCE(SUM(cache_creation_tokens), 0) as totalCacheCreationTokens,
            COALESCE(SUM(reasoning_tokens), 0) as totalReasoningTokens,
            COALESCE(SUM(estimated_cost), 0) as totalEstimatedCost
        FROM request_logs
        WHERE provider_id = ?
    `);

    const Result = Query.get(providerId) as UsageSummaryRow | undefined;

    return {
        totalRequests: num(Result?.totalRequests),
        totalTokens: num(Result?.totalTokens),
        totalPromptTokens: num(Result?.totalPromptTokens),
        totalCompletionTokens: num(Result?.totalCompletionTokens),
        totalCachedTokens: num(Result?.totalCachedTokens),
        totalCacheCreationTokens: num(Result?.totalCacheCreationTokens),
        totalReasoningTokens: num(Result?.totalReasoningTokens),
        totalEstimatedCost: num(Result?.totalEstimatedCost),
        totalInputTokens: num(Result?.totalPromptTokens),
        totalOutputTokens: num(Result?.totalCompletionTokens)
    };
}

export function getProviderModelUsageDB(providerId: string): ModelUsageSummaryRow[] {
    const Query = db.prepare(`
        SELECT 
            model,
            COUNT(*) as totalRequests,
            COALESCE(SUM(total_tokens), 0) as totalTokens,
            COALESCE(SUM(prompt_tokens), 0) as promptTokens,
            COALESCE(SUM(completion_tokens), 0) as completionTokens,
            COALESCE(SUM(cached_tokens), 0) as cachedTokens,
            COALESCE(SUM(estimated_cost), 0) as estimatedCost,
            MAX(created_at) as lastUsedAt
        FROM request_logs
        WHERE provider_id = ?
        GROUP BY model
        ORDER BY lastUsedAt DESC
    `);

    const Rows = Query.all(providerId) as ModelUsageDBShape[];

    return Rows.map((row) => ({
        model: str(row.model),
        totalRequests: num(row.totalRequests),
        totalTokens: num(row.totalTokens),
        promptTokens: num(row.promptTokens),
        completionTokens: num(row.completionTokens),
        cachedTokens: num(row.cachedTokens),
        estimatedCost: num(row.estimatedCost),
        lastUsedAt: row.lastUsedAt ? num(row.lastUsedAt) : null
    }));
}

export function getUsageByModelDB(): UsageByModelRow[] {
    const Query = db.prepare(`
        SELECT 
            model,
            COUNT(*) as totalRequests,
            COALESCE(SUM(prompt_tokens), 0) as totalInputTokens,
            COALESCE(SUM(completion_tokens), 0) as totalOutputTokens,
            COALESCE(SUM(cached_tokens), 0) as totalCachedTokens,
            COALESCE(SUM(estimated_cost), 0) as estCost
        FROM request_logs
        GROUP BY model
        ORDER BY totalRequests DESC
    `);

    const Rows = Query.all() as UsageByModelDBShape[];

    return Rows.map((row) => ({
        model: str(row.model),
        totalRequests: num(row.totalRequests),
        totalInputTokens: num(row.totalInputTokens),
        totalOutputTokens: num(row.totalOutputTokens),
        totalCachedTokens: num(row.totalCachedTokens),
        estCost: num(row.estCost)
    }));
}

export function deleteLogsByModelDB(model: string): void {
    const Query = db.prepare("DELETE FROM request_logs WHERE model = ?");
    Query.run(model);
}

export function deleteLogsByProviderDB(providerId: string): void {
    const Query = db.prepare("DELETE FROM request_logs WHERE provider_id = ?");
    Query.run(providerId);
}

function mapLogRow(row: RequestLogRow): RequestLogEntry {
    return {
        id: str(row.id),
        apiKeyId: optStr(row.api_key_id),
        providerId: str(row.provider_id),
        model: str(row.model),
        promptTokens: num(row.prompt_tokens),
        completionTokens: num(row.completion_tokens),
        totalTokens: num(row.total_tokens),
        statusCode: num(row.status_code),
        latencyMs: num(row.latency_ms),
        cachedTokens: num(row.cached_tokens),
        cacheCreationTokens: num(row.cache_creation_tokens),
        reasoningTokens: num(row.reasoning_tokens),
        estimatedCost: num(row.estimated_cost),
        fallbackOccurred: Boolean(row.fallback_occurred),
        fallbackPath: optStr(row.fallback_path),
        fallbackReason: optStr(row.fallback_reason),
        resolvedModel: optStr(row.resolved_model),
        createdAt: num(row.created_at)
    };
}
