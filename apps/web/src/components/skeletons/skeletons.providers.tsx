import { Skeleton } from "@/components/ui/skeleton";

export function ProvidersSkeleton() {
    return (
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 font-mono">
            {/* Header */}
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end border-b border-border/80 pb-5">
                <div className="space-y-2">
                    <div className="flex items-center gap-2">
                        <Skeleton className="h-3 w-36 rounded" />
                        <Skeleton className="h-4 w-20 rounded-full" />
                    </div>
                    <Skeleton className="h-7 w-52 rounded-md" />
                    <Skeleton className="h-3.5 w-96 max-w-full rounded" />
                </div>
                <div className="flex items-center gap-2">
                    <Skeleton className="h-8.5 w-32 rounded-md" />
                    <Skeleton className="h-8.5 w-28 rounded-md" />
                </div>
            </div>

            {/* 4 KPI Summary Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {Array.from({ length: 4 }).map((_, i) => (
                    <div
                        key={i}
                        className="flex flex-col justify-between rounded-xl border border-border/80 bg-card/60 p-3.5 shadow-2xs space-y-2.5"
                    >
                        <div className="flex items-center justify-between">
                            <Skeleton className="h-3 w-20 rounded" />
                            <Skeleton className="size-3.5 rounded" />
                        </div>
                        <Skeleton className="h-7 w-16 rounded-md" />
                        <Skeleton className="h-3 w-28 rounded" />
                    </div>
                ))}
            </div>

            {/* Filter Toolbar */}
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between border-y border-border/70 py-3 bg-secondary/15 px-3 rounded-lg">
                <div className="flex items-center gap-2">
                    <Skeleton className="h-7 w-14 rounded-md" />
                    <Skeleton className="h-7 w-20 rounded-md" />
                    <Skeleton className="h-7 w-24 rounded-md" />
                    <Skeleton className="h-7 w-20 rounded-md" />
                </div>
                <div className="flex items-center gap-2.5">
                    <Skeleton className="h-8 w-60 rounded-md" />
                    <Skeleton className="h-8 w-16 rounded-md" />
                </div>
            </div>

            {/* Provider Cards Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {Array.from({ length: 6 }).map((_, i) => (
                    <div
                        key={i}
                        className="flex flex-col justify-between rounded-xl border border-border/80 bg-card/60 p-4 shadow-2xs space-y-4"
                    >
                        <div className="flex items-start justify-between gap-3">
                            <div className="flex items-center gap-3">
                                <Skeleton className="size-10 rounded-lg" />
                                <div className="space-y-1.5">
                                    <Skeleton className="h-4 w-28 rounded" />
                                    <Skeleton className="h-2.5 w-20 rounded" />
                                </div>
                            </div>
                            <Skeleton className="h-5 w-16 rounded-full" />
                        </div>

                        <div className="flex items-center gap-1.5 pt-1">
                            <Skeleton className="h-5 w-20 rounded-md" />
                            <Skeleton className="h-5 w-16 rounded-md" />
                            <Skeleton className="h-5 w-16 rounded-md" />
                        </div>

                        <div className="flex items-center justify-between border-t border-border/60 pt-3">
                            <Skeleton className="h-3 w-20 rounded" />
                            <Skeleton className="h-4 w-20 rounded" />
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
