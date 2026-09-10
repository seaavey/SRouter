import { Skeleton } from "@/components/ui/skeleton";

export function LogsSkeleton() {
    return (
        <div className="mx-auto flex w-full max-w-[1360px] flex-col gap-8 font-sans pb-16">
            {/* Header */}
            <div className="flex flex-col justify-between gap-4 pb-2 sm:flex-row sm:items-end">
                <div className="space-y-2">
                    <Skeleton className="h-3 w-28 rounded-full" />
                    <Skeleton className="h-9 w-52 rounded-2xl" />
                    <Skeleton className="h-4 w-96 max-w-full rounded-full" />
                </div>
                <Skeleton className="h-10 w-28 rounded-full" />
            </div>

            {/* Metrics Row Skeleton */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 font-sans">
                {Array.from({ length: 3 }).map((_, i) => (
                    <div
                        key={i}
                        className="flex min-w-0 min-h-[140px] flex-col justify-between rounded-3xl border border-hairline-soft bg-canvas p-6 shadow-none"
                    >
                        <Skeleton className="h-3 w-24 rounded-full" />
                        <Skeleton className="h-8 w-28 rounded-2xl mt-3" />
                        <div className="mt-4 border-t border-hairline-soft pt-3">
                            <Skeleton className="h-3 w-36 rounded-full" />
                        </div>
                    </div>
                ))}
            </div>

            {/* Toolbar Skeleton */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 font-sans">
                <Skeleton className="h-10 w-full max-w-lg rounded-full" />
                <Skeleton className="h-10 w-48 rounded-full" />
            </div>

            {/* Logs Table Skeleton */}
            <div className="overflow-hidden rounded-3xl border border-hairline-soft bg-canvas shadow-none font-sans">
                <div className="border-b border-hairline-soft bg-canvas-soft p-4">
                    <Skeleton className="h-4 w-36 rounded-full" />
                </div>
                <div className="divide-y divide-hairline-soft">
                    {Array.from({ length: 8 }).map((_, i) => (
                        <div key={i} className="flex items-center justify-between p-4 gap-4">
                            <Skeleton className="h-4 w-28 rounded-full" />
                            <Skeleton className="h-5 w-16 rounded-full" />
                            <Skeleton className="h-4 w-44 rounded-full" />
                            <Skeleton className="h-4 w-20 rounded-full" />
                            <Skeleton className="h-4 w-16 rounded-full" />
                            <Skeleton className="h-4 w-16 rounded-full" />
                            <Skeleton className="size-7 rounded-full" />
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
