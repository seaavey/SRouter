import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
    ChevronsDownUp,
    ChevronsUpDown,
    Gauge,
    Plus,
    RefreshCw
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { QuotaSkeleton } from "@/components/skeletons";
import { Button, buttonVariants } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from "@/components/ui/empty";
import { cn } from "@/lib/utils";
import { useQuota } from "@/hooks/useQuota";
import { api } from "@/lib/api";
import type { QuotaResponse } from "@srouter/types";
import { QuotaSummaryMetrics, QuotaProviderCard, type QuotaAccountItem } from "@/components/quota";

export const Route = createFileRoute("/quota")({
    staticData: { title: "Quotas & Limits" },
    component: QuotaPage
});

function QuotaPage() {
    const queryClient = useQueryClient();
    const { data, isLoading, isFetching, error } = useQuota();
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
            const freshData = await api.get<QuotaResponse>("/v1/quota?force=true");
            queryClient.setQueryData(["quota", { forceRefresh: false }], freshData);
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
        activeProviders.length > 0 && activeProviders.every((p) => collapsedMap[p.provider.toLowerCase()] === true);

    const toggleAll = () => {
        const nextState = !isAllCollapsed;
        const newMap: Record<string, boolean> = {};
        for (const p of activeProviders) {
            newMap[p.provider.toLowerCase()] = nextState;
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

    const groupedProviders = Object.entries(
        activeProviders.reduce((acc, account) => {
            const groupKey = account.provider.toLowerCase();
            if (!acc[groupKey]) {
                acc[groupKey] = {
                    providerName: account.provider,
                    accounts: [] as QuotaAccountItem[]
                };
            }
            acc[groupKey].accounts.push(account);
            return acc;
        }, {} as Record<string, { providerName: string; accounts: QuotaAccountItem[] }>)
    );

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
            <QuotaSummaryMetrics
                totalAccounts={allProviders.length}
                totalLiveQuotas={totalLiveQuotas}
                exhaustedQuotas={exhaustedQuotas}
                totalTokens={totalTokensAll}
                totalRequests={totalRequestsAll}
            />

            {/* Provider Accounts Quota List */}
            {activeProviders.length === 0 ? (
                <Empty className="p-12">
                    <EmptyHeader>
                        <EmptyMedia variant="icon">
                            <Gauge className="size-5" />
                        </EmptyMedia>
                        <EmptyTitle>No Active Quotas or Usage Data Yet</EmptyTitle>
                        <EmptyDescription>
                            Live quota progress and per-model consumption will appear here as soon as
                            upstream sessions are synced or gateway requests are processed.
                        </EmptyDescription>
                    </EmptyHeader>
                    <EmptyContent>
                        <Link
                            to="/providers"
                            className="inline-flex items-center gap-1.5 rounded-[6px] bg-[var(--ink)] text-[var(--canvas)] px-3.5 py-1.5 text-xs font-semibold hover:opacity-90 transition-transform active:scale-[0.98] shadow-xs cursor-pointer"
                        >
                            <Plus className="size-3.5" />
                            <span>Go to Providers Catalog</span>
                        </Link>
                    </EmptyContent>
                </Empty>
            ) : (
                <div className="space-y-6">
                    {groupedProviders.map(([groupKey, group]) => (
                        <QuotaProviderCard
                            key={groupKey}
                            groupKey={groupKey}
                            providerName={group.providerName}
                            accounts={group.accounts}
                            isCollapsed={collapsedMap[groupKey] === true}
                            isSpinning={isSpinning}
                            onToggleCollapse={toggleCollapse}
                            onRefresh={(name) => void handleRefresh(name)}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}
