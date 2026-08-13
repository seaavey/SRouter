import { Skeleton } from "@/components/ui/skeleton";

export function CatalogSkeleton() {
    return (
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
                <div>
                    <Skeleton className="h-3 w-24" />
                    <Skeleton className="mt-3 h-7 w-48" />
                    <Skeleton className="mt-2 h-4 w-72 max-w-full" />
                </div>
                <Skeleton className="h-8 w-32 rounded-lg" />
            </div>
            <div className="grid grid-cols-2 border-y border-border/70 xl:grid-cols-4">
                {Array.from({ length: 4 }).map((_, index) => (
                    <div key={index} className="px-4 py-5 first:pl-0">
                        <Skeleton className="h-14 rounded-lg" />
                    </div>
                ))}
            </div>
            <Skeleton className="h-8 w-full max-w-md rounded-lg" />
            <Skeleton className="h-96 rounded-lg" />
        </div>
    );
}
