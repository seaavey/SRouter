import type {
    ModelUsageSummaryRow,
    RequestLogEntry,
    UsageByModelRow,
    UsageSummary
} from "@srouter/types";
import { db } from "./db.js";

export function logRequestDB(entry: Omit<RequestLogEntry, "id" | "createdAt">): RequestLogEntry {
    const id = `log_${Math.random().toString(36).substring(2, 11)}`;
    const createdAt = Date.now();

    const query = db.prepare(`
        INSERT INTO request_logs (id, api_key_id, provider_id, model, prompt_tokens, completion_tokens, total_tokens, status_code, latency_ms, cached_tokens, cache_creation_tokens, reasoning_tokens, estimated_cost, fallback_occurred, fallback_path, fallback_reason, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    query.run(
        id,
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
        createdAt
    );

    return {
        id,
        ...entry,
        createdAt
    };
}

export function getRecentLogsDB(limit = 50): RequestLogEntry[] {
    const query = db.prepare("SELECT * FROM request_logs ORDER BY created_at DESC LIMIT ?");
    const rows = query.all(limit);

    return rows.map((row) => ({
        id: String(row.id ?? ""),
        apiKeyId: row.api_key_id ? String(row.api_key_id) : undefined,
        providerId: String(row.provider_id ?? ""),
        model: String(row.model ?? ""),
        promptTokens: Number(row.prompt_tokens ?? 0),
        completionTokens: Number(row.completion_tokens ?? 0),
        totalTokens: Number(row.total_tokens ?? 0),
        statusCode: Number(row.status_code ?? 0),
        latencyMs: Number(row.latency_ms ?? 0),
        cachedTokens: Number(row.cached_tokens ?? 0),
        cacheCreationTokens: Number(row.cache_creation_tokens ?? 0),
        reasoningTokens: Number(row.reasoning_tokens ?? 0),
        estimatedCost: Number(row.estimated_cost ?? 0),
        fallbackOccurred: Boolean(row.fallback_occurred),
        fallbackPath: row.fallback_path ? String(row.fallback_path) : undefined,
        fallbackReason: row.fallback_reason ? String(row.fallback_reason) : undefined,
        createdAt: Number(row.created_at ?? 0)
    }));
}

export function getUsageSummaryDB(): UsageSummary {
    const query = db.prepare(`
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

    const result = query.get();

    return {
        totalRequests: Number(result?.totalRequests ?? 0),
        totalTokens: Number(result?.totalTokens ?? 0),
        totalPromptTokens: Number(result?.totalPromptTokens ?? 0),
        totalCompletionTokens: Number(result?.totalCompletionTokens ?? 0),
        totalCachedTokens: Number(result?.totalCachedTokens ?? 0),
        totalCacheCreationTokens: Number(result?.totalCacheCreationTokens ?? 0),
        totalReasoningTokens: Number(result?.totalReasoningTokens ?? 0),
        totalEstimatedCost: Number(result?.totalEstimatedCost ?? 0),
        totalInputTokens: Number(result?.totalPromptTokens ?? 0),
        totalOutputTokens: Number(result?.totalCompletionTokens ?? 0)
    };
}

export function getProviderUsageSummaryDB(providerId: string): UsageSummary {
    const query = db.prepare(`
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

    const result = query.get(providerId);

    return {
        totalRequests: Number(result?.totalRequests ?? 0),
        totalTokens: Number(result?.totalTokens ?? 0),
        totalPromptTokens: Number(result?.totalPromptTokens ?? 0),
        totalCompletionTokens: Number(result?.totalCompletionTokens ?? 0),
        totalCachedTokens: Number(result?.totalCachedTokens ?? 0),
        totalCacheCreationTokens: Number(result?.totalCacheCreationTokens ?? 0),
        totalReasoningTokens: Number(result?.totalReasoningTokens ?? 0),
        totalEstimatedCost: Number(result?.totalEstimatedCost ?? 0),
        totalInputTokens: Number(result?.totalPromptTokens ?? 0),
        totalOutputTokens: Number(result?.totalCompletionTokens ?? 0)
    };
}

export function getProviderModelUsageDB(providerId: string): ModelUsageSummaryRow[] {
    const query = db.prepare(`
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

    const rows = query.all(providerId);

    return rows.map((row) => ({
        model: String(row.model ?? ""),
        totalRequests: Number(row.totalRequests ?? 0),
        totalTokens: Number(row.totalTokens ?? 0),
        promptTokens: Number(row.promptTokens ?? 0),
        completionTokens: Number(row.completionTokens ?? 0),
        cachedTokens: Number(row.cachedTokens ?? 0),
        estimatedCost: Number(row.estimatedCost ?? 0),
        lastUsedAt: row.lastUsedAt ? Number(row.lastUsedAt) : null
    }));
}

export function getUsageByModelDB(): UsageByModelRow[] {
    const query = db.prepare(`
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

    const rows = query.all();

    return rows.map((row) => ({
        model: String(row.model ?? ""),
        totalRequests: Number(row.totalRequests ?? 0),
        totalInputTokens: Number(row.totalInputTokens ?? 0),
        totalOutputTokens: Number(row.totalOutputTokens ?? 0),
        totalCachedTokens: Number(row.totalCachedTokens ?? 0),
        estCost: Number(row.estCost ?? 0)
    }));
}

export function deleteLogsByModelDB(model: string): void {
    const query = db.prepare("DELETE FROM request_logs WHERE model = ?");
    query.run(model);
}

export function deleteLogsByProviderDB(providerId: string): void {
    const query = db.prepare("DELETE FROM request_logs WHERE provider_id = ?");
    query.run(providerId);
}
