import { Skeleton } from "@/components/ui/skeleton";

export function KeysSkeleton() {
    return (
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 font-mono">
            {/* Header */}
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end border-b border-border/80 pb-5">
                <div className="space-y-2">
                    <Skeleton className="h-3 w-28 rounded" />
                    <Skeleton className="h-7 w-48 rounded-md" />
                    <Skeleton className="h-3.5 w-80 max-w-full rounded" />
                </div>
                <Skeleton className="h-8.5 w-32 rounded-md" />
            </div>

            {/* 3 Metrics Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                {Array.from({ length: 3 }).map((_, i) => (
                    <div
                        key={i}
                        className="flex flex-col justify-between rounded-xl border border-border/80 bg-card/60 p-4 shadow-2xs space-y-3"
                    >
                        <div className="flex items-center justify-between">
                            <Skeleton className="h-3 w-24 rounded" />
                            <Skeleton className="size-6 rounded-md" />
                        </div>
                        <Skeleton className="h-7 w-20 rounded-md" />
                        <Skeleton className="h-3 w-32 rounded" />
                    </div>
                ))}
            </div>

            {/* Keys Table Container */}
            <div className="rounded-xl border border-border/80 bg-card/60 p-5 space-y-4 shadow-2xs">
                <div className="flex items-center justify-between border-b border-border/60 pb-3">
                    <Skeleton className="h-4 w-32 rounded" />
                    <Skeleton className="h-8 w-52 rounded-md" />
                </div>
                <div className="space-y-2.5">
                    {Array.from({ length: 4 }).map((_, i) => (
                        <Skeleton key={i} className="h-12 w-full rounded-md" />
                    ))}
                </div>
            </div>
        </div>
    );
}
