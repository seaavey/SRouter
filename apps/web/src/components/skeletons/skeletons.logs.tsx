import { Skeleton } from "@/components/ui/skeleton";

export function LogsSkeleton() {
    return (
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 font-mono">
            {/* Header */}
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end border-b border-border/80 pb-5">
                <div className="space-y-2">
                    <Skeleton className="h-3 w-28 rounded" />
                    <Skeleton className="h-7 w-44 rounded-md" />
                    <Skeleton className="h-3.5 w-80 max-w-full rounded" />
                </div>
                <div className="flex items-center gap-2">
                    <Skeleton className="h-8.5 w-24 rounded-md" />
                    <Skeleton className="h-8.5 w-28 rounded-md" />
                </div>
            </div>

            {/* Logs Table Container */}
            <div className="rounded-xl border border-border/80 bg-card/60 p-5 space-y-4 shadow-2xs">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-border/60 pb-3">
                    <div className="flex items-center gap-2">
                        <Skeleton className="h-7 w-16 rounded-md" />
                        <Skeleton className="h-7 w-16 rounded-md" />
                        <Skeleton className="h-7 w-16 rounded-md" />
                    </div>
                    <Skeleton className="h-8 w-60 rounded-md" />
                </div>
                <div className="space-y-2">
                    {Array.from({ length: 8 }).map((_, i) => (
                        <div
                            key={i}
                            className="flex items-center justify-between gap-4 py-2 border-b border-border/40 last:border-0"
                        >
                            <Skeleton className="h-4 w-28 rounded" />
                            <Skeleton className="h-4 w-24 rounded" />
                            <Skeleton className="h-5 w-16 rounded-full" />
                            <Skeleton className="h-4 w-20 rounded" />
                            <Skeleton className="h-4 w-16 rounded" />
                            <Skeleton className="h-4 w-16 rounded" />
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
