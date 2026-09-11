import type {
    AnalyticsWindow,
    ModelUsageSummaryRow,
    RequestLogEntry,
    UsageByModelRow,
    UsageSummary
} from "@srouter/types";
import { db, isPostgres } from "./db.js";
import { generateId, num, optStr, str } from "./row-utils.js";

interface RequestLogRow {
    id: string;
    api_key_id: string | null;
    ip_address: string | null;
    user_agent: string | null;
    provider_id: string;
    model: string;
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    status_code: number;
    latency_ms: number;
    cached_tokens: number;
    cache_creation_tokens: number;
    reasoning_tokens: number;
    estimated_cost: number;
    fallback_occurred: number;
    fallback_path: string | null;
    fallback_reason: string | null;
    resolved_model: string | null;
    created_at: number;
}

interface UsageSummaryRow {
    totalRequests: number;
    totalSuccessRequests?: number;
    totalTokens: number;
    totalPromptTokens: number;
    totalCompletionTokens: number;
    totalCachedTokens: number;
    totalCacheCreationTokens: number;
    totalReasoningTokens: number;
    totalEstimatedCost: number;
}

interface ModelUsageDBShape {
    model: string;
    totalRequests: number;
    totalTokens: number;
    promptTokens: number;
    completionTokens: number;
    cachedTokens: number;
    estimatedCost: number;
    lastUsedAt: number | null;
}

interface UsageByModelDBShape {
    model: string;
    totalRequests: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCachedTokens: number;
    estCost: number;
}

export async function logRequestDB(
    entry: Omit<RequestLogEntry, "id" | "createdAt">
): Promise<RequestLogEntry> {
    const Id = generateId("log");
    const CreatedAt = Date.now();

    await db
        .prepare(
            `
        INSERT INTO request_logs (id, api_key_id, ip_address, user_agent, provider_id, model, prompt_tokens, completion_tokens, total_tokens, status_code, latency_ms, cached_tokens, cache_creation_tokens, reasoning_tokens, estimated_cost, fallback_occurred, fallback_path, fallback_reason, resolved_model, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
        )
        .run(
            Id,
            entry.apiKeyId ?? null,
            entry.ipAddress ?? null,
            entry.userAgent ?? null,
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

export async function getRecentLogsDB(limit = 50): Promise<RequestLogEntry[]> {
    const Rows = (await db
        .prepare("SELECT * FROM request_logs ORDER BY created_at DESC LIMIT ?")
        .all(limit)) as unknown as RequestLogRow[];
    return Rows.map(mapLogRow);
}

export async function getPaginatedLogsDB(
    page: number = 1,
    limit: number = 50,
    status?: "all" | "success" | "error"
): Promise<{
    data: RequestLogEntry[];
    pagination: { page: number; limit: number; total: number; total_pages: number };
}> {
    const safePage = Math.max(1, page);
    const safeLimit = Math.min(500, Math.max(1, limit));
    const offset = (safePage - 1) * safeLimit;

    let whereClause = "";
    const params: unknown[] = [];

    if (status === "success") {
        whereClause = "WHERE status_code >= 200 AND status_code < 300";
    } else if (status === "error") {
        whereClause = "WHERE status_code < 200 OR status_code >= 300";
    }

    const [rows, countRow] = await Promise.all([
        db
            .prepare(
                `SELECT * FROM request_logs ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`
            )
            .all(...params, safeLimit, offset) as unknown as Promise<RequestLogRow[]>,
        db
            .prepare(`SELECT COUNT(*) as count FROM request_logs ${whereClause}`)
            .get(...params) as unknown as Promise<{ count: number } | undefined>
    ]);

    const total = num(countRow?.count);
    const total_pages = Math.ceil(total / safeLimit);

    return {
        data: rows.map(mapLogRow),
        pagination: {
            page: safePage,
            limit: safeLimit,
            total,
            total_pages
        }
    };
}

export async function getUsageSummaryDB(): Promise<UsageSummary> {
    const Result = (await db
        .prepare(
            `
        SELECT
            COUNT(*) as "totalRequests",
            COALESCE(SUM(CASE WHEN status_code >= 200 AND status_code < 300 THEN 1 ELSE 0 END), 0) as "totalSuccessRequests",
            COALESCE(SUM(total_tokens), 0) as "totalTokens",
            COALESCE(SUM(prompt_tokens), 0) as "totalPromptTokens",
            COALESCE(SUM(completion_tokens), 0) as "totalCompletionTokens",
            COALESCE(SUM(cached_tokens), 0) as "totalCachedTokens",
            COALESCE(SUM(cache_creation_tokens), 0) as "totalCacheCreationTokens",
            COALESCE(SUM(reasoning_tokens), 0) as "totalReasoningTokens",
            COALESCE(SUM(estimated_cost), 0) as "totalEstimatedCost"
        FROM request_logs
    `
        )
        .get()) as unknown as UsageSummaryRow | undefined;

    return {
        totalRequests: num(Result?.totalRequests),
        totalSuccessRequests: num(Result?.totalSuccessRequests),
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

export async function getProviderUsageSummaryDB(providerId: string): Promise<UsageSummary> {
    const Result = (await db
        .prepare(
            `
        SELECT 
            COUNT(*) as "totalRequests",
            COALESCE(SUM(total_tokens), 0) as "totalTokens",
            COALESCE(SUM(prompt_tokens), 0) as "totalPromptTokens",
            COALESCE(SUM(completion_tokens), 0) as "totalCompletionTokens",
            COALESCE(SUM(cached_tokens), 0) as "totalCachedTokens",
            COALESCE(SUM(cache_creation_tokens), 0) as "totalCacheCreationTokens",
            COALESCE(SUM(reasoning_tokens), 0) as "totalReasoningTokens",
            COALESCE(SUM(estimated_cost), 0) as "totalEstimatedCost"
        FROM request_logs
        WHERE provider_id = ?
    `
        )
        .get(providerId)) as unknown as UsageSummaryRow | undefined;

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

export async function getProviderModelUsageDB(providerId: string): Promise<ModelUsageSummaryRow[]> {
    const Rows = (await db
        .prepare(
            `
        SELECT 
            model,
            COUNT(*) as "totalRequests",
            COALESCE(SUM(total_tokens), 0) as "totalTokens",
            COALESCE(SUM(prompt_tokens), 0) as "promptTokens",
            COALESCE(SUM(completion_tokens), 0) as "completionTokens",
            COALESCE(SUM(cached_tokens), 0) as "cachedTokens",
            COALESCE(SUM(estimated_cost), 0) as "estimatedCost",
            MAX(created_at) as "lastUsedAt"
        FROM request_logs
        WHERE provider_id = ?
        GROUP BY model
        ORDER BY "lastUsedAt" DESC
    `
        )
        .all(providerId)) as unknown as ModelUsageDBShape[];

    return Rows.map((row) => ({
        model: row.model,
        totalRequests: row.totalRequests,
        totalTokens: row.totalTokens,
        promptTokens: row.promptTokens,
        completionTokens: row.completionTokens,
        cachedTokens: row.cachedTokens,
        estimatedCost: row.estimatedCost,
        lastUsedAt: row.lastUsedAt
    }));
}

export async function getUsageByModelDB(): Promise<UsageByModelRow[]> {
    const Rows = (await db
        .prepare(
            `
        SELECT 
            model,
            COUNT(*) as "totalRequests",
            COALESCE(SUM(prompt_tokens), 0) as "totalInputTokens",
            COALESCE(SUM(completion_tokens), 0) as "totalOutputTokens",
            COALESCE(SUM(cached_tokens), 0) as "totalCachedTokens",
            COALESCE(SUM(estimated_cost), 0) as "estCost"
        FROM request_logs
        GROUP BY model
        ORDER BY "totalRequests" DESC
    `
        )
        .all()) as unknown as UsageByModelDBShape[];

    return Rows.map((row) => ({
        model: row.model,
        totalRequests: num(row.totalRequests),
        totalInputTokens: num(row.totalInputTokens),
        totalOutputTokens: num(row.totalOutputTokens),
        totalCachedTokens: num(row.totalCachedTokens),
        estCost: num(row.estCost)
    }));
}

export async function deleteLogsByModelDB(model: string): Promise<void> {
    await db.prepare("DELETE FROM request_logs WHERE model = ?").run(model);
}

export async function deleteLogsByProviderDB(providerId: string): Promise<void> {
    await db.prepare("DELETE FROM request_logs WHERE provider_id = ?").run(providerId);
}

function mapLogRow(row: RequestLogRow): RequestLogEntry {
    return {
        id: str(row.id),
        apiKeyId: optStr(row.api_key_id),
        ipAddress: optStr(row.ip_address),
        userAgent: optStr(row.user_agent),
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

// --- Analytics ---

export interface AnalyticsDBResult {
    buckets: AnalyticsBucketRow[];
    topModels: AnalyticsTopModelRow[];
    topAgents: AnalyticsTopAgentRow[];
    providers: AnalyticsProviderRow[];
    p95LatencyMs: number;
    rps: number;
}

interface AnalyticsTopAgentRow {
    userAgent: string;
    totalRequests: number;
    totalTokens: number;
}

interface AnalyticsBucketRow {
    bucket: number;
    totalRequests: number;
    successRequests: number;
    errorRequests: number;
    avgLatencyMs: number;
    totalTokens: number;
    promptTokens: number;
    completionTokens: number;
    cachedTokens: number;
}

interface AnalyticsTopModelRow {
    model: string;
    totalRequests: number;
    totalTokens: number;
    estCost: number;
}

interface AnalyticsProviderRow {
    providerId: string;
    totalRequests: number;
}

export function getBucketSizeMs(window: AnalyticsWindow): number {
    switch (window) {
        case "1h":
            return 60_000;
        case "24h":
            return 3_600_000;
        case "7d":
            return 21_600_000;
        case "30d":
            return 86_400_000;
    }
}

export function getBucketCount(window: AnalyticsWindow): number {
    switch (window) {
        case "1h":
            return 60;
        case "24h":
            return 24;
        case "7d":
            return 28;
        case "30d":
            return 30;
    }
}

export async function getAnalyticsDB(window: AnalyticsWindow): Promise<AnalyticsDBResult> {
    const Now = Date.now();
    const BucketSizeMs = getBucketSizeMs(window);
    const Since = Now - BucketSizeMs * getBucketCount(window);

    // Time buckets. SQLite binds numbers as REAL; CAST truncates to bucket start.
    // Postgres uses BIGINT timestamps, so division is integer-safe.
    // Use BIGINT cast for the bucket calculation — the multiplication
    // (bucketIndex * bucketSize) easily exceeds INT (2.1B) for 24h+ windows.
    const BucketsSql = `
        SELECT
            CAST(created_at / ? AS BIGINT) * ? AS "bucket",
            COUNT(*)                                             AS "totalRequests",
            SUM(CASE WHEN status_code >= 200 AND status_code < 300 THEN 1 ELSE 0 END) AS "successRequests",
            SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END)  AS "errorRequests",
            AVG(latency_ms)                                      AS "avgLatencyMs",
            SUM(total_tokens)                                    AS "totalTokens",
            SUM(prompt_tokens)                                   AS "promptTokens",
            SUM(completion_tokens)                               AS "completionTokens",
            SUM(cached_tokens)                                   AS "cachedTokens"
        FROM request_logs
        WHERE created_at >= ?
        GROUP BY "bucket" ORDER BY "bucket" ASC
    `;
    const Buckets = (await db
        .prepare(BucketsSql)
        .all(BucketSizeMs, BucketSizeMs, Since)) as unknown as AnalyticsBucketRow[];

    const ModelsSql = `
        SELECT model, COUNT(*) AS "totalRequests", SUM(total_tokens) AS "totalTokens",
               SUM(estimated_cost) AS "estCost"
        FROM request_logs WHERE created_at >= ?
        GROUP BY model ORDER BY "totalRequests" DESC LIMIT 10
    `;
    const TopModels = (await db.prepare(ModelsSql).all(Since)) as unknown as AnalyticsTopModelRow[];

    const AgentSql = `
        SELECT COALESCE(user_agent, 'Unknown') AS "userAgent", COUNT(*) AS "totalRequests",
               SUM(total_tokens) AS "totalTokens"
        FROM request_logs WHERE created_at >= ?
        GROUP BY "userAgent" ORDER BY "totalRequests" DESC LIMIT 10
    `;
    const TopAgents = (await db.prepare(AgentSql).all(Since)) as unknown as AnalyticsTopAgentRow[];

    const ProviderSql = `
        SELECT provider_id AS "providerId", COUNT(*) AS "totalRequests"
        FROM request_logs WHERE created_at >= ?
        GROUP BY "providerId" ORDER BY "totalRequests" DESC
    `;
    const Providers = (await db
        .prepare(ProviderSql)
        .all(Since)) as unknown as AnalyticsProviderRow[];

    // p95 latency. COUNT(*) is BIGINT; scale to INT only when the result
    // is guaranteed small (we cap at the table size). Use BIGINT to be safe.
    const P95Sql = `SELECT latency_ms FROM request_logs
           WHERE created_at >= ?
           ORDER BY latency_ms
           LIMIT 1 OFFSET (SELECT CAST(COUNT(*) * 0.95 AS BIGINT) - 1 FROM request_logs WHERE created_at >= ?)`;
    const P95Row = (await db.prepare(P95Sql).get(Since, Since)) as
        { latency_ms: number } | undefined;
    const P95LatencyMs = P95Row ? num(P95Row.latency_ms) : 0;

    // RPS (last 60s rolling average)
    const RpsSql = `SELECT COUNT(*) AS count FROM request_logs WHERE created_at >= ?`;
    const RpsRow = (await db.prepare(RpsSql).get(Now - 60_000)) as { count: number } | undefined;
    const Rps = RpsRow ? Math.round((num(RpsRow.count) / 60) * 100) / 100 : 0;

    return {
        buckets: Buckets,
        topModels: TopModels,
        topAgents: TopAgents,
        providers: Providers,
        p95LatencyMs: P95LatencyMs,
        rps: Rps
    };
}
