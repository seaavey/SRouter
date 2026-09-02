import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
    Activity,
    ArrowUpRight,
    ChevronDown,
    ChevronsDownUp,
    ChevronsUpDown,
    Clock,
    Gauge,
    Plus,
    RefreshCw,
    Shield,
    Zap
} from "lucide-react";
import { toast } from "sonner";
import { QuotaSkeleton } from "@/components/skeletons";
import { Button, buttonVariants } from "@/components/ui/button";
import { ProviderIcon } from "@/components/providers";
import { cn } from "@/lib/utils";
import { useQuota } from "@/hooks/useQuota";
import type { LiveModelQuotaItem, ProviderUsageMetric } from "@srouter/types";

export const Route = createFileRoute("/quota")({
    staticData: { title: "Quotas & Limits" },
    component: QuotaPage
});

function formatResetTime(isoStr?: string): string {
    if (!isoStr) return "";
    try {
        const d = new Date(isoStr);
        if (isNaN(d.getTime())) return isoStr;
        const timeStr = d.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit"
        });
        const dateStr = d.toLocaleDateString([], {
            month: "short",
            day: "numeric"
        });
        return `${timeStr} (${dateStr})`;
    } catch {
        return isoStr;
    }
}

function formatLastUsed(dateStr?: string | null): string {
    if (!dateStr) return "—";
    try {
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return dateStr;
        return `${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} (${d.toLocaleDateString([], { month: "short", day: "numeric" })})`;
    } catch {
        return dateStr;
    }
}

function QuotaProgressBar({ quota }: { quota: LiveModelQuotaItem }) {
    const isExhausted = quota.status === "exhausted";
    const isWarning = quota.status === "warning";

    return (
        <div className="rounded-[8px] border border-[var(--line)] bg-[var(--field)]/30 p-3 space-y-2">
            <div className="flex items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2 min-w-0">
                    <span className="font-bold text-[var(--ink)] truncate" title={quota.name}>
                        {quota.name}
                    </span>
                    <span
                        className={`inline-flex items-center gap-1 rounded-[4px] px-1.5 py-0.2 text-[9.5px] font-semibold uppercase ${
                            isExhausted
                                ? "bg-rose-500/10 text-rose-500 border border-rose-500/30"
                                : isWarning
                                  ? "bg-amber-500/10 text-amber-500 border border-amber-500/30"
                                  : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30"
                        }`}
                    >
                        {quota.status}
                    </span>
                </div>
                <div className="flex items-center gap-1.5 text-[11px] tabular-nums text-[var(--ink-2)] shrink-0">
                    <span>
                        {quota.used.toLocaleString()} / {quota.limit.toLocaleString()}
                    </span>
                    <span className="font-semibold text-[var(--ink)]">({quota.percentage})</span>
                </div>
            </div>

            {/* Progress Track */}
            <div className="h-1.5 w-full rounded-full bg-[var(--line)] overflow-hidden">
                <div
                    className={`h-full rounded-full transition-all duration-300 ${
                        isExhausted ? "bg-rose-500" : isWarning ? "bg-amber-500" : "bg-emerald-500"
                    }`}
                    style={{ width: `${Math.min(100, quota.percentageValue)}%` }}
                />
            </div>

            {/* Reset Countdown if available */}
            {quota.resetIn && (
                <div className="flex items-center justify-between text-[10.5px] text-[var(--ink-3)]">
                    <span className="flex items-center gap-1">
                        <Clock className="size-3" />
                        <span>Resets in {quota.resetIn}</span>
                    </span>
                    {quota.resetTime && (
                        <span title={quota.resetTime}>{formatResetTime(quota.resetTime)}</span>
                    )}
                </div>
            )}
        </div>
    );
}

function UsageMetricsTable({ metrics }: { metrics: ProviderUsageMetric[] }) {
    if (metrics.length === 0) return null;

    return (
        <div className="overflow-x-auto rounded-[8px] border border-[var(--line)]">
            <table className="w-full text-left text-xs border-collapse font-mono">
                <thead>
                    <tr className="border-b border-[var(--line)] bg-[var(--field)]/50 text-[10px] uppercase font-bold text-[var(--ink-3)]">
                        <th className="py-2 px-3">Model</th>
                        <th className="py-2 px-3 text-right">Requests</th>
                        <th className="py-2 px-3 text-right">Prompt Tokens</th>
                        <th className="py-2 px-3 text-right">Completion</th>
                        <th className="py-2 px-3 text-right">Total Tokens</th>
                        <th className="py-2 px-3 text-right hidden sm:table-cell">Last Used</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-[var(--line)]">
                    {metrics.map((m) => (
                        <tr key={m.model} className="hover:bg-[var(--hover)]/30 transition-colors">
                            <td className="py-2 px-3 font-semibold text-[var(--ink)] truncate max-w-xs">
                                {m.model}
                            </td>
                            <td className="py-2 px-3 text-right tabular-nums text-[var(--ink)]">
                                {m.totalRequests.toLocaleString()}
                            </td>
                            <td className="py-2 px-3 text-right tabular-nums text-[var(--ink-3)]">
                                {m.promptTokens.toLocaleString()}
                            </td>
                            <td className="py-2 px-3 text-right tabular-nums text-[var(--ink-3)]">
                                {m.completionTokens.toLocaleString()}
                            </td>
                            <td className="py-2 px-3 text-right tabular-nums font-bold text-[var(--ink)]">
                                {m.totalTokens.toLocaleString()}
                            </td>
                            <td className="py-2 px-3 text-right text-[10.5px] text-[var(--ink-3)] hidden sm:table-cell">
                                {formatLastUsed(m.lastUsedAt)}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function QuotaPage() {
    const { data, isLoading, isFetching, error, refetch } = useQuota();
    const [collapsedMap, setCollapsedMap] = useState<Record<string, boolean>>({});
    const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
    const [isManualRefreshing, setIsManualRefreshing] = useState(false);

    const toggleCollapse = (id: string) => {
        setCollapsedMap((prev) => ({
            ...prev,
            [id]: !prev[id]
        }));
    };

    const handleRefresh = async (accountName?: string) => {
        setIsManualRefreshing(true);
        try {
            await refetch();
            setLastUpdated(new Date());
            toast.success(
                accountName ? `Quota refreshed for ${accountName}` : "Quotas & limits updated",
                {
                    description: "Fetched latest live limits from upstream providers."
                }
            );
        } catch {
            toast.error("Failed to refresh quotas");
        } finally {
            setIsManualRefreshing(false);
        }
    };

    if (error || (!data && !isLoading)) {
        return (
            <div className="mx-auto w-full max-w-6xl space-y-4 font-mono">
                <div className="rounded-[12px] border border-rose-500/30 bg-rose-500/10 p-6 text-xs text-rose-500 space-y-2">
                    <p className="font-bold text-sm">Failed to load quota & limits information</p>
                    <p className="text-[var(--ink-3)]">
                        {error instanceof Error ? error.message : "Unknown error"}
                    </p>
                    <Button
                        type="button"
                        onClick={() => void handleRefresh()}
                        className="mt-2 text-xs bg-[var(--ink)] text-[var(--canvas)] cursor-pointer"
                    >
                        Try Again
                    </Button>
                </div>
            </div>
        );
    }

    const allProviders = data?.providers ?? [];
    // Only display provider cards that actually have live quotas or recorded usage metrics
    const activeProviders = allProviders.filter(
        (p) => (p.quotas && p.quotas.length > 0) || (p.usageMetrics && p.usageMetrics.length > 0)
    );

    const isAllCollapsed =
        activeProviders.length > 0 && activeProviders.every((p) => collapsedMap[p.id] === true);

    const toggleAll = () => {
        const nextState = !isAllCollapsed;
        const newMap: Record<string, boolean> = {};
        for (const p of activeProviders) {
            newMap[p.id] = nextState;
        }
        setCollapsedMap(newMap);
    };

    // Aggregate stats
    let totalLiveQuotas = 0;
    let exhaustedQuotas = 0;
    let totalTokensAll = 0;
    let totalRequestsAll = 0;

    for (const p of allProviders) {
        if (p.quotas) {
            totalLiveQuotas += p.quotas.length;
            exhaustedQuotas += p.quotas.filter(
                (q) => q.status === "exhausted" || q.percentageValue <= 5
            ).length;
        }
        if (p.usageMetrics) {
            for (const m of p.usageMetrics) {
                totalTokensAll += m.totalTokens;
                totalRequestsAll += m.totalRequests;
            }
        }
    }

    const isSpinning = isFetching || isManualRefreshing;

    if (isLoading) {
        return <QuotaSkeleton />;
    }

    return (
        <div className="mx-auto w-full max-w-6xl flex flex-col gap-6 font-mono">
            {/* Editorial Header Section */}
            <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end border-b border-border/80 pb-5">
                <div className="min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/80">
                        Capacity & Usage
                    </p>
                    <h1 className="mt-1.5 text-2xl font-bold tracking-tight text-foreground">
                        Quotas & Limits
                    </h1>
                    <p className="mt-1 max-w-2xl text-xs text-muted-foreground leading-relaxed">
                        Upstream provider rate limits, live token quotas, and per-account usage
                        consumption.
                    </p>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                    {/* Last updated timestamp */}
                    <span className="hidden xl:inline-block text-[10.5px] text-muted-foreground mr-1">
                        Updated{" "}
                        {lastUpdated.toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit"
                        })}
                    </span>

                    {activeProviders.length > 0 && (
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={toggleAll}
                            className="h-8 text-xs font-medium cursor-pointer gap-1.5 border-border/80 bg-card hover:bg-secondary/60 transition-colors shadow-2xs"
                            title={
                                isAllCollapsed ? "Expand all providers" : "Collapse all providers"
                            }
                        >
                            {isAllCollapsed ? (
                                <>
                                    <ChevronsUpDown className="size-3.5 text-muted-foreground" />
                                    <span>Expand All</span>
                                </>
                            ) : (
                                <>
                                    <ChevronsDownUp className="size-3.5 text-muted-foreground" />
                                    <span>Collapse All</span>
                                </>
                            )}
                        </Button>
                    )}

                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => void handleRefresh()}
                        disabled={isSpinning}
                        className="h-8 text-xs font-medium cursor-pointer gap-1.5 border-border/80 bg-card hover:bg-secondary/60 transition-colors shadow-2xs"
                        title="Refresh live quota and usage stats"
                    >
                        <RefreshCw
                            className={`size-3.5 ${isSpinning ? "animate-spin text-amber-500" : "text-muted-foreground"}`}
                        />
                        <span>{isSpinning ? "Refreshing…" : "Refresh"}</span>
                    </Button>

                    <Link
                        to="/providers"
                        className={cn(
                            buttonVariants({ size: "sm" }),
                            "h-8 text-xs font-semibold cursor-pointer shadow-xs gap-1.5"
                        )}
                    >
                        <Plus className="size-3.5" />
                        <span>Add Provider</span>
                    </Link>
                </div>
            </header>

            {/* Bento Metrics 4-Card Summary */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {/* 1. Accounts Monitored */}
                <div className="rounded-[10px] border border-[var(--line)] bg-[var(--surface)] p-3.5 flex flex-col justify-between shadow-2xs">
                    <div className="flex items-center justify-between text-[11px] text-[var(--ink-3)]">
                        <span>Connected Accounts</span>
                        <Shield className="size-3.5 text-blue-500" />
                    </div>
                    <div className="mt-2">
                        <div className="text-2xl font-bold tabular-nums text-[var(--ink)]">
                            {allProviders.length}
                        </div>
                        <p className="mt-0.5 text-[10.5px] text-[var(--ink-3)] truncate">
                            {allProviders.length > 0
                                ? "Active provider credentials"
                                : "No accounts stored"}
                        </p>
                    </div>
                </div>

                {/* 2. Live Quota Monitors */}
                <div className="rounded-[10px] border border-[var(--line)] bg-[var(--surface)] p-3.5 flex flex-col justify-between shadow-2xs">
                    <div className="flex items-center justify-between text-[11px] text-[var(--ink-3)]">
                        <span>Live Model Quotas</span>
                        <Gauge className="size-3.5 text-amber-500" />
                    </div>
                    <div className="mt-2">
                        <div className="text-2xl font-bold tabular-nums text-[var(--ink)]">
                            {totalLiveQuotas}
                        </div>
                        <p className="mt-0.5 text-[10.5px] text-[var(--ink-3)] truncate">
                            {exhaustedQuotas > 0 ? (
                                <span className="text-rose-500 font-semibold">
                                    {exhaustedQuotas} quota exhausted
                                </span>
                            ) : (
                                "All quotas within limits"
                            )}
                        </p>
                    </div>
                </div>

                {/* 3. Total Tokens */}
                <div className="rounded-[10px] border border-[var(--line)] bg-[var(--surface)] p-3.5 flex flex-col justify-between shadow-2xs">
                    <div className="flex items-center justify-between text-[11px] text-[var(--ink-3)]">
                        <span>Total Tokens Routed</span>
                        <Zap className="size-3.5 text-emerald-500" />
                    </div>
                    <div className="mt-2">
                        <div className="text-2xl font-bold tabular-nums text-[var(--ink)]">
                            {totalTokensAll.toLocaleString()}
                        </div>
                        <p className="mt-0.5 text-[10.5px] text-[var(--ink-3)] truncate">
                            Combined gateway throughput
                        </p>
                    </div>
                </div>

                {/* 4. Requests Tracked */}
                <div className="rounded-[10px] border border-[var(--line)] bg-[var(--surface)] p-3.5 flex flex-col justify-between shadow-2xs">
                    <div className="flex items-center justify-between text-[11px] text-[var(--ink-3)]">
                        <span>Requests Handled</span>
                        <Activity className="size-3.5 text-purple-500" />
                    </div>
                    <div className="mt-2">
                        <div className="text-2xl font-bold tabular-nums text-[var(--ink)]">
                            {totalRequestsAll.toLocaleString()}
                        </div>
                        <p className="mt-0.5 text-[10.5px] text-[var(--ink-3)] truncate">
                            Tracked request executions
                        </p>
                    </div>
                </div>
            </div>

            {/* Provider Accounts Quota List */}
            {activeProviders.length === 0 ? (
                <div className="rounded-[12px] border border-dashed border-[var(--line)] p-12 text-center space-y-3">
                    <div className="flex size-10 items-center justify-center rounded-full bg-[var(--field)] mx-auto text-[var(--ink-3)]">
                        <Gauge className="size-5" />
                    </div>
                    <p className="text-sm font-semibold text-[var(--ink)]">
                        No Active Quotas or Usage Data Yet
                    </p>
                    <p className="text-xs text-[var(--ink-3)] max-w-md mx-auto leading-relaxed">
                        Live quota progress and per-model consumption will appear here as soon as
                        upstream sessions are synced or gateway requests are processed.
                    </p>
                    <Link
                        to="/providers"
                        className="inline-flex items-center gap-1.5 rounded-[6px] bg-[var(--ink)] text-[var(--canvas)] px-3.5 py-1.5 text-xs font-semibold hover:opacity-90 transition-transform active:scale-[0.98] shadow-xs cursor-pointer"
                    >
                        <Plus className="size-3.5" />
                        <span>Go to Providers Catalog</span>
                    </Link>
                </div>
            ) : (
                <div className="space-y-4">
                    {activeProviders.map((account) => {
                        const isCollapsed = collapsedMap[account.id] === true;
                        const hasLiveQuotas = account.quotas && account.quotas.length > 0;
                        const hasMetrics = account.usageMetrics && account.usageMetrics.length > 0;

                        return (
                            <div
                                key={account.id}
                                className="rounded-[12px] border border-[var(--line)] bg-[var(--surface)] p-5 space-y-4 shadow-2xs transition-all"
                            >
                                {/* Collapsible Account Header */}
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[var(--line)] pb-3">
                                    <div
                                        onClick={() => toggleCollapse(account.id)}
                                        className="flex items-center gap-3 cursor-pointer group flex-1 select-none"
                                    >
                                        <div className="flex size-9 shrink-0 items-center justify-center rounded-[8px] border border-[var(--line)] bg-[var(--field)] p-1.5 shadow-2xs group-hover:border-[var(--line-strong)] transition-colors">
                                            <ProviderIcon
                                                providerId={account.provider}
                                                className="size-5"
                                            />
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <h3 className="text-sm font-bold text-[var(--ink)] group-hover:text-amber-500 transition-colors">
                                                    {account.account}
                                                </h3>
                                                <span
                                                    className={`inline-flex items-center gap-1 rounded-[4px] px-1.5 py-0.2 text-[9.5px] font-semibold ${
                                                        account.enabled
                                                            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30"
                                                            : "bg-[var(--field)] text-[var(--ink-3)]"
                                                    }`}
                                                >
                                                    <span
                                                        className={`size-1 rounded-full ${
                                                            account.enabled
                                                                ? "bg-emerald-500"
                                                                : "bg-[var(--ink-3)]"
                                                        }`}
                                                    />
                                                    <span>
                                                        {account.enabled ? "Active" : "Disabled"}
                                                    </span>
                                                </span>

                                                {hasLiveQuotas && (
                                                    <span className="inline-flex items-center rounded-[4px] bg-[var(--field)] border border-[var(--line)] px-1.5 py-0.2 text-[9.5px] font-semibold text-[var(--ink-2)]">
                                                        {account.quotas!.length} quotas
                                                    </span>
                                                )}
                                            </div>
                                            <p className="text-[11px] text-[var(--ink-3)] mt-0.5">
                                                Provider:{" "}
                                                <span className="text-[var(--ink-2)] capitalize">
                                                    {account.provider}
                                                </span>{" "}
                                                · ID:{" "}
                                                <span className="text-[var(--ink-2)]">
                                                    {account.id}
                                                </span>
                                            </p>
                                        </div>

                                        <button
                                            type="button"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                toggleCollapse(account.id);
                                            }}
                                            className="flex size-7 items-center justify-center rounded-[4px] border border-[var(--line)] bg-[var(--field)] text-[var(--ink-3)] group-hover:text-[var(--ink)] transition-colors cursor-pointer shrink-0"
                                            title={isCollapsed ? "Expand card" : "Collapse card"}
                                        >
                                            <ChevronDown
                                                className={`size-4 transition-transform duration-200 ${
                                                    isCollapsed ? "-rotate-90" : "rotate-0"
                                                }`}
                                            />
                                        </button>
                                    </div>

                                    <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
                                        <button
                                            type="button"
                                            onClick={() => void handleRefresh(account.account)}
                                            disabled={isSpinning}
                                            className="inline-flex items-center gap-1 rounded-[4px] border border-[var(--line)] bg-[var(--field)] hover:bg-[var(--hover)] px-2 py-1 text-[11px] text-[var(--ink-2)] hover:text-[var(--ink)] transition-colors cursor-pointer disabled:opacity-50"
                                            title="Refresh this provider"
                                        >
                                            <RefreshCw
                                                className={`size-3 ${isSpinning ? "animate-spin" : ""}`}
                                            />
                                            <span>Sync</span>
                                        </button>

                                        <Link
                                            to="/providers/$providerId"
                                            params={{ providerId: account.provider }}
                                            className="inline-flex items-center gap-1 text-xs text-amber-500 hover:text-amber-400 transition-colors"
                                        >
                                            <span>Manage</span>
                                            <ArrowUpRight className="size-3.5" />
                                        </Link>
                                    </div>
                                </div>

                                {/* Collapsible Body */}
                                {!isCollapsed && (
                                    <div className="space-y-4 pt-1 animate-in fade-in-50 duration-150">
                                        {/* Live Model Quotas Section */}
                                        {hasLiveQuotas && (
                                            <div className="space-y-2.5">
                                                <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--ink-3)]">
                                                    Live Upstream Quotas ({account.quotas!.length})
                                                </div>
                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                                    {account.quotas!.map((quota) => (
                                                        <QuotaProgressBar
                                                            key={quota.name}
                                                            quota={quota}
                                                        />
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {/* Usage Metrics Section */}
                                        {hasMetrics && (
                                            <div className="space-y-2.5">
                                                <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--ink-3)]">
                                                    Usage Consumption History
                                                </div>
                                                <UsageMetricsTable
                                                    metrics={account.usageMetrics!}
                                                />
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
