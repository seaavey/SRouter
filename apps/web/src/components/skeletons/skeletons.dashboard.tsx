import { Skeleton } from "@/components/ui/skeleton";

export function DashboardSkeleton() {
    return (
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 font-mono">
            {/* Header */}
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end border-b border-border/80 pb-5">
                <div className="space-y-2">
                    <Skeleton className="h-3 w-28 rounded" />
                    <Skeleton className="h-7 w-64 rounded-md" />
                    <Skeleton className="h-3.5 w-96 max-w-full rounded" />
                </div>
            </div>

            {/* 4 KPI Telemetry Tiles */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
                {Array.from({ length: 4 }).map((_, i) => (
                    <div
                        key={i}
                        className="flex flex-col justify-between rounded-xl border border-border/80 bg-card/60 p-4 shadow-2xs space-y-3"
                    >
                        <div className="flex items-center justify-between">
                            <Skeleton className="h-3 w-24 rounded" />
                            <Skeleton className="size-6 rounded-md" />
                        </div>
                        <Skeleton className="h-7 w-28 rounded-md" />
                        <Skeleton className="h-3 w-36 rounded border-t border-border/50 pt-2" />
                    </div>
                ))}
            </div>

            {/* Overview & Live Network Status */}
            <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(20rem,0.65fr)]">
                <div className="rounded-xl border border-border/80 bg-card/60 p-5 space-y-4 shadow-2xs min-h-[300px]">
                    <div className="flex items-center justify-between border-b border-border/60 pb-3">
                        <Skeleton className="h-4 w-40 rounded" />
                        <Skeleton className="h-4 w-20 rounded" />
                    </div>
                    <div className="space-y-3 pt-2">
                        {Array.from({ length: 5 }).map((_, i) => (
                            <div key={i} className="flex items-center gap-3">
                                <Skeleton className="h-4 w-32 rounded" />
                                <Skeleton className="h-3.5 flex-1 rounded" />
                                <Skeleton className="h-4 w-16 rounded" />
                            </div>
                        ))}
                    </div>
                </div>

                <div className="rounded-xl border border-border/80 bg-card/60 p-5 space-y-4 shadow-2xs min-h-[300px]">
                    <div className="flex items-center justify-between border-b border-border/60 pb-3">
                        <Skeleton className="h-4 w-36 rounded" />
                        <Skeleton className="h-4 w-16 rounded" />
                    </div>
                    <div className="space-y-3.5 pt-2">
                        {Array.from({ length: 4 }).map((_, i) => (
                            <div key={i} className="flex items-center justify-between">
                                <div className="space-y-1.5">
                                    <Skeleton className="h-3.5 w-28 rounded" />
                                    <Skeleton className="h-2.5 w-20 rounded" />
                                </div>
                                <Skeleton className="h-5 w-16 rounded-full" />
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Tabular Usage Breakdown */}
            <div className="rounded-xl border border-border/80 bg-card/60 p-5 space-y-4 shadow-2xs min-h-[250px]">
                <div className="flex items-center justify-between border-b border-border/60 pb-3">
                    <Skeleton className="h-4 w-44 rounded" />
                    <Skeleton className="h-7 w-32 rounded-md" />
                </div>
                <div className="space-y-2 pt-2">
                    {Array.from({ length: 4 }).map((_, i) => (
                        <Skeleton key={i} className="h-10 w-full rounded-md" />
                    ))}
                </div>
            </div>
        </div>
    );
}
