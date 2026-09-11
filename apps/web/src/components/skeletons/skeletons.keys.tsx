import { Skeleton } from "@/components/ui/skeleton";

export function KeysSkeleton() {
    return (
        <div className="mx-auto flex w-full max-w-[1360px] flex-col gap-8 font-sans">
            <div className="flex flex-col justify-between gap-4 pb-2 sm:flex-row sm:items-end">
                <div className="space-y-2">
                    <Skeleton className="h-3 w-28 rounded-full" />
                    <Skeleton className="h-8 w-48 rounded-2xl" />
                    <Skeleton className="h-4 w-80 max-w-full rounded-2xl" />
                </div>
                <Skeleton className="h-10 w-36 rounded-full" />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 font-sans">
                {Array.from({ length: 3 }).map((_, i) => (
                    <div
                        key={i}
                        className="flex min-w-0 min-h-[140px] flex-col justify-between rounded-3xl border border-hairline-soft bg-canvas p-6 shadow-none"
                    >
                        <Skeleton className="h-3 w-24 rounded-full" />
                        <Skeleton className="h-8 w-24 rounded-2xl mt-3" />
                        <div className="mt-4 border-t border-hairline-soft pt-3">
                            <Skeleton className="h-3 w-36 rounded-full" />
                        </div>
                    </div>
                ))}
            </div>
            <div className="overflow-hidden rounded-3xl border border-hairline-soft bg-canvas shadow-none">
                <div className="flex flex-col justify-between gap-4 border-b border-hairline-soft px-6 py-4 sm:flex-row sm:items-center">
                    <div className="flex items-center gap-3">
                        <Skeleton className="size-8 rounded-full" />
                        <div className="space-y-1.5">
                            <Skeleton className="h-4 w-28 rounded-full" />
                            <Skeleton className="h-3 w-44 rounded-full" />
                        </div>
                    </div>
                    <Skeleton className="h-9 w-64 rounded-full" />
                </div>
                <div className="p-6 space-y-3">
                    {Array.from({ length: 4 }).map((_, i) => (
                        <Skeleton key={i} className="h-12 w-full rounded-2xl" />
                    ))}
                </div>
            </div>
        </div>
    );
}
