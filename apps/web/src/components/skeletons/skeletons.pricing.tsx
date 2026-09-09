import { Skeleton } from "@/components/ui/skeleton";

export function PricingSkeleton() {
    return (
        <div className="space-y-6 font-mono">
            {/* Header skeleton */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1.5">
                    <Skeleton className="h-6 w-48 rounded" />
                    <Skeleton className="h-3.5 w-72 rounded" />
                </div>
                <div className="flex items-center gap-2">
                    <Skeleton className="h-8 w-24 rounded" />
                </div>
            </div>

            {/* Stat Cards skeleton */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {Array.from({ length: 4 }).map((_, i) => (
                    <div
                        key={i}
                        className="rounded-lg border border-border/70 bg-card p-3.5 space-y-2"
                    >
                        <Skeleton className="h-3 w-20 rounded" />
                        <Skeleton className="h-6 w-16 rounded" />
                    </div>
                ))}
            </div>

            {/* Filter toolbar skeleton */}
            <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
                <Skeleton className="h-8 w-full sm:w-72 rounded" />
                <Skeleton className="h-8 w-36 rounded" />
                <Skeleton className="h-8 w-36 rounded" />
            </div>

            {/* Table skeleton */}
            <div className="rounded-lg border border-border/80 bg-card overflow-hidden">
                <div className="border-b border-border/70 bg-secondary/30 p-3">
                    <Skeleton className="h-4 w-32 rounded" />
                </div>
                <div className="divide-y divide-border/60">
                    {Array.from({ length: 8 }).map((_, i) => (
                        <div key={i} className="flex items-center justify-between p-3.5 gap-4">
                            <div className="space-y-1">
                                <Skeleton className="h-4 w-40 rounded" />
                                <Skeleton className="h-3 w-28 rounded" />
                            </div>
                            <Skeleton className="h-4 w-20 rounded" />
                            <Skeleton className="h-4 w-20 rounded" />
                            <Skeleton className="h-4 w-16 rounded" />
                            <Skeleton className="h-4 w-24 rounded" />
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
