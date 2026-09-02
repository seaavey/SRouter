import { Skeleton } from "@/components/ui/skeleton";

export function ProviderDetailSkeleton() {
    return (
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 font-mono">
            {/* Back link */}
            <Skeleton className="h-4 w-32 rounded" />

            {/* Provider Detail Header */}
            <div className="flex flex-col justify-between gap-4 rounded-xl border border-border/80 bg-card/60 p-5 sm:flex-row sm:items-center shadow-2xs">
                <div className="flex items-center gap-4">
                    <Skeleton className="size-12 rounded-xl" />
                    <div className="space-y-2">
                        <div className="flex items-center gap-2">
                            <Skeleton className="h-6 w-40 rounded-md" />
                            <Skeleton className="h-5 w-20 rounded-full" />
                        </div>
                        <Skeleton className="h-3.5 w-72 max-w-full rounded" />
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <Skeleton className="h-8.5 w-32 rounded-md" />
                </div>
            </div>

            {/* Connections Section */}
            <div className="space-y-3">
                <div className="flex items-center justify-between">
                    <Skeleton className="h-4 w-32 rounded" />
                    <Skeleton className="h-4 w-24 rounded" />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {Array.from({ length: 2 }).map((_, i) => (
                        <div
                            key={i}
                            className="flex flex-col justify-between rounded-xl border border-border/80 bg-card/60 p-4 shadow-2xs space-y-4"
                        >
                            <div className="flex items-center justify-between">
                                <Skeleton className="h-4 w-36 rounded" />
                                <Skeleton className="h-5 w-16 rounded-full" />
                            </div>
                            <Skeleton className="h-3 w-48 rounded" />
                            <div className="flex items-center gap-2 border-t border-border/60 pt-3">
                                <Skeleton className="h-7 w-20 rounded-md" />
                                <Skeleton className="h-7 w-20 rounded-md" />
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Model Catalog Table Section */}
            <div className="rounded-xl border border-border/80 bg-card/60 p-5 space-y-4 shadow-2xs">
                <div className="flex items-center justify-between border-b border-border/60 pb-3">
                    <Skeleton className="h-4 w-36 rounded" />
                    <Skeleton className="h-8 w-48 rounded-md" />
                </div>
                <div className="space-y-2.5">
                    {Array.from({ length: 4 }).map((_, i) => (
                        <Skeleton key={i} className="h-11 w-full rounded-md" />
                    ))}
                </div>
            </div>
        </div>
    );
}
