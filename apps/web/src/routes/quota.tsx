import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
    ChevronsDownUp,
    ChevronsUpDown,
    Gauge,
    Plus,
    RefreshCw,
    TriangleAlert
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { QuotaSkeleton } from "@/components/skeletons";
import { Button, buttonVariants } from "@/components/ui/button";
import {
    Empty,
    EmptyContent,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle,
    EmptyDescription
} from "@/components/ui/empty";
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
            <div className="mx-auto flex w-full max-w-[1360px] flex-col font-sans">
                <div className="flex min-h-64 flex-col items-center justify-center rounded-3xl border border-destructive/30 bg-destructive/5 px-6 py-14 text-center">
                    <div className="flex size-11 items-center justify-center rounded-full bg-destructive/10 text-destructive mb-3.5">
                        <TriangleAlert className="size-5" strokeWidth={1.75} />
                    </div>
                    <h2 className="text-base font-bold text-ink">
                        Failed to load quota & limits information
                    </h2>
                    <p className="mt-1.5 max-w-md text-xs text-text-muted leading-relaxed font-mono">
                        {error instanceof Error
                            ? error.message
                            : "The gateway returned an unexpected error."}
                    </p>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => void handleRefresh()}
                        className="mt-5 rounded-full px-5 h-9 text-xs font-semibold cursor-pointer gap-1.5 shadow-none"
                    >
                        <RefreshCw className="size-3.5" />
                        <span>Try Again</span>
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
        activeProviders.length > 0 &&
        activeProviders.every((p) => collapsedMap[p.provider.toLowerCase()] === true);

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
        activeProviders.reduce(
            (acc, account) => {
                const groupKey = account.provider.toLowerCase();
                if (!acc[groupKey]) {
                    acc[groupKey] = {
                        providerName: account.provider,
                        accounts: [] as QuotaAccountItem[]
                    };
                }
                acc[groupKey].accounts.push(account);
                return acc;
            },
            {} as Record<string, { providerName: string; accounts: QuotaAccountItem[] }>
        )
    );

    return (
        <div className="mx-auto flex w-full max-w-[1360px] flex-col gap-8 font-sans">
            {/* Header Section */}
            <header className="flex flex-col justify-between gap-4 pb-2 sm:flex-row sm:items-end">
                <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                        <span className="size-2 shrink-0 rounded-full bg-ink" />
                        <p className="font-mono text-xs font-medium uppercase tracking-wider text-text-muted">
                            Capacity & Usage
                        </p>
                    </div>
                    <h1 className="text-3xl md:text-4xl font-[650] tracking-tight text-ink font-sans">
                        Quotas & Limits.
                    </h1>
                    <p className="mt-1 text-base font-light text-text-muted font-sans">
                        Upstream provider rate limits, live token quotas, and per-account usage
                        consumption.
                    </p>
                </div>

                <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                    <span className="hidden xl:inline-block font-mono text-xs text-text-muted mr-1">
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
                            className="rounded-full px-4 h-9 text-xs font-medium cursor-pointer gap-1.5 shadow-none"
                            title={
                                isAllCollapsed ? "Expand all providers" : "Collapse all providers"
                            }
                        >
                            {isAllCollapsed ? (
                                <>
                                    <ChevronsUpDown className="size-3.5 text-text-muted" />
                                    <span>Expand All</span>
                                </>
                            ) : (
                                <>
                                    <ChevronsDownUp className="size-3.5 text-text-muted" />
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
                        className="rounded-full px-4 h-9 text-xs font-medium cursor-pointer gap-1.5 shadow-none"
                        title="Refresh live quota and usage stats"
                    >
                        <RefreshCw
                            className={`size-3.5 ${isSpinning ? "animate-spin text-accent" : "text-text-muted"}`}
                        />
                        <span>{isSpinning ? "Refreshing…" : "Refresh"}</span>
                    </Button>

                    <Link
                        to="/providers"
                        className={cn(
                            buttonVariants({ size: "sm" }),
                            "rounded-full px-5 h-9 text-xs font-semibold cursor-pointer shadow-none gap-1.5"
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
                <Empty className="rounded-3xl border border-hairline-soft bg-canvas p-12">
                    <EmptyHeader>
                        <EmptyMedia variant="icon">
                            <Gauge className="size-5 text-text-muted" />
                        </EmptyMedia>
                        <EmptyTitle className="text-ink font-bold">
                            No Active Quotas or Usage Data Yet
                        </EmptyTitle>
                        <EmptyDescription className="text-text-muted text-xs">
                            Live quota progress and per-model consumption will appear here as soon
                            as upstream sessions are synced or gateway requests are processed.
                        </EmptyDescription>
                    </EmptyHeader>
                    <EmptyContent>
                        <Link
                            to="/providers"
                            className={cn(
                                buttonVariants({ size: "sm" }),
                                "rounded-full px-5 h-9 text-xs font-semibold cursor-pointer shadow-none gap-1.5"
                            )}
                        >
                            <Plus className="size-3.5" />
                            <span>Go to Providers Catalog</span>
                        </Link>
                    </EmptyContent>
                </Empty>
            ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
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
