import { Skeleton } from "@/components/ui/skeleton";

export function AnalyticsSkeleton() {
    return (
        <div className="mx-auto flex w-full max-w-[1360px] flex-col gap-8 font-sans">
            {/* Header Skeleton */}
            <div className="flex flex-col justify-between gap-4 pb-2 sm:flex-row sm:items-end">
                <div className="space-y-2">
                    <Skeleton className="h-3 w-36 rounded-full" />
                    <Skeleton className="h-8 w-56 rounded-2xl" />
                    <Skeleton className="h-4 w-96 max-w-full rounded-2xl" />
                </div>
                <div className="flex items-center gap-3">
                    <Skeleton className="h-9 w-44 rounded-full" />
                    <Skeleton className="h-4 w-24 rounded-full" />
                </div>
            </div>

            {/* 4 Stat Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 font-sans">
                {Array.from({ length: 4 }).map((_, i) => (
                    <div
                        key={i}
                        className="flex min-w-0 min-h-[140px] flex-col justify-between rounded-3xl border border-hairline-soft bg-canvas p-6 shadow-none"
                    >
                        <div>
                            <Skeleton className="h-3 w-20 rounded-full" />
                            <Skeleton className="h-8 w-24 rounded-2xl mt-3" />
                        </div>
                        <div className="mt-4 border-t border-hairline-soft pt-3">
                            <Skeleton className="h-3 w-36 rounded-full" />
                        </div>
                    </div>
                ))}
            </div>

            {/* 2 Charts Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {Array.from({ length: 2 }).map((_, i) => (
                    <div
                        key={i}
                        className="rounded-3xl border border-hairline-soft bg-canvas p-6 shadow-none space-y-4"
                    >
                        <div className="flex items-center justify-between">
                            <div className="space-y-1.5">
                                <Skeleton className="h-4 w-28 rounded-full" />
                                <Skeleton className="h-3 w-44 rounded-full" />
                            </div>
                            <Skeleton className="h-6 w-16 rounded-full" />
                        </div>
                        <Skeleton className="h-[240px] w-full rounded-2xl" />
                    </div>
                ))}
            </div>

            {/* Token Usage Chart */}
            <div className="rounded-3xl border border-hairline-soft bg-canvas p-6 shadow-none space-y-4">
                <div className="flex items-center justify-between">
                    <div className="space-y-1.5">
                        <Skeleton className="h-4 w-36 rounded-full" />
                        <Skeleton className="h-3 w-64 rounded-full" />
                    </div>
                    <Skeleton className="h-6 w-20 rounded-full" />
                </div>
                <Skeleton className="h-[260px] w-full rounded-2xl" />
            </div>

            {/* Breakdown Card */}
            <div className="rounded-3xl border border-hairline-soft bg-canvas p-6 shadow-none space-y-6">
                <div className="flex flex-col justify-between gap-4 border-b border-hairline-soft pb-4 sm:flex-row sm:items-center">
                    <div className="space-y-1.5">
                        <Skeleton className="h-4 w-44 rounded-full" />
                        <Skeleton className="h-3 w-72 rounded-full" />
                    </div>
                    <Skeleton className="h-8 w-60 rounded-full" />
                </div>
                <div className="space-y-4">
                    {Array.from({ length: 3 }).map((_, i) => (
                        <div key={i} className="flex items-center gap-3.5">
                            <Skeleton className="size-9 rounded-2xl shrink-0" />
                            <div className="flex-1 space-y-2">
                                <div className="flex justify-between">
                                    <Skeleton className="h-3 w-28 rounded-full" />
                                    <Skeleton className="h-3 w-16 rounded-full" />
                                </div>
                                <Skeleton className="h-1.5 w-full rounded-full" />
                                <div className="flex justify-between">
                                    <Skeleton className="h-2.5 w-20 rounded-full" />
                                    <Skeleton className="h-2.5 w-24 rounded-full" />
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
