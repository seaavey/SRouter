import { Skeleton } from "@/components/ui/skeleton";

export function SettingsSkeleton() {
    return (
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 font-mono">
            {/* Header */}
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end border-b border-border/80 pb-5">
                <div className="space-y-2">
                    <Skeleton className="h-3 w-28 rounded" />
                    <Skeleton className="h-7 w-44 rounded-md" />
                    <Skeleton className="h-3.5 w-80 max-w-full rounded" />
                </div>
            </div>

            {/* Settings Layout Grid: Nav tabs + Form */}
            <div className="grid grid-cols-1 md:grid-cols-[14rem_1fr] gap-6">
                {/* Left Tabs */}
                <div className="flex flex-row md:flex-col gap-1.5 overflow-x-auto">
                    {Array.from({ length: 6 }).map((_, i) => (
                        <Skeleton key={i} className="h-8.5 w-full min-w-[120px] rounded-md" />
                    ))}
                </div>

                {/* Right Form Card */}
                <div className="rounded-xl border border-border/80 bg-card/60 p-6 space-y-6 shadow-2xs">
                    <div className="space-y-2 border-b border-border/60 pb-4">
                        <Skeleton className="h-5 w-40 rounded" />
                        <Skeleton className="h-3.5 w-64 rounded" />
                    </div>

                    <div className="space-y-4">
                        {Array.from({ length: 3 }).map((_, i) => (
                            <div key={i} className="space-y-2">
                                <Skeleton className="h-3.5 w-32 rounded" />
                                <Skeleton className="h-9 w-full rounded-md" />
                            </div>
                        ))}
                    </div>

                    <div className="border-t border-border/60 pt-4 flex justify-end">
                        <Skeleton className="h-8.5 w-28 rounded-md" />
                    </div>
                </div>
            </div>
        </div>
    );
}
