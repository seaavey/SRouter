import type { ComponentType } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Activity, Boxes, Coins, CircleDollarSign, Radio, RefreshCw, TriangleAlert } from "lucide-react";
import { api } from "@/lib/api";
import type { UsageStats } from "@/lib/types";
import { ModelUsageOverview } from "@/components/dashboard/ModelUsageOverview";
import { NetworkStatus } from "@/components/dashboard/NetworkStatus";
import { UsageByModelTable } from "@/components/dashboard/UsageByModelTable";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/")({
    staticData: { title: "Dashboard" },
    component: DashboardPage,
});

type StatCardProps = {
    label: string;
    value: string;
    detail: string;
    icon: ComponentType<{ className?: string; strokeWidth?: number }>;
};

function StatCard({ label, value, detail, icon: Icon }: StatCardProps) {
    return (
        <article className="relative min-w-0 px-4 py-5 xl:[&:not(:first-child)]:border-l xl:[&:not(:first-child)]:border-border/70">
            <div className="flex items-center gap-2 text-muted-foreground">
                <Icon className="size-3.5" strokeWidth={1.75} />
                <span className="text-[10px] font-semibold uppercase tracking-[0.12em]">{label}</span>
            </div>
            <div className="mt-3 text-2xl font-semibold tracking-tight text-foreground">{value}</div>
            <p className="mt-1 truncate text-[11px] text-muted-foreground" title={detail}>
                {detail}
            </p>
        </article>
    );
}

function DashboardSkeleton() {
    return (
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
                <div>
                    <Skeleton className="h-3 w-24" />
                    <Skeleton className="mt-3 h-7 w-52" />
                    <Skeleton className="mt-2 h-4 w-80 max-w-full" />
                </div>
                <Skeleton className="h-6 w-36 rounded-full" />
            </div>
            <div className="grid grid-cols-1 border-y border-border/70 sm:grid-cols-2 xl:grid-cols-4">
                {Array.from({ length: 4 }).map((_, index) => (
                    <div key={index} className="py-4 sm:px-4 sm:first:pl-0 sm:last:pr-0">
                        <Skeleton className="h-20 rounded-lg" />
                    </div>
                ))}
            </div>
            <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(20rem,0.8fr)]">
                <Skeleton className="h-80 rounded-xl" />
                <Skeleton className="h-80 rounded-xl" />
            </div>
            <Skeleton className="h-72 rounded-xl" />
        </div>
    );
}

function DashboardPage() {
    const {
        data: stats,
        isPending,
        isFetching,
        isError,
        error,
        dataUpdatedAt,
        refetch,
    } = useQuery({
        queryKey: ["stats"],
        queryFn: () => api.get<UsageStats>("/v1/logs/stats"),
        refetchInterval: 30_000,
        refetchIntervalInBackground: false,
    });

    if (isPending && !stats) {
        return <DashboardSkeleton />;
    }

    if (!stats) {
        return (
            <div className="mx-auto w-full max-w-7xl">
                <div className="flex min-h-64 flex-col items-center justify-center rounded-xl border border-destructive/30 bg-destructive/5 px-6 text-center">
                    <div className="flex size-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                        <TriangleAlert className="size-5" strokeWidth={1.75} />
                    </div>
                    <h1 className="mt-4 text-base font-semibold text-foreground">Unable to load gateway statistics</h1>
                    <p className="mt-1 max-w-lg text-xs text-muted-foreground">
                        {error instanceof Error ? error.message : "The gateway returned an unknown error."}
                    </p>
                    <Button type="button" variant="outline" size="sm" className="mt-4" onClick={() => void refetch()}>
                        <RefreshCw />
                        Retry
                    </Button>
                </div>
            </div>
        );
    }

    const updatedAt = dataUpdatedAt
        ? new Intl.DateTimeFormat(undefined, {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
          }).format(dataUpdatedAt)
        : null;
    const freshnessLabel = isFetching
        ? "Refreshing"
        : isError
          ? "Refresh failed"
          : updatedAt
            ? `Live · Updated ${updatedAt}`
            : "Live";

    return (
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
            <header className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
                <div className="min-w-0">
                    <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                        Ops cockpit
                    </p>
                    <h1 className="mt-1.5 text-2xl font-bold tracking-tight text-foreground">Gateway operations</h1>
                    <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
                        Aggregate usage, model activity, and integration tools for your SRouter gateway.
                    </p>
                </div>

                <Badge
                    variant={isError ? "destructive" : "outline"}
                    className="w-fit shrink-0 gap-1.5 font-mono text-[10px]"
                    role="status"
                    aria-live="polite"
                >
                    {isFetching ? (
                        <RefreshCw className="size-3 animate-spin" />
                    ) : isError ? (
                        <TriangleAlert className="size-3" />
                    ) : (
                        <Radio className="size-3" />
                    )}
                    {freshnessLabel}
                </Badge>
            </header>

            <section
                aria-label="Gateway usage summary"
                className="grid grid-cols-1 border-y border-border/70 sm:grid-cols-2 sm:[&>article:nth-child(n+3)]:border-t xl:grid-cols-4 xl:[&>article:nth-child(n+3)]:border-t-0"
            >
                <StatCard
                    label="Total requests"
                    value={stats.totalRequests.toLocaleString()}
                    detail="All recorded requests"
                    icon={Activity}
                />
                <StatCard
                    label="Total tokens"
                    value={stats.totalTokens.toLocaleString()}
                    detail={`${stats.totalInputTokens.toLocaleString()} input · ${stats.totalOutputTokens.toLocaleString()} output`}
                    icon={Coins}
                />
                <StatCard
                    label="Estimated cost"
                    value={stats.costLabel}
                    detail={stats.estimated ? "Estimated from recorded usage" : "Recorded usage cost"}
                    icon={CircleDollarSign}
                />
                <StatCard
                    label="Models used"
                    value={stats.byModel.length.toLocaleString()}
                    detail="Models with recorded usage"
                    icon={Boxes}
                />
            </section>

            <section
                aria-label="Operational overview"
                className="grid min-w-0 border-y border-border/70 [&>*+*]:border-t [&>*+*]:border-border/70 lg:grid-cols-[minmax(0,1.35fr)_minmax(20rem,0.65fr)] lg:[&>*+*]:border-l lg:[&>*+*]:border-t-0"
            >
                <ModelUsageOverview models={stats.byModel} />
                <NetworkStatus />
            </section>

            <UsageByModelTable models={stats.byModel} />
        </div>
    );
}
