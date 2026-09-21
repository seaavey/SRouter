import { Skeleton } from "@/components/ui/skeleton";

export default function LogsSkeleton() {
    return (
        <div className="mx-auto flex w-full max-w-[1360px] flex-col gap-8 font-sans pb-16">
            <header className="flex flex-col justify-between gap-4 pb-2 sm:flex-row sm:items-end">
                <div className="min-w-0">
                    <div className="mb-2 flex items-center gap-2">
                        <Skeleton className="size-2 rounded-full" />
                        <Skeleton className="h-3 w-28 rounded-full" />
                    </div>
                    <Skeleton className="h-10 w-52 max-w-full rounded-2xl" />
                    <Skeleton className="mt-1 h-5 w-full max-w-[520px] rounded-full" />
                </div>
                <Skeleton className="h-10 w-28 rounded-full" />
            </header>
            <section className="grid grid-cols-1 gap-4 font-sans sm:grid-cols-3">
                {Array.from({ length: 3 }).map((_, i) => (
                    <div
                        key={i}
                        className="flex min-w-0 min-h-[140px] flex-col justify-between rounded-3xl border border-hairline-soft bg-canvas p-6 shadow-none"
                    >
                        <div className="flex items-center justify-between">
                            <Skeleton className="h-3 w-24 rounded-full" />
                            <Skeleton className="size-4 rounded-full" />
                        </div>
                        <Skeleton className="mt-3 h-9 w-28 rounded-2xl" />
                        <div className="mt-4 border-t border-hairline-soft pt-3">
                            <Skeleton className="h-3 w-36 rounded-full" />
                        </div>
                    </div>
                ))}
            </section>
            <div className="flex flex-col items-stretch justify-between gap-3 font-sans sm:flex-row sm:items-center">
                <Skeleton className="h-10 w-full max-w-lg rounded-full" />
                <div className="flex h-10 items-center gap-1 rounded-full border border-hairline-soft bg-canvas-soft p-1">
                    {Array.from({ length: 3 }).map((_, i) => (
                        <Skeleton key={i} className="h-8 w-16 rounded-full" />
                    ))}
                </div>
            </div>
            <div className="flex flex-col gap-4 font-sans">
                <div className="overflow-hidden rounded-3xl border border-hairline-soft bg-canvas shadow-none">
                    <div className="overflow-x-auto">
                        <div className="min-w-[900px]">
                            <div className="flex h-10 items-center gap-4 border-b border-hairline-soft bg-canvas-soft px-5">
                                <Skeleton className="h-3 w-20 rounded-full" />
                                <Skeleton className="h-3 w-16 rounded-full" />
                                <Skeleton className="h-3 w-40 rounded-full" />
                                <Skeleton className="h-3 w-20 rounded-full" />
                                <Skeleton className="h-3 w-20 rounded-full" />
                                <Skeleton className="h-3 w-16 rounded-full" />
                                <Skeleton className="ml-auto h-3 w-4 rounded-full" />
                            </div>
                            <div className="divide-y divide-hairline-soft">
                                {Array.from({ length: 25 }).map((_, i) => (
                                    <div key={i} className="flex items-center gap-4 px-5 py-3">
                                        <div className="flex w-24 shrink-0 flex-col gap-1.5">
                                            <Skeleton className="h-3 w-16 rounded-full" />
                                            <Skeleton className="h-2.5 w-20 rounded-full" />
                                        </div>
                                        <Skeleton className="h-5 w-16 shrink-0 rounded-full" />
                                        <div className="flex min-w-0 w-56 shrink-0 flex-col gap-1.5">
                                            <Skeleton className="h-3 w-40 rounded-full" />
                                            <Skeleton className="h-2.5 w-28 rounded-full" />
                                        </div>
                                        <div className="flex w-28 shrink-0 flex-col gap-1.5">
                                            <Skeleton className="h-3 w-20 rounded-full" />
                                            <Skeleton className="h-2.5 w-24 rounded-full" />
                                        </div>
                                        <Skeleton className="h-3 w-16 shrink-0 rounded-full" />
                                        <Skeleton className="h-3 w-16 shrink-0 rounded-full" />
                                        <Skeleton className="ml-auto size-7 shrink-0 rounded-full" />
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
                <div className="flex flex-col items-center justify-between gap-3 px-2 text-xs font-sans sm:flex-row">
                    <Skeleton className="h-3 w-28 rounded-full" />
                    <div className="flex items-center gap-1.5">
                        <Skeleton className="size-9 rounded-full" />
                        <Skeleton className="h-9 w-12 rounded-xl" />
                        <Skeleton className="h-2.5 w-8 rounded-full" />
                        <Skeleton className="size-9 rounded-full" />
                    </div>
                </div>
            </div>
        </div>
    );
}
