import { Skeleton } from "@/components/ui/skeleton";

export function DashboardSkeleton() {
    return (
        <div className="mx-auto flex w-full min-w-0 max-w-[1360px] flex-col gap-6 px-4 font-sans sm:gap-8 sm:px-5 xl:px-0">
            <div className="flex flex-col justify-between gap-4 pb-2 sm:flex-row sm:items-end">
                <div className="min-w-0 space-y-2">
                    <Skeleton className="h-3 w-32 rounded" />
                    <Skeleton className="h-8 w-full max-w-64 rounded" />
                    <Skeleton className="h-4 w-full max-w-96 rounded" />
                </div>
                <Skeleton className="h-9 w-24 rounded-full" />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: 3 }).map((_, index) => (
                    <div
                        key={index}
                        className="flex min-h-[128px] min-w-0 flex-col justify-between rounded-3xl border border-hairline-soft bg-canvas p-4 sm:p-5 lg:p-6"
                    >
                        <Skeleton className="h-3 w-24 rounded" />
                        <Skeleton className="h-8 w-28 rounded" />
                        <Skeleton className="h-3 w-full max-w-36 rounded" />
                    </div>
                ))}
            </div>
            <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(19rem,0.6fr)]">
                <div className="min-h-[280px] min-w-0 rounded-3xl border border-hairline-soft bg-canvas p-4 sm:p-5 lg:p-6">
                    <div className="flex items-center justify-between gap-3 border-b border-hairline-soft pb-4">
                        <Skeleton className="h-4 w-40 rounded" />
                        <Skeleton className="h-4 w-20 rounded" />
                    </div>
                    <div className="space-y-3 pt-4">
                        {Array.from({ length: 5 }).map((_, index) => (
                            <div key={index} className="flex min-w-0 items-center gap-3">
                                <Skeleton className="h-4 w-24 shrink-0 rounded sm:w-32" />
                                <Skeleton className="h-3.5 min-w-0 flex-1 rounded" />
                                <Skeleton className="h-4 w-14 shrink-0 rounded" />
                            </div>
                        ))}
                    </div>
                </div>
                <div className="min-h-[280px] min-w-0 rounded-3xl border border-hairline-soft bg-canvas p-4 sm:p-5 lg:p-6">
                    <div className="flex items-center justify-between gap-3 border-b border-hairline-soft pb-4">
                        <Skeleton className="h-4 w-36 rounded" />
                        <Skeleton className="h-4 w-16 rounded" />
                    </div>
                    <div className="space-y-3.5 pt-4">
                        {Array.from({ length: 3 }).map((_, index) => (
                            <div key={index} className="flex items-center justify-between gap-3">
                                <div className="min-w-0 flex-1 space-y-1.5">
                                    <Skeleton className="h-3.5 w-28 max-w-full rounded" />
                                    <Skeleton className="h-2.5 w-20 max-w-full rounded" />
                                </div>
                                <Skeleton className="h-5 w-16 shrink-0 rounded" />
                            </div>
                        ))}
                    </div>
                </div>
            </div>
            <div className="min-h-[250px] min-w-0 rounded-3xl border border-hairline-soft bg-canvas p-4 sm:p-5 lg:p-6">
                <div className="flex flex-col justify-between gap-3 border-b border-hairline-soft pb-4 sm:flex-row sm:items-center">
                    <Skeleton className="h-4 w-44 rounded" />
                    <Skeleton className="h-9 w-full max-w-48 rounded-full" />
                </div>
                <div className="space-y-2 pt-4">
                    {Array.from({ length: 4 }).map((_, index) => (
                        <Skeleton key={index} className="h-10 w-full rounded-2xl" />
                    ))}
                </div>
            </div>
        </div>
    );
}
