import { useState, useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
    Activity,
    Coins,
    Cpu,
    KeyRound,
    RefreshCw,
    Search,
    ShieldAlert,
    ShieldCheck
} from "lucide-react";
import { api } from "@/lib/api";
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

    const { data, isLoading, error, refetch, isFetching } = useQuery({
        queryKey: ["logs"],
        queryFn: () => api.get<ListResponse<RequestLogEntry>>("/v1/logs?limit=100"),
        refetchInterval: 10000
    });

    const { data: globalStats, refetch: refetchStats } = useQuery<UsageStats>({
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
                totalCost: globalStats.totalEstimatedCost,
                cachedTokens: globalStats.totalCachedTokens,
                successRate,
                isGlobal: true
            };
        }

        let totalTokens = 0;
        let totalCost = 0;
        let cachedTokens = 0;
        let successCount = 0;

        for (const log of logs) {
            totalTokens += log.totalTokens;
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
            totalCost,
            cachedTokens,
            successRate,
            isGlobal: false
        };
    }, [globalStats, logs]);

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
            {/* Header: Clean Machined Bar */}
            <header className="rounded-2xl border border-border/80 bg-card p-5 sm:p-6 shadow-2xs">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="space-y-1.5">
                        <div className="flex items-center gap-2.5 flex-wrap">
                            <h1 className="text-base font-bold tracking-tight text-foreground">
                                Request Logs
                            </h1>
                            <span
                                className={[
                                    "rounded-md border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-widest",
                                    requireApiKey
                                        ? "border-border/80 bg-secondary/60 text-foreground"
                                        : "border-border/60 bg-secondary/30 text-muted-foreground"
                                ].join(" ")}
                            >
                                {requireApiKey ? "Key Enforced" : "Permissive"}
                            </span>
                        </div>
                        <p className="text-xs text-muted-foreground max-w-2xl leading-relaxed">
                            Recent 100 API gateway requests with token usage, latency, and cost telemetry.
                        </p>
                    </div>

                    <div className="flex items-center gap-2 self-start sm:self-auto shrink-0">
                        <button
                            type="button"
                            onClick={() => {
                                void refetch();
                                void refetchStats();
                            }}
                            disabled={isFetching}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border/70 bg-secondary/40 hover:bg-secondary text-xs font-semibold text-muted-foreground hover:text-foreground cursor-pointer transition-all shadow-2xs disabled:opacity-50"
                        >
                            <RefreshCw className={`size-3.5 ${isFetching ? "animate-spin" : ""}`} />
                            <span>Refresh</span>
                        </button>
                    </div>
                </div>
            </header>

            {/* Metrics Row: Clean Integrated Grid */}
            <section
                aria-label="Log Summary Metrics"
                className="grid grid-cols-2 rounded-xl border border-border/70 bg-card/60 divide-y sm:divide-y-0 sm:divide-x sm:grid-cols-4 divide-border/60 shadow-2xs"
            >
                <div className="p-4">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Total Requests
                    </span>
                    <div className="mt-1.5 text-xl font-bold tracking-tight text-foreground tabular-nums">
                        {stats.totalRequests}
                    </div>
                    <span className="text-[11px] text-muted-foreground">
                        {stats.successRate.toFixed(1)}% success
                    </span>
                </div>

                <div className="p-4">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Tokens
                    </span>
                    <div className="mt-1.5 text-xl font-bold tracking-tight text-foreground tabular-nums">
                        {stats.totalTokens.toLocaleString()}
                    </div>
                    <span className="text-[11px] text-muted-foreground">
                        {stats.cachedTokens.toLocaleString()} cached
                    </span>
                </div>

                <div className="p-4">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Est. Cost
                    </span>
                    <div className="mt-1.5 text-xl font-bold tracking-tight text-foreground tabular-nums">
                        ${stats.totalCost.toFixed(4)}
                    </div>
                    <span className="text-[11px] text-muted-foreground">
                        {stats.isGlobal ? "All-time total" : "Past 100 calls"}
                    </span>
                </div>

                <div className="p-4">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Access Mode
                    </span>
                    <div className="mt-1.5 text-xs font-semibold text-foreground truncate">
                        {requireApiKey ? "Key Required" : "Open Gateway"}
                    </div>
                    <span className="text-[11px] text-muted-foreground truncate block">
                        {requireApiKey ? `${keys.length} keys active` : "Bypass enabled"}
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
