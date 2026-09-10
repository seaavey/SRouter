import { Skeleton } from "@/components/ui/skeleton";

export function PricingSkeleton() {
    return (
        <div className="mx-auto flex w-full max-w-[1360px] flex-col gap-8 font-sans pb-16">
            {/* Header skeleton */}
            <div className="flex flex-col justify-between gap-4 pb-2 sm:flex-row sm:items-end">
                <div className="space-y-2">
                    <Skeleton className="h-3 w-28 rounded-full" />
                    <Skeleton className="h-9 w-60 rounded-2xl" />
                    <Skeleton className="h-4 w-96 max-w-full rounded-full" />
                </div>
                <Skeleton className="h-10 w-28 rounded-full" />
            </div>

            {/* Stat Cards skeleton */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 font-sans">
                {Array.from({ length: 4 }).map((_, i) => (
                    <div
                        key={i}
                        className="flex min-w-0 min-h-[140px] flex-col justify-between rounded-3xl border border-hairline-soft bg-canvas p-6 shadow-none"
                    >
                        <Skeleton className="h-3 w-24 rounded-full" />
                        <Skeleton className="h-8 w-28 rounded-2xl mt-3" />
                        <div className="mt-4 border-t border-hairline-soft pt-3">
                            <Skeleton className="h-3 w-36 rounded-full" />
                        </div>
                    </div>
                ))}
            </div>

            {/* Filter toolbar skeleton */}
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center justify-between">
                <Skeleton className="h-10 w-full max-w-md rounded-full" />
                <div className="flex items-center gap-2 flex-wrap">
                    <Skeleton className="h-10 w-36 rounded-full" />
                    <Skeleton className="h-10 w-36 rounded-full" />
                    <Skeleton className="h-10 w-36 rounded-full" />
                    <Skeleton className="h-10 w-36 rounded-full" />
                </div>
            </div>

            {/* Table skeleton */}
            <div className="overflow-hidden rounded-3xl border border-hairline-soft bg-canvas shadow-none">
                <div className="border-b border-hairline-soft bg-canvas-soft p-4">
                    <Skeleton className="h-4 w-40 rounded-full" />
                </div>
                <div className="divide-y divide-hairline-soft">
                    {Array.from({ length: 8 }).map((_, i) => (
                        <div key={i} className="flex items-center justify-between p-4 gap-4">
                            <div className="space-y-1.5 min-w-[200px]">
                                <Skeleton className="h-4 w-40 rounded-full" />
                                <Skeleton className="h-3 w-28 rounded-full" />
                            </div>
                            <Skeleton className="h-4 w-16 rounded-full" />
                            <Skeleton className="h-4 w-16 rounded-full" />
                            <Skeleton className="h-4 w-16 rounded-full" />
                            <Skeleton className="h-4 w-16 rounded-full" />
                            <Skeleton className="h-4 w-20 rounded-full" />
                            <Skeleton className="h-4 w-24 rounded-full" />
                            <Skeleton className="h-4 w-20 rounded-full" />
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

export function PricingSearchSkeleton() {
    return (
        <div className="overflow-hidden rounded-3xl border border-hairline-soft bg-canvas shadow-none font-sans">
            <div className="border-b border-hairline-soft bg-canvas-soft px-5 py-3.5">
                <Skeleton className="h-3.5 w-32 rounded-full" />
            </div>
            <div className="divide-y divide-hairline-soft">
                {Array.from({ length: 8 }).map((_, index) => (
                    <div key={index} className="flex items-center gap-4 px-5 py-3.5">
                        <div className="min-w-0 flex-1 space-y-1.5">
                            <Skeleton className="h-4 w-44 max-w-full rounded-full" />
                            <Skeleton className="h-3 w-32 max-w-full rounded-full" />
                        </div>
                        <Skeleton className="hidden h-3.5 w-16 rounded-full sm:block" />
                        <Skeleton className="hidden h-3.5 w-16 rounded-full sm:block" />
                        <Skeleton className="h-3.5 w-14 rounded-full" />
                    </div>
                ))}
            </div>
        </div>
    );
}
