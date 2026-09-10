import { Skeleton } from "@/components/ui/skeleton";

export function QuotaSkeleton() {
    return (
        <div className="mx-auto flex w-full max-w-[1360px] flex-col gap-8 font-sans">
            {/* Header */}
            <div className="flex flex-col justify-between gap-4 pb-2 sm:flex-row sm:items-end">
                <div className="space-y-2">
                    <Skeleton className="h-3 w-28 rounded-full" />
                    <Skeleton className="h-8 w-52 rounded-2xl" />
                    <Skeleton className="h-4 w-96 max-w-full rounded-2xl" />
                </div>
                <div className="flex items-center gap-2">
                    <Skeleton className="h-9 w-28 rounded-full" />
                    <Skeleton className="h-9 w-28 rounded-full" />
                    <Skeleton className="h-9 w-36 rounded-full" />
                </div>
            </div>

            {/* 4 Summary Metrics Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 font-sans">
                {Array.from({ length: 4 }).map((_, i) => (
                    <div
                        key={i}
                        className="flex min-w-0 min-h-[140px] flex-col justify-between rounded-3xl border border-hairline-soft bg-canvas p-6 shadow-none"
                    >
                        <div className="flex items-center justify-between">
                            <Skeleton className="h-3 w-24 rounded-full" />
                            <Skeleton className="size-4 rounded-full" />
                        </div>
                        <Skeleton className="h-8 w-20 rounded-2xl mt-3" />
                        <div className="mt-4 border-t border-hairline-soft pt-3">
                            <Skeleton className="h-3 w-36 rounded-full" />
                        </div>
                    </div>
                ))}
            </div>

            {/* Provider Cards 2-Col Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
                {Array.from({ length: 2 }).map((_, i) => (
                    <div
                        key={i}
                        className="rounded-3xl border border-hairline-soft bg-canvas p-6 shadow-none space-y-5 font-sans"
                    >
                        {/* Provider Header */}
                        <div className="flex items-center justify-between gap-4 border-b border-hairline-soft pb-4">
                            <div className="flex items-center gap-3.5 flex-1">
                                <Skeleton className="size-10 rounded-2xl shrink-0" />
                                <div className="space-y-1.5 flex-1">
                                    <div className="flex items-center gap-2">
                                        <Skeleton className="h-4 w-24 rounded-full" />
                                        <Skeleton className="h-5 w-20 rounded-full" />
                                    </div>
                                    <Skeleton className="h-3 w-36 rounded-full" />
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <Skeleton className="h-8 w-16 rounded-full" />
                                <Skeleton className="h-8 w-20 rounded-full" />
                            </div>
                        </div>

                        {/* Account Box */}
                        <div className="rounded-2xl border border-hairline-soft bg-canvas-soft/40 p-5 space-y-4">
                            <div className="flex items-center justify-between border-b border-hairline-soft pb-3">
                                <div className="flex items-center gap-2">
                                    <Skeleton className="size-2 rounded-full" />
                                    <Skeleton className="h-4 w-28 rounded-full" />
                                    <Skeleton className="h-5 w-16 rounded-full" />
                                </div>
                                <Skeleton className="h-3 w-20 rounded-full" />
                            </div>
                            <Skeleton className="h-20 w-full rounded-2xl" />
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
