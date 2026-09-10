import { Skeleton } from "@/components/ui/skeleton";

export function ProvidersSkeleton() {
    return (
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 font-sans">
            {/* Header */}
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end border-b border-hairline-soft pb-5">
                <div className="space-y-2">
                    <Skeleton className="h-3 w-36 rounded-full" />
                    <Skeleton className="h-8 w-56 rounded-full" />
                    <Skeleton className="h-3.5 w-96 max-w-full rounded-full" />
                </div>
                <div className="flex items-center gap-2">
                    <Skeleton className="h-9 w-36 rounded-full" />
                    <Skeleton className="h-9 w-24 rounded-full" />
                </div>
            </div>

            {/* 4 KPI Summary Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {Array.from({ length: 4 }).map((_, i) => (
                    <div
                        key={i}
                        className="flex flex-col justify-between rounded-3xl border border-hairline-soft bg-canvas p-5 shadow-none space-y-3"
                    >
                        <div className="flex items-center justify-between">
                            <Skeleton className="h-3 w-20 rounded-full" />
                            <Skeleton className="size-4 rounded-full" />
                        </div>
                        <Skeleton className="h-8 w-16 rounded-full" />
                        <Skeleton className="h-3 w-28 rounded-full" />
                    </div>
                ))}
            </div>

            {/* Filter Toolbar */}
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between border border-hairline-soft p-2 bg-canvas-soft rounded-3xl lg:rounded-full">
                <div className="flex items-center gap-2 p-0.5">
                    <Skeleton className="h-7 w-16 rounded-full" />
                    <Skeleton className="h-7 w-20 rounded-full" />
                    <Skeleton className="h-7 w-24 rounded-full" />
                    <Skeleton className="h-7 w-20 rounded-full" />
                </div>
                <div className="flex items-center gap-2 px-1">
                    <Skeleton className="h-9 w-60 rounded-full" />
                    <Skeleton className="h-9 w-18 rounded-full" />
                </div>
            </div>

            {/* Provider Cards Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {Array.from({ length: 6 }).map((_, i) => (
                    <div
                        key={i}
                        className="flex flex-col justify-between rounded-3xl border border-hairline-soft bg-canvas p-5 sm:p-6 shadow-none space-y-4"
                    >
                        <div className="flex items-start justify-between gap-3">
                            <div className="flex items-center gap-3.5">
                                <Skeleton className="size-11 rounded-[30%]" />
                                <div className="space-y-1.5">
                                    <Skeleton className="h-4 w-28 rounded-full" />
                                    <Skeleton className="h-3 w-20 rounded-full" />
                                </div>
                            </div>
                            <Skeleton className="h-4 w-14 rounded-full" />
                        </div>

                        <div className="flex items-center justify-between border-t border-hairline-soft pt-4">
                            <Skeleton className="h-3 w-20 rounded-full" />
                            <Skeleton className="h-7 w-20 rounded-full" />
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
