import { Skeleton } from "@/components/ui/skeleton";

function QuotaTableSkeleton() {
    return (
        <div className="overflow-hidden rounded-2xl border border-hairline-soft bg-canvas">
            <div className="grid grid-cols-[minmax(8rem,1.4fr)_5rem_8rem_6rem_minmax(7rem,1fr)_7rem] gap-3 border-b border-hairline-soft bg-canvas-soft px-3 py-2.5">
                {Array.from({ length: 6 }).map((_, index) => (
                    <Skeleton key={index} className="h-3 w-full max-w-20 rounded-full" />
                ))}
            </div>
            {Array.from({ length: 3 }).map((_, index) => (
                <div
                    key={index}
                    className="grid grid-cols-[minmax(8rem,1.4fr)_5rem_8rem_6rem_minmax(7rem,1fr)_7rem] items-center gap-3 border-b border-hairline-soft px-3 py-3 last:border-b-0"
                >
                    <Skeleton className="h-3.5 w-28 rounded-full" />
                    <Skeleton className="mx-auto h-5 w-14 rounded-full" />
                    <Skeleton className="ml-auto h-3 w-20 rounded-full" />
                    <Skeleton className="ml-auto h-3 w-10 rounded-full" />
                    <Skeleton className="h-1.5 w-full rounded-full" />
                    <Skeleton className="ml-auto h-3 w-16 rounded-full" />
                </div>
            ))}
        </div>
    );
}

function UsageMetricsSkeleton() {
    return (
        <div className="space-y-2 pt-2">
            <Skeleton className="h-3 w-40 rounded-full" />
            <div className="overflow-hidden rounded-2xl border border-hairline-soft bg-canvas">
                <div className="grid grid-cols-[minmax(10rem,1.5fr)_5rem_7rem_7rem_8rem_7rem] gap-3 border-b border-hairline-soft bg-canvas-soft px-3.5 py-2.5">
                    {Array.from({ length: 6 }).map((_, index) => (
                        <Skeleton key={index} className="h-3 w-full max-w-24 rounded-full" />
                    ))}
                </div>
                {Array.from({ length: 2 }).map((_, index) => (
                    <div
                        key={index}
                        className="grid grid-cols-[minmax(10rem,1.5fr)_5rem_7rem_7rem_8rem_7rem] items-center gap-3 border-b border-hairline-soft px-3.5 py-3 last:border-b-0"
                    >
                        <Skeleton className="h-3.5 w-32 rounded-full" />
                        {Array.from({ length: 5 }).map((__, cellIndex) => (
                            <Skeleton key={cellIndex} className="ml-auto h-3 w-14 rounded-full" />
                        ))}
                    </div>
                ))}
            </div>
        </div>
    );
}

function QuotaAccountSkeleton() {
    return (
        <div className="space-y-4 rounded-2xl border border-hairline-soft bg-canvas-soft/40 p-5">
            <div className="flex flex-col gap-2 border-b border-hairline-soft pb-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2.5">
                    <Skeleton className="size-2 rounded-full" />
                    <Skeleton className="h-4 w-32 rounded-full" />
                    <Skeleton className="h-5 w-16 rounded-full" />
                </div>
                <Skeleton className="h-3 w-32 rounded-full" />
            </div>
            <QuotaTableSkeleton />
            <UsageMetricsSkeleton />
        </div>
    );
}

function QuotaProviderSkeleton() {
    return (
        <article className="space-y-5 rounded-3xl border border-hairline-soft bg-canvas p-6 shadow-none">
            <div className="flex flex-col justify-between gap-4 border-b border-hairline-soft pb-4 sm:flex-row sm:items-center">
                <div className="flex min-w-0 flex-1 items-center gap-3.5">
                    <Skeleton className="size-10 shrink-0 rounded-2xl" />
                    <div className="min-w-0 flex-1 space-y-2">
                        <Skeleton className="h-5 w-28 rounded-full" />
                        <Skeleton className="h-3 w-64 max-w-full rounded-full" />
                    </div>
                    <Skeleton className="size-8 shrink-0 rounded-full" />
                </div>
                <Skeleton className="h-8 w-20 shrink-0 rounded-full" />
            </div>
            <div className="space-y-4 pt-1">
                <QuotaAccountSkeleton />
                <QuotaAccountSkeleton />
            </div>
        </article>
    );
}

export function QuotaSkeleton() {
    return (
        <div className="mx-auto flex w-full max-w-[1360px] flex-col gap-8 font-sans">
            <header className="flex flex-col justify-between gap-4 pb-2 sm:flex-row sm:items-end">
                <div className="min-w-0 space-y-2">
                    <Skeleton className="h-3 w-32 rounded-full" />
                    <Skeleton className="h-10 w-64 max-w-full rounded-2xl" />
                    <Skeleton className="h-4 w-[34rem] max-w-full rounded-full" />
                    <Skeleton className="h-4 w-80 max-w-full rounded-full" />
                </div>
                <Skeleton className="h-9 w-24 shrink-0 rounded-full" />
            </header>
            <div className="flex w-full flex-col gap-6">
                <QuotaProviderSkeleton />
                <QuotaProviderSkeleton />
            </div>
        </div>
    );
}
