import { useState, useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
    Activity,
    ArrowDownToLine,
    ArrowUpFromLine,
    Coins,
    Cpu,
    Database,
    KeyRound,
    RefreshCw,
    Search,
    ShieldAlert,
    ShieldCheck
} from "lucide-react";
import { api } from "@/lib/api";
import { formatCompactNumber } from "@/lib/utils";
import type { APIKeyZod, RequestLogEntry, UsageStats } from "@srouter/types";
import type { ListResponse } from "@/lib/types";
import { LogsSkeleton } from "@/components/skeletons";
import { useLogs } from "@/hooks/useLogs";
import { LogDetailModal, LogTable } from "@/components/logs";
import { Empty, EmptyTitle } from "@/components/ui/empty";

interface ServerSettingsResponse {
    require_api_key?: boolean;
    requireApiKey?: boolean;
}

export const Route = createFileRoute("/logs")({
    staticData: { title: "Logs" },
    component: LogsPage
});

function LogsPage() {
    const [selectedLog, setSelectedLog] = useState<RequestLogEntry | null>(null);

    // Fetch server settings to determine whether require_api_key is active
    const { data: serverSettings } = useQuery<ServerSettingsResponse>({
        queryKey: ["server_settings"],
        queryFn: () => api.get<ServerSettingsResponse>("/v1/settings")
    });

    const requireApiKey = Boolean(
        serverSettings?.require_api_key ?? serverSettings?.requireApiKey
    );

    // Fetch API Keys list if requireApiKey is enabled to enrich filters
    const { data: keysData } = useQuery<{ data: APIKeyZod[] }>({
        queryKey: ["api_keys_list"],
        queryFn: () => api.get<{ data: APIKeyZod[] }>("/v1/keys"),
        enabled: requireApiKey
    });

    const keys = keysData?.data ?? [];

    const { data, isLoading, error, refetch } = useQuery({
        queryKey: ["logs"],
        queryFn: () => api.get<ListResponse<RequestLogEntry>>("/v1/logs?limit=100"),
        refetchInterval: 10000
    });

    const { data: globalStats } = useQuery<UsageStats>({
        queryKey: ["stats"],
        queryFn: () => api.get<UsageStats>("/v1/logs/stats"),
        refetchInterval: 10000
    });

    const logs: RequestLogEntry[] = data?.data ?? [];
    const filter = useLogs(logs);

    // Calculate aggregated metrics from all-time stats, with fallback to loaded logs
    const stats = useMemo(() => {
        if (globalStats) {
            const totalRequests = globalStats.totalRequests;
            const successRequests = globalStats.totalSuccessRequests ?? totalRequests;
            const successRate = totalRequests > 0 ? (successRequests / totalRequests) * 100 : 100;
            return {
                totalRequests,
                totalTokens: globalStats.totalTokens,
                totalInputTokens: globalStats.totalInputTokens,
                totalOutputTokens: globalStats.totalOutputTokens,
                totalCost: globalStats.totalEstimatedCost,
                cachedTokens: globalStats.totalCachedTokens,
                successRate,
                isGlobal: true
            };
        }

        let totalTokens = 0;
        let totalInputTokens = 0;
        let totalOutputTokens = 0;
        let totalCost = 0;
        let cachedTokens = 0;
        let successCount = 0;

        for (const log of logs) {
            totalTokens += log.totalTokens;
            totalInputTokens += log.promptTokens;
            totalOutputTokens += log.completionTokens;
            totalCost += log.costBreakdown?.totalCost ?? log.estimatedCost ?? 0;
            cachedTokens += log.cachedTokens ?? 0;
            if (log.statusCode >= 200 && log.statusCode < 300) {
                successCount++;
            }
        }

        const successRate = logs.length > 0 ? (successCount / logs.length) * 100 : 100;

        return {
            totalRequests: logs.length,
            totalTokens,
            totalInputTokens,
            totalOutputTokens,
            totalCost,
            cachedTokens,
            successRate,
            isGlobal: false
        };
    }, [globalStats, logs]);

    const uncachedInputTokens = Math.max(0, stats.totalInputTokens - stats.cachedTokens);

    if (isLoading) {
        return <LogsSkeleton />;
    }

    if (error || !data) {
        return (
            <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-5 text-xs text-destructive font-mono space-y-2">
                <div className="font-bold flex items-center gap-2">
                    <ShieldAlert className="size-4" />
                    Failed to load request audit stream
                </div>
                <div>{error instanceof Error ? error.message : "Unknown gateway connection error"}</div>
                <button
                    type="button"
                    onClick={() => void refetch()}
                    className="mt-2 inline-flex items-center gap-1.5 px-3 py-1 rounded bg-destructive text-destructive-foreground font-semibold hover:opacity-90 cursor-pointer"
                >
                    <RefreshCw className="size-3" /> Retry
                </button>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-6 font-mono">
            {/* Metrics Row */}
            <section
                aria-label="Log Summary Metrics"
                className="grid grid-cols-1 overflow-hidden rounded-xl border border-border bg-card/70 shadow-2xs sm:grid-cols-2 lg:grid-cols-3 sm:divide-x sm:divide-y-0 divide-border/60"
            >
                <div className="min-w-0 border-b border-border/60 p-4 last:border-b-0 sm:border-b-0 lg:p-5">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                        Total Requests
                    </span>
                    <div
                        className="mt-2 text-2xl font-bold tracking-tight text-foreground tabular-nums lg:text-[1.7rem]"
                        title={stats.totalRequests.toLocaleString("en-US")}
                    >
                        {formatCompactNumber(stats.totalRequests)}
                    </div>
                    <span className="mt-1 block text-[11px] text-muted-foreground">
                        {stats.successRate.toFixed(1)}% success
                    </span>
                </div>

                <div className="min-w-0 border-b border-border/60 p-4 last:border-b-0 sm:border-b-0 lg:p-5">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                        Tokens
                    </span>
                    <div
                        className="mt-2 text-2xl font-bold tracking-tight text-foreground tabular-nums lg:text-[1.7rem]"
                        title={stats.totalTokens.toLocaleString("en-US")}
                    >
                        {formatCompactNumber(stats.totalTokens)}
                    </div>
                    <span className="mt-1.5 flex min-w-0 items-center gap-2 whitespace-nowrap text-[11px] text-muted-foreground" title={`${uncachedInputTokens.toLocaleString("en-US")} input · ${stats.totalOutputTokens.toLocaleString("en-US")} output · ${stats.cachedTokens.toLocaleString("en-US")} cached`}>
                        <span className="inline-flex shrink-0 items-center gap-1">
                            <ArrowDownToLine className="size-3" aria-hidden="true" />
                            {formatCompactNumber(uncachedInputTokens)}
                        </span>
                        <span className="text-border">·</span>
                        <span className="inline-flex shrink-0 items-center gap-1">
                            <ArrowUpFromLine className="size-3" aria-hidden="true" />
                            {formatCompactNumber(stats.totalOutputTokens)}
                        </span>
                        <span className="text-border">·</span>
                        <span className="inline-flex shrink-0 items-center gap-1">
                            <Database className="size-3" aria-hidden="true" />
                            {formatCompactNumber(stats.cachedTokens)}
                        </span>
                    </span>
                </div>

                <div className="min-w-0 border-b border-border/60 p-4 last:border-b-0 sm:border-b-0 lg:p-5">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                        Est. Cost
                    </span>
                    <div className="mt-2 text-2xl font-bold tracking-tight text-foreground tabular-nums lg:text-[1.7rem]">
                        ${stats.totalCost.toFixed(4)}
                    </div>
                    <span className="mt-1 block text-[11px] text-muted-foreground">
                        {stats.isGlobal ? "All-time total" : "Past 100 calls"}
                    </span>
                </div>

            </section>

            {/* Filter Toolbar: Unified & Quiet */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                <div className="flex flex-1 items-center gap-2 max-w-lg">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-2.5 size-3.5 text-muted-foreground" />
                        <input
                            type="text"
                            placeholder={requireApiKey ? "Search model, IP, key, or provider…" : "Search model, IP, or provider…"}
                            value={filter.searchQuery}
                            onChange={(e) => filter.setSearchQuery(e.target.value)}
                            className="w-full rounded-lg border border-border/70 bg-card/50 pl-8.5 pr-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring"
                        />
                    </div>

                    {requireApiKey && keys.length > 0 && (
                        <select
                            value={filter.apiKeyFilter}
                            onChange={(e) => filter.setApiKeyFilter(e.target.value)}
                            className="rounded-lg border border-border/70 bg-card/50 px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground focus:outline-none cursor-pointer"
                        >
                            <option value="all">All Keys</option>
                            <option value="none">No Key (Bypass)</option>
                            {keys.map((k) => (
                                <option key={k.id} value={k.id}>
                                    {k.name}
                                </option>
                            ))}
                        </select>
                    )}
                </div>

                <div className="inline-flex items-center gap-1 rounded-lg border border-border/70 bg-secondary/30 p-0.5 self-start sm:self-auto">
                    <button
                        type="button"
                        onClick={() => filter.setStatusFilter("all")}
                        className={`rounded px-2.5 py-1 text-xs font-medium transition-all cursor-pointer ${
                            filter.statusFilter === "all"
                                ? "bg-foreground text-background font-semibold"
                                : "text-muted-foreground hover:text-foreground"
                        }`}
                    >
                        All ({logs.length})
                    </button>
                    <button
                        type="button"
                        onClick={() => filter.setStatusFilter("success")}
                        className={`rounded px-2.5 py-1 text-xs font-medium transition-all cursor-pointer ${
                            filter.statusFilter === "success"
                                ? "bg-foreground text-background font-semibold"
                                : "text-muted-foreground hover:text-foreground"
                        }`}
                    >
                        2xx
                    </button>
                    <button
                        type="button"
                        onClick={() => filter.setStatusFilter("error")}
                        className={`rounded px-2.5 py-1 text-xs font-medium transition-all cursor-pointer ${
                            filter.statusFilter === "error"
                                ? "bg-foreground text-background font-semibold"
                                : "text-muted-foreground hover:text-foreground"
                        }`}
                    >
                        Errors
                    </button>
                </div>
            </div>

            {filter.filteredLogs.length === 0 ? (
                <Empty className="p-12 border border-dashed border-border/70 rounded-xl">
                    <EmptyTitle className="text-xs text-muted-foreground">
                        No matching audit logs for current filters.
                    </EmptyTitle>
                </Empty>
            ) : (
                <LogTable
                    logs={filter.filteredLogs}
                    requireApiKey={requireApiKey}
                    onSelect={setSelectedLog}
                />
            )}

            <LogDetailModal
                log={selectedLog}
                requireApiKey={requireApiKey}
                onClose={() => setSelectedLog(null)}
            />
        </div>
    );
}
