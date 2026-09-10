import { Skeleton } from "@/components/ui/skeleton";

export function SettingsSkeleton() {
    return (
        <div className="mx-auto flex w-full max-w-[1360px] flex-col gap-8 font-sans pb-16">
            {/* Header */}
            <div className="flex flex-col justify-between gap-4 pb-2 sm:flex-row sm:items-end">
                <div className="space-y-2">
                    <Skeleton className="h-3 w-28 rounded-full" />
                    <Skeleton className="h-9 w-60 rounded-2xl" />
                    <Skeleton className="h-4 w-96 max-w-full rounded-full" />
                </div>
                <div className="flex items-center gap-2">
                    <Skeleton className="h-10 w-24 rounded-full" />
                    <Skeleton className="h-10 w-24 rounded-full" />
                </div>
            </div>

            <div className="lg:grid lg:grid-cols-[12rem_minmax(0,1fr)] lg:items-start lg:gap-8">
                {/* Nav Quick Tabs */}
                <div className="flex items-center gap-1 border border-hairline-soft p-1.5 bg-canvas rounded-3xl lg:flex-col lg:items-stretch">
                    {Array.from({ length: 6 }).map((_, i) => (
                        <Skeleton key={i} className="h-9 w-full rounded-full" />
                    ))}
                </div>

                {/* Settings Sections */}
                <div className="space-y-6">
                    {Array.from({ length: 3 }).map((_, i) => (
                        <div
                            key={i}
                            className="rounded-3xl border border-hairline-soft bg-canvas p-6 md:p-8 space-y-5 shadow-none"
                        >
                            <div className="flex items-center gap-3.5 border-b border-hairline-soft pb-5">
                                <Skeleton className="size-9 rounded-full" />
                                <div className="space-y-2">
                                    <Skeleton className="h-4 w-48 rounded-full" />
                                    <Skeleton className="h-3 w-72 rounded-full" />
                                </div>
                            </div>

                            <div className="space-y-4 pt-2">
                                <Skeleton className="h-10 w-full rounded-2xl" />
                                <Skeleton className="h-10 w-full rounded-2xl" />
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
