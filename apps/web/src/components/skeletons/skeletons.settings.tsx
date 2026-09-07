import { Skeleton } from "@/components/ui/skeleton";

export function SettingsSkeleton() {
    return (
        <div className="mx-auto w-full max-w-5xl font-mono pb-16 space-y-6">
            {/* Header */}
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end border-b border-border/80 pb-5">
                <div className="space-y-2">
                    <Skeleton className="h-3 w-36 rounded" />
                    <Skeleton className="h-7 w-52 rounded" />
                    <Skeleton className="h-3.5 w-96 max-w-full rounded" />
                </div>
                <div className="flex items-center gap-2">
                    <Skeleton className="h-8 w-20 rounded" />
                    <Skeleton className="h-8 w-20 rounded" />
                </div>
            </div>

            {/* Nav Quick Tabs */}
            <div className="flex items-center gap-1 border border-border/80 p-1.5 bg-card/50 rounded-lg">
                {Array.from({ length: 6 }).map((_, i) => (
                    <Skeleton key={i} className="h-7 w-20 rounded" />
                ))}
            </div>

            {/* Settings Sections */}
            <div className="space-y-6">
                {Array.from({ length: 3 }).map((_, i) => (
                    <div
                        key={i}
                        className="rounded-lg border border-border/80 bg-card p-5 space-y-4 shadow-2xs"
                    >
                        <div className="flex items-center gap-3 border-b border-border/80 pb-3.5">
                            <Skeleton className="size-7.5 rounded" />
                            <div className="space-y-1.5">
                                <Skeleton className="h-4 w-44 rounded" />
                                <Skeleton className="h-3 w-64 rounded" />
                            </div>
                        </div>

                        <div className="space-y-3 pt-1">
                            <Skeleton className="h-10 w-full rounded" />
                            <Skeleton className="h-10 w-full rounded" />
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
