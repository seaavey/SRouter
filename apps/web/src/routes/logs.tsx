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
    RefreshCw,
    Search,
    ShieldAlert
} from "lucide-react";
import { api } from "@/lib/api";
import { formatCompactNumber } from "@/lib/utils";
import type { APIKeyZod, RequestLogEntry, UsageStats } from "@srouter/types";
import type { ListResponse } from "@/lib/types";
import { LogsSkeleton } from "@/components/skeletons";
import { useLogs } from "@/hooks/useLogs";
import { LogDetailModal, LogTable } from "@/components/logs";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Button } from "@/components/ui/button";

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

    const requireApiKey = Boolean(serverSettings?.require_api_key ?? serverSettings?.requireApiKey);

    // Fetch API Keys list if requireApiKey is enabled to enrich filters
    const { data: keysData } = useQuery<{ data: APIKeyZod[] }>({
        queryKey: ["api_keys_list"],
        queryFn: () => api.get<{ data: APIKeyZod[] }>("/v1/keys"),
        enabled: requireApiKey
    });

    const keys = keysData?.data ?? [];

    const { data, isLoading, error, refetch, isFetching } = useQuery({
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
            <div className="mx-auto flex w-full max-w-[1360px] flex-col gap-6 font-sans">
                <div className="flex flex-col gap-4 rounded-3xl border border-destructive/20 bg-destructive/5 p-6 font-sans text-destructive">
                    <EmptyHeader className="items-start">
                        <EmptyTitle className="text-base font-semibold text-destructive flex items-center gap-2">
                            <ShieldAlert className="size-5" />
                            Failed to load request audit stream
                        </EmptyTitle>
                        <EmptyDescription className="text-xs text-destructive/80 font-mono">
                            {error instanceof Error
                                ? error.message
                                : "Unknown gateway connection error"}
                        </EmptyDescription>
                    </EmptyHeader>
                    <div>
                        <Button
                            type="button"
                            variant="destructive"
                            onClick={() => void refetch()}
                            className="rounded-full px-5 text-xs font-semibold cursor-pointer shadow-none gap-1.5"
                        >
                            <RefreshCw className="size-3.5" />
                            <span>Retry</span>
                        </Button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="mx-auto flex w-full max-w-[1360px] flex-col gap-8 font-sans pb-16">
            {/* Header */}
            <header className="flex flex-col justify-between gap-4 pb-2 sm:flex-row sm:items-end">
                <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                        <span className="size-2 shrink-0 rounded-full bg-ink" />
                        <p className="font-mono text-xs font-medium uppercase tracking-wider text-text-muted">
                            Traffic Telemetry
                        </p>
                    </div>
                    <h1 className="text-3xl md:text-4xl font-[650] tracking-tight text-ink font-sans">
                        Request Audit.
                    </h1>
                    <p className="mt-1 text-base font-light text-text-muted font-sans">
                        Real-time audit log of routed model completions, token volumes, and
                        execution latency.
                    </p>
                </div>
                <div className="flex items-center gap-2 self-start sm:self-auto">
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() => void refetch()}
                        disabled={isFetching}
                        className="h-10 shrink-0 gap-2 rounded-full border border-hairline-soft bg-canvas px-5 text-sm font-semibold text-ink hover:bg-canvas-soft transition-colors cursor-pointer shadow-none"
                    >
                        <RefreshCw className={`size-4 ${isFetching ? "animate-spin" : ""}`} />
                        <span>Refresh</span>
                    </Button>
                </div>
            </header>

            {/* Metrics Row */}
            <section
                aria-label="Log Summary Metrics"
                className="grid grid-cols-1 sm:grid-cols-3 gap-4 font-sans"
            >
                <article className="flex min-w-0 min-h-[140px] flex-col justify-between rounded-3xl border border-hairline-soft bg-canvas p-6 shadow-none transition-colors hover:border-hairline">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-text-muted font-sans">
                            Total Requests
                        </span>
                        <Activity className="size-4 text-text-muted" />
                    </div>
                    <div className="mt-3">
                        <div
                            className="text-3xl font-bold tracking-tight text-ink font-mono tabular-nums"
                            title={stats.totalRequests.toLocaleString("en-US")}
                        >
                            {formatCompactNumber(stats.totalRequests)}
                        </div>
                    </div>
                    <div className="mt-4 truncate border-t border-hairline-soft pt-3 text-xs text-text-muted font-sans">
                        <span className="font-semibold text-ink font-mono">
                            {stats.successRate.toFixed(1)}%
                        </span>{" "}
                        success rate
                    </div>
                </article>

                <article className="flex min-w-0 min-h-[140px] flex-col justify-between rounded-3xl border border-hairline-soft bg-canvas p-6 shadow-none transition-colors hover:border-hairline">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-text-muted font-sans">
                            Total Tokens
                        </span>
                        <Cpu className="size-4 text-text-muted" />
                    </div>
                    <div className="mt-3">
                        <div
                            className="text-3xl font-bold tracking-tight text-ink font-mono tabular-nums"
                            title={stats.totalTokens.toLocaleString("en-US")}
                        >
                            {formatCompactNumber(stats.totalTokens)}
                        </div>
                    </div>
                    <div
                        className="mt-4 flex min-w-0 items-center gap-2 whitespace-nowrap border-t border-hairline-soft pt-3 text-xs text-text-muted font-mono"
                        title={`${uncachedInputTokens.toLocaleString("en-US")} input · ${stats.totalOutputTokens.toLocaleString("en-US")} output · ${stats.cachedTokens.toLocaleString("en-US")} cached`}
                    >
                        <span className="inline-flex shrink-0 items-center gap-1">
                            <ArrowDownToLine className="size-3" aria-hidden="true" />
                            {formatCompactNumber(uncachedInputTokens)}
                        </span>
                        <span className="text-text-faint">·</span>
                        <span className="inline-flex shrink-0 items-center gap-1">
                            <ArrowUpFromLine className="size-3" aria-hidden="true" />
                            {formatCompactNumber(stats.totalOutputTokens)}
                        </span>
                        <span className="text-text-faint">·</span>
                        <span className="inline-flex shrink-0 items-center gap-1">
                            <Database className="size-3" aria-hidden="true" />
                            {formatCompactNumber(stats.cachedTokens)}
                        </span>
                    </div>
                </article>

                <article className="flex min-w-0 min-h-[140px] flex-col justify-between rounded-3xl border border-hairline-soft bg-canvas p-6 shadow-none transition-colors hover:border-hairline">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-text-muted font-sans">
                            Estimated Cost
                        </span>
                        <Coins className="size-4 text-text-muted" />
                    </div>
                    <div className="mt-3">
                        <div className="text-3xl font-bold tracking-tight text-ink font-mono tabular-nums">
                            ${stats.totalCost.toFixed(4)}
                        </div>
                    </div>
                    <div className="mt-4 truncate border-t border-hairline-soft pt-3 text-xs text-text-muted font-sans">
                        {stats.isGlobal ? "All-time accumulated cost" : "Past 100 executions"}
                    </div>
                </article>
            </section>

            {/* Filter Toolbar: Unified & Quiet */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 font-sans">
                <div className="flex flex-1 items-center gap-2 max-w-lg">
                    <div className="relative flex-1">
                        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-text-muted" />
                        <input
                            type="text"
                            placeholder={
                                requireApiKey
                                    ? "Search model, IP, key, or provider…"
                                    : "Search model, IP, or provider…"
                            }
                            value={filter.searchQuery}
                            onChange={(e) => filter.setSearchQuery(e.target.value)}
                            className="w-full h-10 rounded-full border border-hairline-soft bg-field pl-10 pr-4 text-xs font-mono text-ink placeholder:text-text-muted focus:ring-2 focus:ring-ink focus:outline-none"
                        />
                    </div>

                    {requireApiKey && keys.length > 0 && (
                        <select
                            value={filter.apiKeyFilter}
                            onChange={(e) => filter.setApiKeyFilter(e.target.value)}
                            className="h-10 rounded-full border border-hairline-soft bg-field px-4 text-xs font-sans text-ink focus:ring-2 focus:ring-ink outline-none cursor-pointer"
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

                <div className="inline-flex items-center gap-1 rounded-full border border-hairline-soft bg-canvas-soft p-1 self-start sm:self-auto font-sans">
                    <button
                        type="button"
                        onClick={() => filter.setStatusFilter("all")}
                        className={`rounded-full px-3.5 py-1 text-xs font-medium transition-all cursor-pointer ${
                            filter.statusFilter === "all"
                                ? "bg-canvas text-ink font-semibold border border-hairline-soft shadow-none"
                                : "text-text-muted hover:text-ink"
                        }`}
                    >
                        All ({logs.length})
                    </button>
                    <button
                        type="button"
                        onClick={() => filter.setStatusFilter("success")}
                        className={`rounded-full px-3.5 py-1 text-xs font-medium transition-all cursor-pointer ${
                            filter.statusFilter === "success"
                                ? "bg-canvas text-ink font-semibold border border-hairline-soft shadow-none"
                                : "text-text-muted hover:text-ink"
                        }`}
                    >
                        2xx
                    </button>
                    <button
                        type="button"
                        onClick={() => filter.setStatusFilter("error")}
                        className={`rounded-full px-3.5 py-1 text-xs font-medium transition-all cursor-pointer ${
                            filter.statusFilter === "error"
                                ? "bg-canvas text-ink font-semibold border border-hairline-soft shadow-none"
                                : "text-text-muted hover:text-ink"
                        }`}
                    >
                        Errors
                    </button>
                </div>
            </div>

            {filter.filteredLogs.length === 0 ? (
                <Empty className="min-h-56 rounded-3xl border border-dashed border-hairline bg-canvas p-12">
                    <EmptyHeader>
                        <EmptyTitle className="text-base font-semibold text-ink font-sans">
                            No matching audit logs
                        </EmptyTitle>
                        <EmptyDescription className="text-xs text-text-muted font-sans font-light">
                            No request traces match your current query or filter criteria.
                        </EmptyDescription>
                    </EmptyHeader>
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
