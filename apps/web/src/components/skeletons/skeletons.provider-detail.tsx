import { Skeleton } from "@/components/ui/skeleton";

export function ProviderDetailSkeleton() {
    return (
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 font-sans">
            <Skeleton className="h-4 w-32 rounded-full" />
            <div className="flex flex-col justify-between gap-4 border-b border-hairline-soft pb-5 sm:flex-row sm:items-center">
                <div className="flex items-center gap-4">
                    <Skeleton className="size-12 rounded-[30%]" />
                    <div className="space-y-2">
                        <div className="flex items-center gap-2.5">
                            <Skeleton className="h-8 w-44 rounded-full" />
                            <Skeleton className="h-5 w-24 rounded-full" />
                        </div>
                        <Skeleton className="h-3.5 w-72 max-w-full rounded-full" />
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <Skeleton className="h-9 w-28 rounded-full" />
                    <Skeleton className="h-9 w-32 rounded-full" />
                </div>
            </div>
            <div className="rounded-3xl border border-hairline-soft bg-canvas p-6 space-y-4 shadow-none">
                <div className="flex items-center justify-between border-b border-hairline-soft pb-4">
                    <Skeleton className="h-5 w-36 rounded-full" />
                    <div className="flex items-center gap-2">
                        <Skeleton className="h-8 w-24 rounded-full" />
                        <Skeleton className="h-8 w-28 rounded-full" />
                    </div>
                </div>
                <div className="grid grid-cols-1 gap-3">
                    {Array.from({ length: 2 }).map((_, i) => (
                        <div
                            key={i}
                            className="flex items-center justify-between rounded-2xl border border-hairline-soft bg-canvas-soft p-4 shadow-none"
                        >
                            <div className="flex items-center gap-3">
                                <Skeleton className="size-9 rounded-[30%]" />
                                <div className="space-y-1.5">
                                    <Skeleton className="h-4 w-36 rounded-full" />
                                    <Skeleton className="h-3 w-20 rounded-full" />
                                </div>
                            </div>
                            <Skeleton className="h-7 w-20 rounded-full" />
                        </div>
                    ))}
                </div>
            </div>
            <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-hairline-soft pb-3">
                    <Skeleton className="h-6 w-44 rounded-full" />
                    <div className="flex items-center gap-2">
                        <Skeleton className="h-9 w-60 rounded-full" />
                        <Skeleton className="h-9 w-16 rounded-full" />
                    </div>
                </div>
                <div className="rounded-3xl border border-hairline-soft bg-canvas overflow-hidden p-1">
                    {Array.from({ length: 5 }).map((_, i) => (
                        <div
                            key={i}
                            className="flex items-center justify-between p-3.5 border-b border-hairline-soft last:border-b-0"
                        >
                            <div className="flex items-center gap-3">
                                <Skeleton className="size-6 rounded-full" />
                                <Skeleton className="size-7 rounded-[30%]" />
                                <Skeleton className="h-4 w-48 rounded-full" />
                            </div>
                            <Skeleton className="h-4 w-16 rounded-full" />
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
